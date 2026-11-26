import json
from pathlib import Path
import tempfile
import unittest
import google_sync
from test_creative_fixtures import tiny_video, attest

class SyncTests(unittest.TestCase):
    def test_review_log_creates_tab_and_preserves_owner_minutes(self):
        from urllib.parse import unquote
        sheets=[];rows=[]
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            if method=='GET' and '?fields=sheets' in url:return {'sheets':[{'properties':{'sheetId':s['sheetId'],'title':s['title']},'protectedRanges':s.get('protectedRanges',[])} for s in sheets]}
            if method=='POST' and url.endswith(':batchUpdate') and '/values:' not in url:
                payload=json.loads(body);request=payload['requests'][0]
                if 'addSheet' in request:
                    props=request['addSheet']['properties'];created={'sheetId':9,**props,'protectedRanges':[]};sheets.append(created)
                    return {'replies':[{'addSheet':{'properties':created}}]}
                protection=request['addProtectedRange']['protectedRange'];sheets[0]['protectedRanges'].append({k:v for k,v in protection.items() if k!='warningOnly'})
                return {'replies':[{'addProtectedRange':{'protectedRange':protection}}]}
            if method=='GET' and '/values/' in url:return {'values':[r.copy() for r in rows]}
            if method=='PUT' and '/values/' in url:rows.extend(json.loads(body)['values']);return {'updatedRows':1}
            if method=='POST' and url.endswith('/values:batchUpdate'):
                for item in json.loads(body)['data']:
                    ref=unquote(item['range']).split('!')[1];first,last=ref.split(':');col=''.join(c for c in first if c.isalpha());rownum=int(''.join(c for c in first if c.isdigit()))
                    values=item['values'][0]
                    while len(rows)<rownum:rows.append(['']*5)
                    for offset,value in enumerate(values):
                        target_col=ord(col)-65+offset;target=rows[rownum-1]
                        while len(target)<=target_col:target.append('')
                        target[target_col]=value
                return {'totalUpdatedRows':1}
            raise AssertionError((method,url))
        client=google_sync.GoogleSync(self.credentials(),transport)
        client._write=lambda _state,intent,submit,verify:(lambda receipt:(verify(receipt),receipt)[1])(submit())
        with tempfile.TemporaryDirectory() as raw:
            first=client.sync_review_log('sheet',[{'batch_id':'review-2026-W47','planned_count':2,'completed_at':'','worker_note':'In review'}],raw)
            self.assertEqual(first['sheet_id'],9);self.assertEqual(rows[0],google_sync.REVIEW_LOG_HEADERS)
            rows[1][2]=24
            second=client.sync_review_log('sheet',[{'batch_id':'review-2026-W47','planned_count':2,'completed_at':'2026-11-18T20:00:00+02:00','worker_note':'Complete'}],raw,sheet_id=9)
        self.assertEqual(second['rows'][1][2],24)
        self.assertEqual(second['rows'][1][3],'2026-11-18T20:00:00+02:00')

    def test_prune_archived_channels_preserves_active_review_and_sheet_size(self):
        rows = [['header'], ['archived-a','A'], ['active','Keep'], ['archived-b','B']]
        calls = []
        def transport(method,url,headers,body):
            if 'oauth2' in url:
                return {'access_token':'a','expires_in':3600}
            requests = json.loads(body)['requests']
            calls.extend(requests)
            for request in requests:
                if 'deleteDimension' in request:
                    bounds=request['deleteDimension']['range']
                    del rows[bounds['startIndex']:bounds['endIndex']]
            return {}
        client = google_sync.GoogleSync(self.credentials(), transport)
        client._raw_release_values = lambda *_: [r.copy() for r in rows]
        with tempfile.TemporaryDirectory() as root:
            client._prune_archived_releases('sheet', 9, Path(root).resolve(), {'archived-a','archived-b'})
            client._prune_archived_releases('sheet', 9, Path(root).resolve(), {'archived-a','archived-b'})
        self.assertEqual(rows,[['header'],['active','Keep']])
        self.assertEqual(len(calls),3)
        self.assertEqual(calls[-1],{'appendDimension':{'sheetId':9,'dimension':'ROWS','length':2}})

    def test_preview_must_match_frozen_bytes_and_canonical_drive_link(self):
        import hashlib
        metadata={'id':'file1','size':'5','md5Checksum':hashlib.md5(b'video').hexdigest()}
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            return metadata.copy()
        c=google_sync.GoogleSync(self.credentials(),transport)
        with tempfile.TemporaryDirectory() as raw:
            media=Path(raw).resolve()/'asset.mp4';media.write_bytes(b'video')
            self.assertTrue(c.verify_preview(media,'https://drive.google.com/file/d/file1/view'))
            metadata['headRevisionId']='r1'
            self.assertTrue(c.verify_preview(media,'https://drive.google.com/file/d/file1/view',expected_revision_id='r1'))
            with self.assertRaisesRegex(ValueError,'revision changed'):c.verify_preview(media,'https://drive.google.com/file/d/file1/view',expected_revision_id='r0')
            metadata['md5Checksum']='changed'
            with self.assertRaises(ValueError):c.verify_preview(media,'https://drive.google.com/file/d/file1/view')
            with self.assertRaises(ValueError):c.verify_preview(media,'https://evil.test/file/d/file1/view')
    def test_native_ideas_preserve_fields_and_reject_schema_or_id_ambiguity(self):
        names=['Idea ID','Format','Example','Audience','Purpose','Production dependency','Status']
        records=[['I001','Visual explanation','Compare fractions','Teens','Understanding','Needs template','Idea']]
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            sheets=[]
            for title in ('Queue','Components','Recipes','Ideas'):
                rows=[names if title=='Ideas' else google_sync.EDITORIAL_HEADERS[title]]
                if title=='Ideas':rows+=records
                sheets.append({'properties':{'title':title},'data':[{'startRow':4,'rowData':[{'values':[{'userEnteredValue':{'stringValue':v}} for v in row]} for row in rows]}]})
            return {'sheets':sheets}
        client=google_sync.GoogleSync(self.credentials(),transport)
        bounds={title:30 for title in ('Queue','Components','Recipes','Ideas')}
        self.assertEqual(client.snapshot('sheet',bounds,'batch')['ideas'],records)
        names[2],names[3]=names[3],names[2]
        with self.assertRaisesRegex(ValueError,'Ideas header'):client.snapshot('sheet',bounds,'batch')
        names[2],names[3]=names[3],names[2]
        records.append(records[0].copy())
        with self.assertRaisesRegex(ValueError,'duplicate ID'):client.snapshot('sheet',bounds,'batch')


    def test_generated_ideas_append_without_overwriting_existing_rows(self):
        import urllib.parse
        headers=google_sync.EDITORIAL_HEADERS['Ideas']
        rows=[headers,['I001','Visual explanation','existing owner idea','Teens','Understanding','Needs template','Idea']]
        writes=[]
        def transport(method,url,request_headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            if method=='GET':return {'values':[row.copy() for row in rows]}
            writes.append((method,url,body))
            payload=json.loads(body);new=payload['values']
            rows.extend(new)
            return {'updates':{'updatedRows':len(new)}}
        client=google_sync.GoogleSync(self.credentials(),transport)
        def safe_write(state,intent,submit,verify):
            result=submit();verify(result);return {'status':'verified'}
        client._write=safe_write
        concept={'id':'C123','payload':{'format':'fraction-compare','hook_he':'איזה חלק גדול יותר?',
          'premise':'שתי רצועות שוות מציגות שברים שונים.','audience':'Teens','payoff':'משווים את אותו שלם.',
          'production_requirements':['fraction-strips']}}
        with tempfile.TemporaryDirectory() as d:
            result=client.append_generated_ideas('sheet',[concept],Path(d).resolve())
        self.assertEqual(result['appended'],1)
        self.assertEqual(rows[1][0],'I001')
        self.assertEqual(rows[2][0],'AI-C123')
        self.assertEqual(len(writes),1)
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(client.append_generated_ideas('sheet',[concept],Path(d).resolve())['appended'],0)
        self.assertEqual(len(writes),1)

    def test_refresh_and_bounded_ranges(self):
        calls=[]
        def transport(method,url,headers,body):
            calls.append((method,url,headers,body))
            if 'oauth2' in url:return {'access_token':'access','expires_in':3600}
            return {'sheets':[]}
        client=google_sync.GoogleSync({'type':'authorized_user','client_id':'client','client_secret':'secret','refresh_token':'refresh'},transport)
        client.read_cells('sheet',{'Queue':20,'Components':20,'Recipes':20})
        self.assertEqual(len(calls),2)
        self.assertIn('refresh_token=refresh',calls[0][3].decode())
        self.assertIn('Queue%27%21A5%3AQ20',calls[1][1])
        with self.assertRaises(ValueError):client.read_cells('sheet',{'Students':20})
        with self.assertRaises(ValueError):client.read_cells('sheet',{'Queue':5000})
    def test_snapshot_rejects_reordered_native_headers(self):
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            cells=[]
            for title in ('Queue','Components','Recipes'):
                names=list(google_sync.EDITORIAL_HEADERS[title])
                if title=='Queue':names[3],names[4]=names[4],names[3]
                cells.append({'properties':{'title':title},'data':[{'startRow':4,'rowData':[{'values':[{'userEnteredValue':{'stringValue':name}} for name in names]}]}]})
            return {'sheets':cells}
        client=google_sync.GoogleSync(self.credentials(),transport)
        with self.assertRaisesRegex(ValueError,'Queue header'):
            client.snapshot('sheet',{'Queue':20,'Components':20,'Recipes':20},'batch')

    def test_snapshot_pads_api_omitted_trailing_blank_cells(self):
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            sheets=[]
            for title,names in google_sync.EDITORIAL_HEADERS.items():
                rows=[{'values':[{'userEnteredValue':{'stringValue':n}} for n in names]}]
                if title=='References':rows.append({'values':[{'userEnteredValue':{'stringValue':v}} for v in ['REF1','Title','source','time','Families','mechanism','use','avoid','reaction']]})
                sheets.append({'properties':{'title':title},'data':[{'startRow':4,'rowData':rows}]})
            return {'sheets':sheets}
        c=google_sync.GoogleSync(self.credentials(),transport)
        snapshot=c.snapshot('sheet',{t:20 for t in google_sync.EDITORIAL_HEADERS},'batch')
        self.assertEqual(snapshot['references'][0]['components'],[])

    def test_document_mirror_updates_in_place_and_detects_drive_edits(self):
        import hashlib
        content=[b'old'];writes=[]
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            if method=='PATCH':content[0]=body;writes.append(body)
            return {'id':'doc','mimeType':'text/markdown','size':str(len(content[0])),'md5Checksum':hashlib.md5(content[0]).hexdigest()}
        c=google_sync.GoogleSync(self.credentials(),transport)
        with tempfile.TemporaryDirectory() as raw:
            root=Path(raw).resolve();p=root/'doc.md';p.write_bytes(b'old')
            self.assertEqual(c.mirror_document(p,'doc',root/'state')['status'],'unchanged')
            p.write_bytes(b'new');self.assertEqual(c.mirror_document(p,'doc',root/'state')['status'],'updated')
            self.assertEqual(content[0],b'new');self.assertEqual(writes,[b'new'])
            c.mirror_document(p,'doc',root/'state');self.assertEqual(len(writes),1)
            content[0]=b'owner changed Drive';p.write_bytes(b'next')
            with self.assertRaises(ValueError):c.mirror_document(p,'doc',root/'state')
            self.assertEqual(len(writes),1)

    def test_private_credential_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'credentials.json';p.write_text('{}');p.chmod(0o644)
            with self.assertRaises(ValueError):google_sync.load_credentials(p)
            p.chmod(0o600)
            with self.assertRaises(ValueError):google_sync.load_credentials(p)
    def test_uncertain_upload_blocks_replay(self):
        calls=[]
        def fail(*args):
            calls.append(args)
            if 'oauth2' in args[1]:return {'access_token':'a','expires_in':3600}
            raise TimeoutError()
        client=google_sync.GoogleSync(self.credentials(),fail)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();media=root/'clip.mp4';media.write_bytes(b'video')
            with self.assertRaises(google_sync.UncertainWrite):client.upload(media,'folder',root/'state')
            count=len(calls)
            with self.assertRaises(google_sync.UncertainWrite):client.upload(media,'folder',root/'state')
            self.assertEqual(count,len(calls))
    def test_successful_upload_is_verified_and_deduplicated(self):
        import hashlib
        calls=[]
        def transport(method,url,headers,body):
            calls.append((method,url))
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            return {'id':'file','size':'5','md5Checksum':hashlib.md5(b'video').hexdigest()}
        client=google_sync.GoogleSync(self.credentials(),transport)
        with tempfile.TemporaryDirectory() as d:
            root=Path(d).resolve();media=root/'clip.mp4';media.write_bytes(b'video')
            first=client.upload(media,'folder',root/'state')
            count=len(calls)
            self.assertEqual(first,client.upload(media,'folder',root/'state'))
            self.assertEqual(count,len(calls))
            media.write_bytes(b'x'*(google_sync.MAX_UPLOAD+1))
            with self.assertRaises(ValueError):client.upload(media,'folder',root/'state')
    def test_failed_oauth_is_a_readiness_gate(self):
        def transport(*args):raise RuntimeError('sensitive provider body')
        client=google_sync.GoogleSync(self.credentials(),transport)
        with self.assertRaisesRegex(google_sync.CredentialsUnavailable,'restore consent') as error:
            client.read_cells('sheet',{'Queue':20})
        self.assertNotIn('sensitive',str(error.exception))
    def credentials(self):return {'type':'authorized_user','client_id':'c','client_secret':'s','refresh_token':'r'}
    def test_candidate_preserves_owner_columns_and_readback(self):
        row=['P002','title','preview','caption','Approve','feedback','slot','goal','Review','alt','format','old','manifest','refs','gate','','']
        writes=[]
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            if method=='GET':return {'values':[row]}
            payload=json.loads(body);writes.append(payload)
            row[15:17]=payload['data'][0]['values'][0]
            return {'totalUpdatedCells':2}
        client=google_sync.GoogleSync(self.credentials(),transport)
        with tempfile.TemporaryDirectory() as d:
            before=row.copy()
            client.write_candidate('sheet',6,before,'P002-abc','https://drive.google.com/file/d/example',Path(d).resolve())
            self.assertEqual(row[:15],before[:15]);self.assertEqual(writes[0]['data'][0]['range'],"'Queue'!P6:Q6")
            self.assertEqual(writes[0]['valueInputOption'],'RAW')
    def test_changed_candidate_or_owner_blocks_write(self):
        row=['P002']+['']*16;current=row.copy();current[4]='Change'
        def transport(method,url,headers,body):
            if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
            if method=='GET':return {'values':[current]}
            self.fail('Must not write changed row')
        client=google_sync.GoogleSync(self.credentials(),transport)
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):client.write_candidate('sheet',6,row,'P002-abc','preview',Path(d).resolve())

