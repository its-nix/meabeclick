"""Supported Google REST access using separately provisioned OAuth refresh tokens.

No connected-chat token discovery. Credentials: authorized_user JSON with client_id,
client_secret, refresh_token, mode 0600, outside tracked source (outputs is ignored).
Obtain consent with offline access and Sheets + drive.file scopes through your own
Google Cloud OAuth client. No token or remote error body is logged. Service-account
keys are deliberately not accepted; their signing/delegation needs separate setup.

Remote writes persist an intent before submission and never retry unknown outcomes.
Candidate writeback touches only P:Q; Sheets has no compare-and-swap guarantee, so
owner editing during the final read/write window is a visible operational limitation.
Docs: https://developers.google.com/identity/protocols/oauth2/web-server#offline
https://developers.google.com/workspace/drive/api/guides/manage-uploads
https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get
"""
import fcntl
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import engine

TABLES={'Queue':17,'Components':9,'Recipes':11,'References':10,'Ideas':7}
REVIEW_LOG_HEADERS=['batch_id','planned_count','review_minutes','completed_at','worker_note']
EDITORIAL_HEADERS={
    'Queue':['Post ID','Title','Preview','Caption','Decision','Feedback','Proposed slot','Purpose','Status','Accessible description','Format','Artifact ID','Manifest','Reference IDs','Automated review','Candidate artifact','Candidate preview'],
    'Components':['ID','Type','Audience','Situation / benefit','Copy / visual','Compatible IDs / condition','Revision','Status','Asset'],
    'Recipes':['Recipe ID','Post','Audience','Hook revision','Body revision','CTA revision','Visual treatment','Audio','Review question','Status','Reference IDs'],
    'References':['Reference ID','Title','Source / clip','Time','Audience','Mechanism','Use','Avoid','Owner response','Component IDs'],
    'Ideas':['Idea ID','Format','Example','Audience','Purpose','Production dependency','Status'],
}
MAX_UPLOAD=5*1024*1024

class CredentialsUnavailable(RuntimeError):pass
class UncertainWrite(RuntimeError):pass


def _credentials(value):
    if not isinstance(value,dict) or value.get('type')!='authorized_user' or any(not isinstance(value.get(k),str) or not value[k] for k in ('client_id','client_secret','refresh_token')):raise ValueError('Expected independently provisioned authorized_user credentials')
    return value


def load_credentials(path):
    path=engine.physical_path(path)
    if not path.is_file():raise CredentialsUnavailable('Google credentials missing; configure offline OAuth consent')
    if path.stat().st_mode&0o077:raise ValueError('Credential file must be private (chmod 600)')
    return _credentials(json.loads(path.read_text()))


def http_json(method,url,headers,body=None):
    try:
        with urlopen(Request(url,data=body,headers=headers,method=method),timeout=30) as response:
            raw=response.read(8*1024*1024+1)
            if len(raw)>8*1024*1024:raise RuntimeError('Google response exceeds bounded size')
            return json.loads(raw)
    except HTTPError as exc:
        # Do not expose Google's response body, request credentials or private URL.
        raise RuntimeError(f'Google HTTP {exc.code}; inspect account/scopes and reconcile writes') from None
    except URLError:
        raise RuntimeError('Google network request failed') from None


def _id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,200}',value):raise ValueError('Invalid Google resource ID')
    return value


