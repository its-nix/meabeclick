"""One owner decision per exact content version; channel delivery stays internal."""
import copy
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import quote

import engine
import feedback
from ops import instant
from google_sync import _atomic

HEADERS=['content_id','Content','Watch this video','Approve ✓','Listened ✓','feedback','scheduled_at','caption','Status','Platform results','media_sha256','listening_required']
IMMUTABLE=(0,1,2,6,7,10,11)


def binding(package):
    return {k:package.get(k) for k in ('artifact_id','media_sha256','caption','cta','scheduled_at','preview_url')} | {'revision_id':package.get('drive_receipt',{}).get('revision_id')}


def content_id(package):return feedback._hash(binding(package))


class Review:
    def __init__(self,google,cfg,queue,root):
        self.google=google;self.cfg=cfg;self.queue=queue;self.root=Path(root)
        self.path=self.root/'content-review-bindings.json'
        self.state=json.loads(self.path.read_text()) if self.path.exists() else {'groups':{},'members':{}}
        self.raw=google._release_values
        self.metadata_checked=False

    def read(self):
        if not self.metadata_checked:
            meta=self.google._request('GET','https://sheets.googleapis.com/v4/spreadsheets/'+self.cfg['spreadsheet_id']+'?fields=sheets(properties(sheetId,title))')
            matches=[s for s in meta.get('sheets',[]) if s.get('properties',{}).get('sheetId')==self.cfg['content_review_sheet_id']]
            if len(matches)!=1 or matches[0]['properties'].get('title')!='Content':raise ValueError('Configured content sheet identity changed')
            self.metadata_checked=True
        url='https://sheets.googleapis.com/v4/spreadsheets/'+self.cfg['spreadsheet_id']+'/values/'+quote("'Content'!A1:L201",safe='')+'?valueRenderOption=UNFORMATTED_VALUE'
        values=self.google._request('GET',url).get('values',[])
        if not values or values[0]!=HEADERS or len(values)>201:raise ValueError('Content review schema or bounds changed')
        rows=[]
        for row in values:
            if not isinstance(row,list) or len(row)>12:raise ValueError('Malformed content row')
            rows.append(row+['']*(12-len(row)))
        while len(rows)>1 and not any(rows[-1][:3]+rows[-1][5:]) and all(v is False or v=='' for v in rows[-1][3:5]):rows.pop()
        seen=set()
        for row in rows[1:]:
            key=row[0]
            if not key or key in seen:raise ValueError('Blank or duplicate content ID')
            seen.add(key)
            if key not in self.state['groups'] or [row[i] for i in IMMUTABLE]!=self.state['groups'][key]['row']:raise ValueError('Content binding changed; fresh exact review required')
            if any(type(v) is not bool for v in row[3:5]):raise ValueError('Content decisions require native boolean checkboxes')
            feedback.normalize(row[5])
        if any(group.get('registered') and not group.get('archived') and key not in seen for key,group in self.state['groups'].items()):
            raise ValueError('Previously registered content row missing; owner decisions require reconciliation')
        return rows

    def _history(self,create=False):
        sid=self.cfg['spreadsheet_id'];url='https://sheets.googleapis.com/v4/spreadsheets/'+sid+'?fields=sheets(properties(sheetId,title))'
        metadata=self.google._request('GET',url);matches=[s['properties'] for s in metadata.get('sheets',[]) if s.get('properties',{}).get('title')=='Content History']
        if len(matches)>1:raise ValueError('Duplicate Content History tabs')
        if not matches:
            if not create:return [HEADERS]
            create_url='https://sheets.googleapis.com/v4/spreadsheets/'+sid+':batchUpdate'
            def submit():return self.google._request('POST',create_url,json.dumps({'requests':[{'addSheet':{'properties':{'title':'Content History','gridProperties':{'rowCount':2001,'columnCount':12}}}}]}).encode())
            def verify(receipt):
                created=receipt.get('replies',[{}])[0].get('addSheet',{}).get('properties',{})
                found=[s.get('properties',{}) for s in self.google._request('GET',url).get('sheets',[]) if s.get('properties',{}).get('title')=='Content History']
                if len(found)!=1 or found[0].get('sheetId')!=created.get('sheetId'):raise ValueError('Content History creation readback mismatch')
            receipt=self.google._write(self.root/'google-intents',{'operation':'create-content-history','spreadsheet_id':sid,'title':'Content History'},submit,verify)
            matches=[receipt.get('replies',[{}])[0].get('addSheet',{}).get('properties',{})]
        sheet=matches[0]
        configured=self.cfg.get('content_history_sheet_id')
        if configured is not None and (type(configured) is not int or configured!=sheet.get('sheetId')):raise ValueError('Configured Content History sheet ID changed')
        read_url='https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values/'+quote("'Content History'!A1:L2001",safe='')+'?valueRenderOption=UNFORMATTED_VALUE'
        values=self.google._request('GET',read_url).get('values',[])
        if not values:
            header_url='https://sheets.googleapis.com/v4/spreadsheets/'+sid+'/values/'+quote("'Content History'!A1:L1",safe='')+'?valueInputOption=RAW'
            def write_header():return self.google._request('PUT',header_url,json.dumps({'values':[HEADERS]}).encode())
            def verify_header(_):
                if self.google._request('GET',read_url).get('values')!=[HEADERS]:raise ValueError('Content History header readback mismatch')
            self.google._write(self.root/'google-intents',{'operation':'initialize-content-history','spreadsheet_id':sid,'sheet_id':sheet['sheetId'],'headers':HEADERS},write_header,verify_header)
            values=[HEADERS]
        if values[0]!=HEADERS or len(values)>2001:raise ValueError('Content History schema or bounds changed')
        rows=[row+['']*(12-len(row)) for row in values]
        keys=[row[0] for row in rows[1:]]
        if any(not key for key in keys) or len(keys)!=len(set(keys)):raise ValueError('Content History IDs must be complete and unique')
        return rows

    def owner_rows(self):
        active=self.read();history=self._history(create=False);seen={row[0] for row in active[1:]}
        return active+([row for row in history[1:] if row[0] not in seen] if history else [])

    def archive_completed(self,now=None,threshold=180,limit=50,age_days=30):
        """Move only old terminal rows to Content History, verify, then delete active rows."""
        before=self.read()
        if len(before)<threshold:return 0
        current=instant(now or datetime.now(timezone.utc));cutoff=current-timedelta(days=age_days)
        candidates=[]
        for index,row in enumerate(before[1:],2):
            if row[8] not in ('Published','Failed','Archived'):continue
            try:scheduled=instant(row[6])
            except (ValueError,TypeError):continue
            if scheduled<cutoff:candidates.append((index,row))
        selected=candidates[:limit]
        if not selected:return 0
        history=self._history(create=True);by_id={row[0]:row for row in history[1:]};add=[]
        for _,row in selected:
            if row[0] in by_id:
                if by_id[row[0]]!=row:raise ValueError('Archived content binding differs from the active owner row')
            else:add.append(row)
        if add:
            append_url='https://sheets.googleapis.com/v4/spreadsheets/'+self.cfg['spreadsheet_id']+'/values/'+quote("'Content History'!A:L",safe='')+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS'
            expected=history+add
            def submit_history():
                if self._history(create=False)!=history:raise ValueError('Content History changed before archival')
                return self.google._request('POST',append_url,json.dumps({'values':add},ensure_ascii=False).encode())
            def verify_history(_):
                actual=self._history(create=False)
                if any(row not in actual[1:] for row in add):raise ValueError('Content History archival readback mismatch')
            self.google._write(self.root/'google-intents',{'operation':'archive-content-history','before':history,'additions':add,'desired':expected},submit_history,verify_history)
            verify_history(None)
        removed={row[0] for _,row in selected};desired=[before[0]]+[row for row in before[1:] if row[0] not in removed]
        for key in removed:
            if key in self.state['groups']:self.state['groups'][key]['archived']=True
        _atomic(self.path,self.state)
        requests=[{'deleteDimension':{'range':{'sheetId':self.cfg['content_review_sheet_id'],'dimension':'ROWS','startIndex':index-1,'endIndex':index}}} for index,_ in sorted(selected,reverse=True)]
        if self.cfg.get('daily_calendar_enabled'):
            requests.append({'appendDimension':{'sheetId':self.cfg['content_review_sheet_id'],'dimension':'ROWS','length':len(selected)}})
        def submit_delete():
            if self.read()!=before:raise ValueError('Content review changed before archival removal')
            return self.google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+self.cfg['spreadsheet_id']+':batchUpdate',json.dumps({'requests':requests}).encode())
        def verify_delete(_):
            if self.read()!=desired:raise ValueError('Archived active rows did not reconcile exactly')
        self.google._write(self.root/'google-intents',{'operation':'remove-archived-content','before':before,'desired':desired,'content_ids':sorted(removed)},submit_delete,verify_delete)
        verify_delete(None)
        return len(removed)

    def register(self,raw):
        lookup={r[0]:r for r in raw[1:]};groups={}
        for job in self.queue.rows():groups.setdefault(content_id(job['package']),[]).append(job)
        for key,jobs in groups.items():
            p=jobs[0]['package']
            if key not in self.state['groups']:
                post=engine.verify(p['bundle'])['payload']['job'].get('post',{})
                title=post.get('title') or {'P002':'Rectangles','P003':'Add 18'}.get(post.get('id'),post.get('id','Video'))
                comment=next((lookup[j['id']][13] for j in jobs if j['id'] in lookup and lookup[j['id']][13]),'')
                carry=self.cfg.get('content_review_carry_approvals') and any(j['approval_sha']==j['id'] and j['status'] in ('approved','uncertain','scheduled','published') for j in jobs)
                listened=bool(carry and any(j['listened'] for j in jobs if j['approval_sha']==j['id']))
                self.state['groups'][key]={'row':[key,title[:48],p['preview_url'],p['scheduled_at'],p['caption'],p['media_sha256'],'Yes' if p.get('qa',{}).get('listening_required') else 'No'],'feedback':comment,'approved':bool(carry),'listened':listened}
            for job in jobs:
                self.state['members'].setdefault(job['id'],{'content':key,'feedback':lookup.get(job['id'],['']*16)[13]})
        _atomic(self.path,self.state)
        return groups

    def overlay(self,sid,sheet):
        raw=self.raw(sid,sheet)
        if sid!=self.cfg['spreadsheet_id'] or sheet!=self.cfg['releases_sheet_id']:return raw
        public={r[0]:r for r in self.owner_rows()[1:]}
        return [raw[0]]+[self.project(row,public) for row in raw[1:]]

    def project(self,source,public=None):
        row=source.copy();member=self.state['members'].get(row[0])
        # New correction rows keep their verified comment until sync registers
        # their fresh unchecked content row at the end of the feedback stage.
        if member is None:return row
        if public is None:public={r[0]:r for r in self.owner_rows()[1:]}
        owner=public.get(member['content'])
        if owner is None:raise ValueError('Registered content review row missing')
        baseline=self.state['groups'][member['content']]
        row[11:14]=[owner[3],owner[4],member['feedback'] if owner[5]==baseline['feedback'] else owner[5]]
        job=self.queue.db.execute('SELECT * FROM jobs WHERE id=?',(row[0],)).fetchone()
        if job and job['status'] in ('uncertain','scheduled','published'):
            # Approval withdrawal stops pending copies, not accepted Buffer writes.
            row[11:13]=[job['approval_sha']==job['id'],bool(job['listened'])]
        return row

    def archived_release_ids(self):
        """Content History already retains the exact owner row and feedback."""
        if not self.cfg.get('daily_calendar_enabled'):
            return set()
        return {release for release, member in self.state['members'].items()
                if self.state['groups'].get(member['content'], {}).get('archived')}

    def refresh_decisions(self, release_id=None):
        """Read current owner decisions and refresh one exact release before submission."""
        import review_queue
        rows=self.overlay(self.cfg['spreadsheet_id'],self.cfg['releases_sheet_id'])
        feedback.scan(self.queue,rows)
        current={j['id'] for j in self.queue.rows()}
        active=[r for r in rows[1:] if r[0] in current]
        if release_id is not None:
            active=[r for r in active if r[0]==release_id]
            if len(active)!=1:raise ValueError('Expected one current exact release row')
        return review_queue.import_decisions(self.queue,[rows[0],*active])

    def status(self,jobs):
        labels={'review':'Awaiting approval','approved':'Ready to schedule','uncertain':'Needs reconciliation','scheduled':'Scheduled','published':'Published','failed':'Failed'}
        details=[];states={j['status'] for j in jobs};blocked=False;expired=False
        notes=feedback.status_rows(self.queue)
        for job in sorted(jobs,key=lambda j:(j['network'],j['account'])):
            label=labels.get(job['status'],job['status'])
            if job['status']=='failed' and not job.get('receipt'):
                label='Slot elapsed before scheduling'
            if job['status'] in ('review','approved') and instant(job['package']['scheduled_at'])<=datetime.now(timezone.utc):
                label='Schedule passed; needs a new time';expired=True
            if feedback.blocked(self.queue,job['id']):label=notes.get(job['id'],['Held'])[0];blocked=True
            details.append(job['network'].capitalize()+': '+label)
        if blocked:state='Feedback held'
        elif 'uncertain' in states:state='Needs reconciliation'
        elif expired:state='Needs new time'
        elif states <= {'published'}:state='Published'
        elif states <= {'published','failed'}:state='Failed'
        elif states <= {'scheduled','published'}:state='Scheduled'
        elif states & {'scheduled','published'}:state='Partly scheduled'
        elif 'failed' in states:state='Failed'
        elif states <= {'approved'}:state='Scheduling'
        else:state='Ready for review'
        summaries=list(dict.fromkeys(notes[j['id']][1] for j in jobs if j['id'] in notes and notes[j['id']][1]))
        return [state,'; '.join(details)+('. '+ ' '.join(summaries) if summaries else '')]

    def sync(self):
        self.archive_completed(threshold=70 if self.cfg.get('daily_calendar_enabled') else 180)
        groups=self.register(self.raw(self.cfg['spreadsheet_id'],self.cfg['releases_sheet_id']))
        before=self.read();desired=copy.deepcopy(before);seen=set();updates=[];hidden=[]
        for index,row in enumerate(desired[1:],2):
            key=row[0];seen.add(key)
            status=self.status(groups[key]) if key in groups else ['Archived','Replaced by a new content version; prior owner decisions retained.']
            if row[8:10]!=status:
                row[8:10]=status;updates.append({'range':f"'Content'!I{index}:J{index}",'values':[status]})
            if key not in groups:hidden.append(index)
        for key,jobs in sorted(groups.items(),key=lambda item:item[1][0]['package']['scheduled_at']):
            if key in seen:continue
            saved=self.state['groups'][key]
            if saved.get('archived'):continue
            row=saved['row'][:3]+[saved['approved'],saved['listened'],saved['feedback']]+saved['row'][3:5]+self.status(jobs)+saved['row'][5:]
            desired.append(row);index=len(desired)
            updates.append({'range':f"'Content'!A{index}:L{index}",'values':[row]})
        if len(desired)>201:raise ValueError('Content history capacity reached')
        if updates:
            def submit():
                if self.read()!=before:raise ValueError('Owner changed content review before write')
                return self.google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+self.cfg['spreadsheet_id']+'/values:batchUpdate',json.dumps({'valueInputOption':'RAW','data':updates}).encode())
            def verify(_):
                if self.read()!=desired:raise ValueError('Content review readback or concurrent owner edit')
            self.google._write(self.root/'google-intents',{'operation':'content-review-sync','before':before,'desired':desired},submit,verify)
            verify(None)
        if hidden:
            requests=[{'updateDimensionProperties':{'range':{'sheetId':self.cfg['content_review_sheet_id'],'dimension':'ROWS','startIndex':i-1,'endIndex':i},'properties':{'hiddenByUser':True},'fields':'hiddenByUser'}} for i in hidden]
            self.google._request('POST','https://sheets.googleapis.com/v4/spreadsheets/'+self.cfg['spreadsheet_id']+':batchUpdate',json.dumps({'requests':requests}).encode())
        for row in desired[1:]:self.state['groups'][row[0]]['registered']=True
        _atomic(self.path,self.state)
        return desired


def attach(google,cfg,queue,root):
    review=Review(google,cfg,queue,root)
    google._release_values=review.overlay
    google._project_release_owner=review.project
    google._archived_release_ids=review.archived_release_ids
    google._raw_release_values=review.raw
    return review