class ReleasesTests(unittest.TestCase):
    def setUp(self):
        import engine,machine,review_queue
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        source=self.root/'source';source.mkdir();(source/'index.html').write_text('<html>fixture</html>')
        media=self.root/'video.mp4';tiny_video(media)
        bundle=engine.freeze({'post':{'id':'P002'}},source,media,self.root/'artifacts')
        self.queue=machine.Queue(self.root/'queue.sqlite3')
        package={'bundle':str(bundle),'caption':'Caption','cta':'educational','network':'instagram','account':'verified','scheduled_at':'2026-11-15T19:30:00+02:00','preview_url':'https://example.test/actual-preview','qa':{'artifact_id':bundle.name,'media_sha256':engine.sha(bundle/'asset.mp4'),'technical_pass':True,'listening_required':False}}
        package['creative_verification']=attest(bundle,package['caption'],package['cta'])
        self.key=self.queue.enqueue(package);self.exact=review_queue.release_rows(self.queue)
        self.rows=[self.exact[0].copy()];self.writes=[];self.fail=False
        self.client=google_sync.GoogleSync({'type':'authorized_user','client_id':'c','client_secret':'s','refresh_token':'r'},self.transport)
    def tearDown(self):
        self.queue.db.close();self.temp.cleanup()
    def transport(self,method,url,headers,body):
        if 'oauth2' in url:return {'access_token':'a','expires_in':3600}
        if 'fields=sheets(properties' in url:return {'sheets':[{'properties':{'sheetId':7,'title':'Releases'}}]}
        if method=='GET':return {'values':[row.copy() for row in self.rows]}
        payload=json.loads(body);self.writes.append(payload)
        if self.fail:raise TimeoutError()
        import re
        for update in payload['data']:
            match=re.search(r'!([A-Z]+)(\d+):',update['range']);index=int(match[2])-1
            column=0
            for char in match[1]:column=column*26+ord(char)-64
            column-=1
            while len(self.rows)<=index:self.rows.append(['']*16)
            values=update['values'][0];self.rows[index][column:column+len(values)]=values
        return {'totalUpdatedCells':sum(len(r['values'][0]) for r in payload['data'])}
    def sync(self):return self.client.sync_releases('sheet',7,self.queue,self.root/'state')
    def test_new_row_and_existing_owner_approval(self):
        self.sync();self.assertEqual(self.rows,self.exact)
        self.rows[1][11]='Approved'
        self.sync();self.assertEqual(len(self.writes),1)
        self.assertEqual(self.queue.get(self.key)['status'],'approved')
        self.assertEqual(self.rows[1][13],'')
    def test_new_feedback_preserves_comment_and_blocks_checked_approval(self):
        self.sync();self.rows[1][11]=True;self.rows[1][13]='Center the content'
        self.sync()
        self.assertEqual(self.rows[1][13],'Center the content')
        self.assertIs(self.rows[1][11],True)
        self.assertEqual(self.rows[1][14],'Pending')
        self.assertEqual(self.rows[1][9],'Blocked')
        self.assertEqual(self.queue.get(self.key)['status'],'review')

    def test_unreviewed_refresh_only_nonowner_columns(self):
        self.rows=[r.copy() for r in self.exact];self.rows[1][5]='old'
        self.sync()
        self.assertEqual(self.writes[0]['data'][0]['range'],"'Releases'!A2:K2")
    def test_header_and_reviewed_mismatch_reject(self):
        self.rows=[['wrong']]
        with self.assertRaises(ValueError):self.sync()
        self.rows=[r.copy() for r in self.exact];self.rows[1][5]='changed';self.rows[1][11]='Approved'
        with self.assertRaises(ValueError):self.sync()
        self.assertEqual(self.writes,[])
    def test_uncertain_blocks_even_when_remote_row_appears_later(self):
        self.fail=True
        with self.assertRaises(google_sync.UncertainWrite):self.sync()
        self.fail=False;self.rows=[r.copy() for r in self.exact]
        with self.assertRaises(google_sync.UncertainWrite):self.sync()
        self.assertEqual(len(self.writes),1)

    def test_edit_before_releases_write_leaves_no_uncertain_intent(self):
        self.rows = [row.copy() for row in self.exact]
        self.rows[1][9] = 'old status'
        read = self.client._release_values
        reads = 0

        def owner_edit(*args):
            nonlocal reads
            reads += 1
            if reads == 2:
                self.rows[1][13] = 'Please center the text'
            return read(*args)

        self.client._release_values = owner_edit
        with self.assertRaisesRegex(ValueError, 'Releases changed before write'):
            self.sync()
        self.assertEqual(self.writes, [])
        self.assertEqual(list((self.root / 'state').glob('*.json')), [])
        self.sync()
        self.assertEqual(len(self.writes), 1)
        self.assertEqual(self.rows[1][13], 'Please center the text')
    def test_existing_native_order_is_preserved(self):
        import review_queue
        package=dict(self.queue.get(self.key)['package'],network='facebook');other=self.queue.enqueue(package)
        exact=review_queue.release_rows(self.queue)
        self.rows=[exact[0],*list(reversed(exact[1:]))]
        order=[r[0] for r in self.rows[1:]]
        self.sync()
        self.assertEqual([r[0] for r in self.rows[1:]],order)
        self.assertEqual(self.writes,[])

    def test_trailing_native_checkbox_defaults_are_not_release_records(self):
        self.rows=[r.copy() for r in self.exact]+[['']*11+[False,False,''] for _ in range(4)]
        self.sync()
        self.assertEqual(self.writes,[])
        self.assertEqual(self.queue.get(self.key)['status'],'review')

    def test_checked_orphan_or_interior_checkbox_row_requires_reconciliation(self):
        for empty in (['']*11+[True,False,''],['']*11+[False,False,'feedback']):
            self.rows=[r.copy() for r in self.exact]+[empty]
            with self.assertRaises(ValueError):self.sync()
        self.rows=[self.exact[0],['']*11+[False,False,''],self.exact[1]]
        with self.assertRaises(ValueError):self.sync()
        self.assertEqual(self.writes,[])
    def test_unknown_native_release_fails_before_write(self):
        self.rows=[r.copy() for r in self.exact];self.rows[1][0]='unrecognized'
        with self.assertRaises(ValueError):self.sync()
        self.assertEqual(self.writes,[])
    def test_verified_sheet_id_required(self):
        with self.assertRaises(ValueError):self.client.sync_releases('sheet',8,self.queue,self.root/'state')
        self.assertEqual(self.writes,[])

if __name__=='__main__':unittest.main()