def _atomic(path,value):
    temporary=path.with_suffix('.tmp')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as handle:
        json.dump(value,handle,ensure_ascii=False,sort_keys=True);handle.flush();os.fsync(handle.fileno())
    temporary.replace(path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


class GoogleSync:
    def __init__(self,credentials,transport=http_json):
        self.credentials=_credentials(credentials);self.transport=transport;self.token=None;self.expires=0

    def _access(self):
        if not self.token or time.monotonic()>=self.expires:
            fields={k:self.credentials[k] for k in ('client_id','client_secret','refresh_token')};fields['grant_type']='refresh_token'
            try:result=self.transport('POST','https://oauth2.googleapis.com/token',{'Content-Type':'application/x-www-form-urlencoded'},urlencode(fields).encode())
            except Exception:raise CredentialsUnavailable('Google OAuth refresh failed; restore consent/credentials') from None
            if not isinstance(result.get('access_token'),str) or not result['access_token'] or not isinstance(result.get('expires_in'),(int,float)) or result['expires_in']<=60:raise CredentialsUnavailable('Google OAuth refresh returned invalid token lifetime')
            self.token=result['access_token'];self.expires=time.monotonic()+result['expires_in']-60
        return self.token

    def _request(self,method,url,body=None,content_type='application/json'):
        headers={'Authorization':'Bearer '+self._access(),'Content-Type':content_type}
        return self.transport(method,url,headers,body)

    def read_cells(self,spreadsheet_id,bounds):
        """Bounded native tables from row5 including headers, at most 200 rows each."""
        _id(spreadsheet_id)
        if not isinstance(bounds,dict) or not bounds or set(bounds)-set(TABLES):raise ValueError('Only editorial Queue/Components/Recipes/References/Ideas tables may be read')
        ranges=[]
        for table,end in sorted(bounds.items()):
            if type(end) is not int or not 6<=end<=200:raise ValueError('Table end row must be 6..200')
            ranges.append("'"+table+"'!A5:"+chr(64+TABLES[table])+str(end))
        params=[('ranges',r) for r in ranges]+[('fields','sheets(properties(title),data(startRow,rowData(values(userEnteredValue,formattedValue))))')]
        return self._request('GET','https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'?'+urlencode(params))

    def snapshot(self,spreadsheet_id,bounds,batch,asset_keys=None):
        payload=self.read_cells(spreadsheet_id,bounds)
        sheets=payload.get('sheets',[])
        for title in bounds:
            matching=[sheet for sheet in sheets if sheet.get('properties',{}).get('title')==title]
            if len(matching)!=1:raise ValueError(f'Missing or duplicate {title} table')
            blocks=[block for block in matching[0].get('data',[]) if block.get('startRow',0)==4]
            if len(blocks)!=1 or not blocks[0].get('rowData'):raise ValueError(f'Missing {title} header at row5')
            cells=blocks[0]['rowData'][0].get('values',[])
            names=[]
            for cell in cells:
                entered=cell.get('userEnteredValue',{})
                # Formula-backed headers can change without an explicit schema edit.
                if 'formulaValue' in entered:raise ValueError(f'{title} header must use literal text')
                names.append(entered.get('stringValue',''))
            if names!=EDITORIAL_HEADERS[title]:raise ValueError(f'{title} header names/order changed; verify native schema before capture')
            # Sheets omits trailing empty CellData; restore the verified table width.
            for row in blocks[0]['rowData'][1:]:
                values=row.get('values',[])
                if len(values)>TABLES[title]:raise ValueError('Editorial row exceeds verified table width')
                row['values']=values+[{} for _ in range(TABLES[title]-len(values))]
        return engine.snapshot_from_cells(payload,batch,asset_keys)

    def _row(self,spreadsheet_id,row):
        url='https://sheets.googleapis.com/v4/spreadsheets/'+_id(spreadsheet_id)+'/values/'+quote(f"'Queue'!A{row}:Q{row}",safe='')+'?valueRenderOption=FORMATTED_VALUE'
        values=self._request('GET',url).get('values',[])
        if len(values)!=1:raise ValueError('Queue row missing')
        return (values[0]+['']*17)[:17]

    def _write(self,state_dir,intent,submit,verify):
        """Record before network call; uncertainty blocks all automatic resubmission."""
        state=engine.physical_path(state_dir);state.mkdir(parents=True,exist_ok=True,mode=0o700)
        key=hashlib.sha256(engine.canonical(intent)).hexdigest();path=state/(key+'.json')
        # Authenticate before persisting submission intent; token failures are definite.
        self._access()
        with (state/(key+'.lock')).open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            if path.exists():
                saved=json.loads(path.read_text())
                if saved['status']=='verified':return saved['receipt']
                raise UncertainWrite('Prior Google write uncertain; inspect provider and reconcile before retry')
            _atomic(path,{'status':'uncertain','intent':intent})
            try:
                receipt=submit()
                verify(receipt)
            except Exception:
                raise UncertainWrite('Google write outcome uncertain; retained intent blocks retry') from None
            _atomic(path,{'status':'verified','intent':intent,'receipt':receipt})
            return receipt

    def upload(self,path,parent_id,state_dir,mime_type='video/mp4'):
        """Upload <=5MiB via documented multipart route; verify size+MD5 metadata."""
        _id(parent_id);path=engine.physical_path(path)
        if not path.is_file() or not 0<path.stat().st_size<=MAX_UPLOAD:raise ValueError('Multipart upload requires file 1 byte..5MiB; larger media needs resumable adapter')
        if not isinstance(mime_type,str) or not re.fullmatch(r'[a-z0-9.+-]+/[a-z0-9.+-]+',mime_type):raise ValueError('Invalid MIME type')
        content=path.read_bytes();sha=hashlib.sha256(content).hexdigest();boundary='meabeclick-'+sha
        metadata={'name':path.name,'parents':[parent_id],'appProperties':{'contentMachineSHA256':sha}}
        body=(f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'.encode()+json.dumps(metadata).encode()+f'\r\n--{boundary}\r\nContent-Type: {mime_type}\r\n\r\n'.encode()+content+f'\r\n--{boundary}--\r\n'.encode())
        def submit():return self._request('POST','https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size,md5Checksum,webViewLink',body,'multipart/related; boundary='+boundary)
        def verify(receipt):
            identity=_id(receipt.get('id'));found=self._request('GET','https://www.googleapis.com/drive/v3/files/'+identity+'?fields=id,size,md5Checksum,webViewLink')
            if str(found.get('size'))!=str(len(content)) or found.get('md5Checksum')!=hashlib.md5(content).hexdigest():raise ValueError('Uploaded file does not match exact media')
        return self._write(state_dir,{'operation':'drive-upload','parent':parent_id,'sha256':sha,'name':path.name,'mime':mime_type},submit,verify)

    def verify_preview(self,path,preview_url,expected_revision_id=None):
        """Fail closed if the reviewed Drive file no longer matches frozen bytes."""
        path=engine.physical_path(path)
        parsed=urlsplit(preview_url)
        match=re.fullmatch(r'/file/d/([A-Za-z0-9_-]{1,200})/view',parsed.path)
        if parsed.scheme!='https' or parsed.netloc!='drive.google.com' or not match:raise ValueError('Use a canonical exact-file Drive preview')
        file_id=match[1]
        found=self._request('GET','https://www.googleapis.com/drive/v3/files/'+file_id+'?fields=id,size,md5Checksum,headRevisionId')
        if found.get('id')!=file_id or str(found.get('size'))!=str(path.stat().st_size) or found.get('md5Checksum')!=hashlib.md5(path.read_bytes()).hexdigest():raise ValueError('Reviewed Drive video differs from exact frozen media')
        if expected_revision_id is not None and found.get('headRevisionId')!=expected_revision_id:raise ValueError('Reviewed Drive revision changed')
        return True

    def write_candidate(self,spreadsheet_id,row,before,artifact_id,preview,state_dir):
        """Only candidate P:Q; preserve A:O, every owner decision and old binding.

        before is an exact 17-column freshly read Queue row. A stale or occupied
        candidate slot is rejected. There is no unsupported atomic CAS claim.
        """
        _id(spreadsheet_id)
        if type(row) is not int or not 6<=row<=200:raise ValueError('Queue row must be 6..200')
        if not isinstance(before,list) or len(before)!=17 or not re.fullmatch(r'P\d+',str(before[0])):raise ValueError('Expected exact A:Q queue row')
        if not re.fullmatch(re.escape(before[0])+r'-[a-z0-9]+',artifact_id):raise ValueError('Artifact/post mismatch')
        if not isinstance(preview,str) or not preview or len(preview)>2000:raise ValueError('Missing bounded preview')
        if before[15] and before[15]!=artifact_id:raise ValueError('Candidate occupied; preserve existing review')
        if self._row(spreadsheet_id,row)!=before:raise ValueError('Queue changed; refresh before writeback')
        payload={'valueInputOption':'RAW','data':[{'range':f"'Queue'!P{row}:Q{row}",'values':[[artifact_id,preview]]}]}
        def submit():return self._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values:batchUpdate',json.dumps(payload).encode())
        def verify(receipt):
            current=self._row(spreadsheet_id,row)
            if current[:15]!=before[:15] or current[15:17]!=[artifact_id,preview]:raise ValueError('Candidate readback mismatch or concurrent editorial change')
        return self._write(state_dir,{'operation':'queue-candidate','sheet':spreadsheet_id,'row':row,'before':before,'artifact':artifact_id,'preview':preview},submit,verify)

    def mirror_document(self,path,file_id,state_dir):
        """Update a configured raw Markdown mirror; stop on independent Drive edits."""
        _id(file_id);path=engine.physical_path(path);state=engine.physical_path(state_dir);state.mkdir(parents=True,exist_ok=True,mode=0o700)
        if path.suffix!='.md' or not path.is_file() or not 0<path.stat().st_size<=MAX_UPLOAD:raise ValueError('Mirror must be bounded Markdown')
        content=path.read_bytes();checksum=hashlib.md5(content).hexdigest();record=state/('mirror-'+file_id+'.json')
        url='https://www.googleapis.com/drive/v3/files/'+file_id+'?fields=id,mimeType,md5Checksum,size,version'
        def metadata():
            value=self._request('GET',url)
            if value.get('id')!=file_id or value.get('mimeType') not in ('text/markdown','text/plain') or not value.get('md5Checksum'):raise ValueError('Configured mirror must be a readable raw text file')
            return value
        before=metadata()
        if before['md5Checksum']==checksum:
            _atomic(record,{'md5':checksum});return {'id':file_id,'status':'unchanged','md5':checksum}
        previous=json.loads(record.read_text()) if record.exists() else {}
        if before['md5Checksum']!=previous.get('md5'):raise ValueError('Drive mirror changed independently; reconcile before replacing')
        def submit():
            if metadata()!=before:raise ValueError('Mirror changed before upload')
            return self._request('PATCH','https://www.googleapis.com/upload/drive/v3/files/'+file_id+'?uploadType=media&fields=id,md5Checksum,size',content,before['mimeType'])
        def verify(receipt):
            after=metadata()
            if after['md5Checksum']!=checksum or str(after.get('size'))!=str(len(content)):raise ValueError('Mirror upload readback mismatch')
        self._write(state,{'operation':'document-mirror','file':file_id,'before':before,'sha256':hashlib.sha256(content).hexdigest()},submit,verify)
        verify(None);_atomic(record,{'md5':checksum})
        return {'id':file_id,'status':'updated','md5':checksum}

    def _release_values(self,spreadsheet_id,sheet_id):
        import review_queue
        _id(spreadsheet_id)
        if type(sheet_id) is not int or sheet_id<0:raise ValueError('Verified numeric Releases sheet ID required')
        metadata=self._request('GET','https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'?fields=sheets(properties(sheetId,title))')
        matching=[s for s in metadata.get('sheets',[]) if s.get('properties',{}).get('sheetId')==sheet_id]
        if len(matching)!=1 or matching[0]['properties'].get('title')!='Releases':raise ValueError('Configured native sheet ID must identify Releases')
        url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values/'+quote("'Releases'!A1:P201",safe='')+'?valueRenderOption=UNFORMATTED_VALUE'
        rows=self._request('GET',url).get('values',[])
        if not isinstance(rows,list) or not rows or len(rows)>201:raise ValueError('Missing or oversized Releases table')
        padded=[]
        for row in rows:
            if not isinstance(row,list) or len(row)>len(review_queue.HEADERS):raise ValueError('Malformed Releases row')
            padded.append(row+['']*(len(review_queue.HEADERS)-len(row)))
        if padded[0]!=review_queue.HEADERS:raise ValueError('Native Releases headers mismatch')
        # Typed checkbox columns populate unchecked defaults in unused table rows.
        # Ignore only trailing empty rows; never hide checks, feedback or gaps.
        while len(padded)>1:
            row=padded[-1]
            if any(v!='' for v in row[:11]) or row[13]!='' or any(row[14:]) or not all(v is False or v=='' for v in row[11:13]):break
            padded.pop()
        if any(not row[0] or all(value=='' for value in row) for row in padded[1:]):raise ValueError('Blank release IDs or interior gaps require owner reconciliation')
        if len({row[0] for row in padded[1:]})!=len(padded)-1:raise ValueError('Duplicate native release IDs')
        return padded

    def append_generated_ideas(self,spreadsheet_id,concepts,state_dir):
        """Append generated ideas to the native table without changing human rows."""
        _id(spreadsheet_id)
        if not isinstance(concepts,list):raise ValueError('Generated concepts must be a list')
        expected_header=EDITORIAL_HEADERS['Ideas']
        read_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values/'+quote("'Ideas'!A5:G205",safe='')+'?valueRenderOption=UNFORMATTED_VALUE'
        def read_rows():
            values=self._request('GET',read_url).get('values',[])
            if not values or values[0]!=expected_header:raise ValueError('Ideas header names/order changed')
            if len(values)>201:raise ValueError('Ideas table exceeds the bounded row count')
            rows=[]
            for row in values:
                if not isinstance(row,list) or len(row)>7:raise ValueError('Malformed Ideas row')
                rows.append(row+['']*(7-len(row)))
            ids=[row[0] for row in rows[1:] if row[0]]
            if len(ids)!=len(set(ids)):raise ValueError('Duplicate Ideas ID')
            return rows
        before=read_rows();by_id={row[0]:row for row in before[1:] if row[0]};to_add=[]
        for concept in concepts:
            if not isinstance(concept,dict) or not isinstance(concept.get('id'),str) or not isinstance(concept.get('payload'),dict):raise ValueError('Malformed generated concept record')
            value=concept['payload'];identity='AI-'+concept['id']
            row=[identity,value.get('format',''),(value.get('hook_he','')+' '+value.get('premise','')).strip(),value.get('audience',''),value.get('payoff',''),', '.join(value.get('production_requirements',[])),'Production ready']
            if not all(isinstance(cell,str) for cell in row):raise ValueError('Generated Ideas cells must be text')
            if identity in by_id:
                if by_id[identity]!=row:raise ValueError('Generated Ideas ID already exists with different content')
                continue
            by_id[identity]=row;to_add.append(row)
        if not to_add:return {'status':'unchanged','appended':0}
        append_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values/'+quote("'Ideas'!A:G",safe='')+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
        intent={'operation':'append-generated-ideas','spreadsheet_id':spreadsheet_id,'rows':to_add,'before_ids':[r[0] for r in before[1:] if r[0]]}
        def submit():
            if read_rows()!=before:raise ValueError('Native Ideas table changed before append')
            return self._request('POST',append_url,json.dumps({'values':to_add},ensure_ascii=False).encode())
        def verify(_):
            after=read_rows();found={row[0]:row for row in after[1:] if row[0]}
            if any(found.get(row[0])!=row for row in to_add):raise ValueError('Generated Ideas append readback mismatch')
            if [r[0] for r in after[1:1+len(before)-1] if r[0]]!=[r[0] for r in before[1:] if r[0]]:raise ValueError('Existing Ideas rows changed during append')
        self._write(state_dir,intent,submit,verify)
        return {'status':'appended','appended':len(to_add)}

    def sync_daily_calendar(self, spreadsheet_id, calendar, gaps, state_dir):
        """Mirror the worker-owned rolling calendar as a bounded worksheet."""
        _id(spreadsheet_id)
        if not 1 <= len(calendar) <= 31:
            raise ValueError('Calendar must contain one rolling month')
        url = 'https://sheets.googleapis.com/v4/spreadsheets/' + spreadsheet_id
        metadata_url = url + '?fields=sheets(properties(sheetId,title))'
        title = 'Daily Calendar'
        headers = ['Date', 'Concept', 'Plan', 'Buffer']
        def sheet():
            return next((s['properties'] for s in self._request('GET', metadata_url).get('sheets', [])
                         if s.get('properties', {}).get('title') == title), None)
        target = sheet()
        if target is None:
            def create():
                add = {'properties': {'title': title, 'gridProperties': {'rowCount':32, 'columnCount':4, 'frozenRowCount':1}}}
                return self._request('POST', url+':batchUpdate', json.dumps({'requests':[{'addSheet':add}]}).encode())
            def verify_create(_):
                if not sheet():
                    raise ValueError('Daily Calendar creation readback failed')
            self._write(state_dir, {'operation':'create-daily-calendar','spreadsheet_id':spreadsheet_id}, create, verify_create)
            target = sheet()
        values_url = url + '/values/' + quote("'Daily Calendar'!A1:D32", safe='')
        def read():
            values = self._request('GET', values_url+'?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
            if values and values[0] != headers:
                raise ValueError('Daily Calendar tab has unexpected columns')
            return [(row + [''] * 4)[:4] for row in values]
        rows = [headers]
        for index, slot in enumerate(calendar):
            day = slot['date']
            buffer_status = ('Gap' if day in gaps else 'Verified') if index < 7 else ''
            rows.append([day, slot.get('hook_he', ''), slot['state'], buffer_status])
        rows += [[''] * 4 for _ in range(32-len(rows))]
        before = read()
        if before == rows[:len(before)] and not any(any(row) for row in rows[len(before):]):
            return
        def submit():
            if read() != before:
                raise ValueError('Daily Calendar changed before sync')
            return self._request('PUT', values_url+'?valueInputOption=RAW',
                                 json.dumps({'values':rows}, ensure_ascii=False).encode())
        def verify(_):
            after = read()
            if after != rows[:len(after)] or any(any(row) for row in rows[len(after):]):
                raise ValueError('Daily Calendar readback mismatch')
        self._write(state_dir, {'operation':'sync-daily-calendar', 'spreadsheet_id':spreadsheet_id,
                                'sheet_id':target['sheetId'], 'before':before, 'rows':rows}, submit, verify)

    def sync_review_log(self,spreadsheet_id,batches,state_dir,sheet_id=None):
        """Create/verify Review Log and sync machine fields while preserving owner minutes."""
        _id(spreadsheet_id)
        if not isinstance(batches,list):raise ValueError('Review batches must be a list')
        metadata_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'?fields=sheets(properties(sheetId,title),protectedRanges(protectedRangeId,description,range,unprotectedRanges,warningOnly))'
        meta=self._request('GET',metadata_url)
        sheets=meta.get('sheets',[]);matches=[s['properties'] for s in sheets if s.get('properties',{}).get('title')=='Review Log']
        if len(matches)>1:raise ValueError('Duplicate Review Log tabs')
        if not matches:
            create_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+':batchUpdate'
            def create():return self._request('POST',create_url,json.dumps({'requests':[{'addSheet':{'properties':{'title':'Review Log','gridProperties':{'rowCount':201,'columnCount':5}}}}]}).encode())
            def verify_create(response):
                created=response.get('replies',[{}])[0].get('addSheet',{}).get('properties',{})
                current=self._request('GET',metadata_url).get('sheets',[])
                found=[s.get('properties',{}) for s in current if s.get('properties',{}).get('title')=='Review Log']
                if len(found)!=1 or found[0].get('sheetId')!=created.get('sheetId'):raise ValueError('Review Log creation readback mismatch')
            response=self._write(state_dir,{'operation':'create-review-log','spreadsheet_id':spreadsheet_id,'title':'Review Log'},create,verify_create)
            created=response.get('replies',[{}])[0].get('addSheet',{}).get('properties',{})
            if type(created.get('sheetId')) is not int:raise ValueError('Review Log creation returned no verified sheet ID')
            sheet={'sheetId':created['sheetId'],'title':'Review Log'}
        else:sheet=matches[0]
        if sheet_id is not None and (type(sheet_id) is not int or sheet['sheetId']!=sheet_id):raise ValueError('Configured Review Log sheet ID changed')
        protection={'range':{'sheetId':sheet['sheetId']},'unprotectedRanges':[{'sheetId':sheet['sheetId'],'startColumnIndex':2,'endColumnIndex':3}],
                    'description':'Content machine fields are locked; only review_minutes is owner-editable','warningOnly':False}
        actual=[s.get('protectedRanges',[]) for s in self._request('GET',metadata_url).get('sheets',[]) if s.get('properties',{}).get('sheetId')==sheet['sheetId']]
        if len(actual)!=1:raise ValueError('Review Log protection metadata unavailable')
        if not any(p.get('description')==protection['description'] and p.get('range')==protection['range'] and p.get('unprotectedRanges')==protection['unprotectedRanges'] and p.get('warningOnly', False) is False for p in actual[0]):
            protect_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+':batchUpdate'
            def protect():return self._request('POST',protect_url,json.dumps({'requests':[{'addProtectedRange':{'protectedRange':protection}}]}).encode())
            def verify_protection(_):
                found=[s.get('protectedRanges',[]) for s in self._request('GET',metadata_url).get('sheets',[]) if s.get('properties',{}).get('sheetId')==sheet['sheetId']]
                if len(found)!=1 or not any(p.get('description')==protection['description'] and p.get('unprotectedRanges')==protection['unprotectedRanges'] and p.get('warningOnly', False) is False for p in found[0]):raise ValueError('Review Log protection readback mismatch')
            self._write(state_dir,{'operation':'protect-review-log','spreadsheet_id':spreadsheet_id,'sheet_id':sheet['sheetId'],'range':protection},protect,verify_protection)
        read_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values/'+quote("'Review Log'!A1:E201",safe='')+'?valueRenderOption=UNFORMATTED_VALUE'
        def read_rows():
            values=self._request('GET',read_url).get('values',[])
            if not values:return []
            if values[0]!=REVIEW_LOG_HEADERS:raise ValueError('Review Log header names/order changed')
            if len(values)>201:raise ValueError('Review Log exceeds 200 batches')
            rows=[]
            for row in values:
                if not isinstance(row,list) or len(row)>5:raise ValueError('Malformed Review Log row')
                rows.append(row+['']*(5-len(row)))
            ids=[row[0] for row in rows[1:] if row[0]]
            if len(ids)!=len(set(ids)):raise ValueError('Duplicate Review Log batch ID')
            for row in rows[1:]:
                if not row[0] or type(row[1]) not in (int,float) or int(row[1])!=row[1] or not 1<=row[1]<=20:raise ValueError('Malformed Review Log machine fields')
                if row[2] not in ('',None) and (type(row[2]) not in (int,float) or int(row[2])!=row[2] or not 0<=row[2]<=600):raise ValueError('Review minutes must be 0..600 or blank')
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',row[0]) or not isinstance(row[3],str) or not isinstance(row[4],str) or len(row[4])>300:raise ValueError('Malformed Review Log identity or machine fields')
                if row[3]:
                    try:completed=datetime.fromisoformat(row[3].replace('Z','+00:00'))
                    except ValueError as exc:raise ValueError('Review Log completion must be ISO-8601') from exc
                    if completed.tzinfo is None:raise ValueError('Review Log completion must include a timezone')
            return rows
        before=read_rows()
        if not before:
            header_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values/'+quote("'Review Log'!A1:E1",safe='')+'?valueInputOption=RAW'
            intent={'operation':'initialize-review-log','spreadsheet_id':spreadsheet_id,'sheet_id':sheet['sheetId'],'headers':REVIEW_LOG_HEADERS}
            def submit_header():return self._request('PUT',header_url,json.dumps({'values':[REVIEW_LOG_HEADERS]}).encode())
            def verify_header(_):
                if read_rows()!=[REVIEW_LOG_HEADERS]:raise ValueError('Review Log header readback mismatch')
            self._write(state_dir,intent,submit_header,verify_header);before=read_rows()
        desired=[row[:] for row in before]
        by_id={row[0]:i for i,row in enumerate(desired[1:],1)}
        seen=set()
        for item in batches:
            if not isinstance(item,dict) or set(item)!={'batch_id','planned_count','completed_at','worker_note'}:raise ValueError('Review batch record schema changed')
            batch=item['batch_id'];count=item['planned_count'];completed=item['completed_at'];note=item['worker_note']
            if not isinstance(batch,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',batch) or batch in seen:raise ValueError('Invalid or duplicate review batch ID')
            if type(count) is not int or not 1<=count<=20 or not isinstance(completed,str) or not isinstance(note,str) or len(note)>300:raise ValueError('Malformed Review Log machine fields')
            seen.add(batch)
            if batch in by_id:
                row=desired[by_id[batch]]
                if row[1]!=count:raise ValueError('Review batch planned count is immutable')
                row[3:5]=[completed,note]
            else:
                if len(desired)>=201:raise ValueError('Review Log capacity reached')
                by_id[batch]=len(desired);desired.append([batch,count,'',completed,note])
        if desired==before:return {'status':'unchanged','sheet_id':sheet['sheetId'],'rows':desired}
        data=[]
        for index,row in enumerate(desired[1:],2):
            old=before[index-1] if index<=len(before) else None
            if old is None or row[0:2]!=old[0:2]:data.append({'range':f"'Review Log'!A{index}:B{index}",'values':[row[0:2]]})
            if old is None or row[3:5]!=old[3:5]:data.append({'range':f"'Review Log'!D{index}:E{index}",'values':[row[3:5]]})
        write_url='https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values:batchUpdate'
        intent={'operation':'review-log-sync','spreadsheet_id':spreadsheet_id,'sheet_id':sheet['sheetId'],'before':before,'desired':desired}
        def submit():
            if read_rows()!=before:raise ValueError('Review Log changed before write')
            return self._request('POST',write_url,json.dumps({'valueInputOption':'RAW','data':data},ensure_ascii=False).encode())
        def verify(_):
            actual=read_rows()
            if actual!=desired:raise ValueError('Review Log readback or owner-minute preservation failed')
        self._write(state_dir,intent,submit,verify);verify(None)
        return {'status':'synced','sheet_id':sheet['sheetId'],'rows':desired}

    def _prune_archived_releases(self, spreadsheet_id, sheet_id, state_dir, archived):
        """Remove old internal channel rows after Content History retains the review."""
        raw = self._raw_release_values
        before = raw(spreadsheet_id, sheet_id)
        selected = [(index, row[0]) for index, row in enumerate(before[1:], 1) if row[0] in archived]
        if not selected:
            return
        removed = {key for _, key in selected}
        desired = [before[0]] + [row for row in before[1:] if row[0] not in removed]
        requests = [{'deleteDimension':{'range':{'sheetId':sheet_id,'dimension':'ROWS','startIndex':index,'endIndex':index+1}}}
                    for index, _ in reversed(selected)]
        requests.append({'appendDimension':{'sheetId':sheet_id,'dimension':'ROWS','length':len(selected)}})
        url = 'https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+':batchUpdate'
        def submit():
            if raw(spreadsheet_id, sheet_id) != before:
                raise ValueError('Releases changed before pruning archived channels')
            return self._request('POST', url, json.dumps({'requests':requests}).encode())
        def verify(_):
            if raw(spreadsheet_id, sheet_id) != desired:
                raise ValueError('Archived release pruning readback mismatch')
        self._write(state_dir, {'operation':'prune-archived-releases','sheet':spreadsheet_id,
                                'sheet_id':sheet_id,'before':before,'removed':sorted(removed)}, submit, verify)
        verify(None)

    def sync_releases(self,spreadsheet_id,sheet_id,queue,state_dir):
        """Refresh native Releases A:K, preserve L:N, import exact owner decisions.

        Uses an existing metadata-verified tab; never creates accounts, IDs or
        a tab. Existing row order is retained. New rows get blank owner cells.
        Any unresolved prior submission for this table blocks further writes.
        Read/write is guarded, not a Sheets atomic compare-and-swap operation.
        """
        import review_queue
        _id(spreadsheet_id)
        if type(sheet_id) is not int or sheet_id<0:raise ValueError('Verified numeric Releases sheet ID required')
        state=engine.physical_path(state_dir);state.mkdir(parents=True,exist_ok=True,mode=0o700)
        scope={'operation':'releases-sync','sheet':spreadsheet_id,'sheet_id':sheet_id}
        lock_name=hashlib.sha256(engine.canonical(scope)).hexdigest()+'.releases-lock'
        with (state/lock_name).open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            for file in state.glob('*.json'):
                saved=json.loads(file.read_text())
                if saved.get('status')=='uncertain' and all(saved.get('intent',{}).get(k)==v for k,v in scope.items()):raise UncertainWrite('Prior Releases sync uncertain; reconcile retained intent before refreshing')
            archived = self._archived_release_ids() if hasattr(self, '_archived_release_ids') else set()
            if archived:
                self._prune_archived_releases(spreadsheet_id, sheet_id, state_dir, archived)
            before=self._release_values(spreadsheet_id,sheet_id)
            import feedback
            feedback.scan(queue,before)
            exports=review_queue.release_rows(queue,archived);expected={row[0]:row for row in exports[1:]}
            desired=[before[0].copy()];updates=[];seen=set()
            for index,row in enumerate(before[1:],2):
                if row[0] not in expected:
                    source=queue.db.execute('SELECT media_sha256 FROM feedback_sources WHERE release_id=?',(row[0],)).fetchone()
                    if row[14]=='Archived' and source is not None and source[0]==row[8]:
                        desired.append(row.copy());continue
                    raise ValueError('Native release not in local durable queue; reconcile before refreshing')
                exact=expected[row[0]];seen.add(row[0])
                if row[:11]!=exact[:11]:
                    if any(row[11:14]):
                        if row[:9]!=exact[:9] or row[10]!=exact[10]:raise ValueError('Reviewed release fields changed; preserve owner decision and reconcile')
                        updates.append({'range':f"'Releases'!J{index}:J{index}",'values':[[exact[9]]]})
                    else:updates.append({'range':f"'Releases'!A{index}:K{index}",'values':[exact[:11]]})
                if row[14:16]!=exact[14:16]:updates.append({'range':f"'Releases'!O{index}:P{index}",'values':[exact[14:16]]})
                desired.append(exact[:11]+row[11:14]+exact[14:16])
            for exact in exports[1:]:
                if exact[0] in seen:continue
                if hasattr(self,'_project_release_owner'):exact=self._project_release_owner(exact)
                if len(desired)>=201:raise ValueError('Releases exceeds bounded 200 records')
                index=len(desired)+1
                updates.append({'range':f"'Releases'!A{index}:P{index}",'values':[exact]})
                desired.append(exact.copy())
            if updates:
                if self._release_values(spreadsheet_id,sheet_id)!=before:
                    raise ValueError('Releases changed before write; refresh')
                payload={'valueInputOption':'RAW','data':updates}
                def submit():
                    return self._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+spreadsheet_id+'/values:batchUpdate',json.dumps(payload).encode())
                def verify(receipt):
                    if self._release_values(spreadsheet_id,sheet_id)!=desired:raise ValueError('Releases readback mismatch or concurrent owner edit')
                self._write(state,{**scope,'before':before,'desired':desired},submit,verify)
            actual=self._release_values(spreadsheet_id,sheet_id)
            if actual!=desired:raise ValueError('Releases changed during synchronization; import deferred')
            review_queue.import_decisions(queue,[actual[0]]+[row for row in actual[1:] if row[0] in expected])
            return actual
