"""Queue per-post renders in an uncredentialed renderer through a shared spool."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import time

import engine


class RenderClient:
    def __init__(self, spool, poll_seconds=1.0):
        self.spool=engine.physical_path(Path(spool));self.spool.mkdir(parents=True,exist_ok=True)
        self.poll_seconds=max(.01,float(poll_seconds))

    @staticmethod
    def _job_id(value):
        if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',value):raise ValueError('Invalid job ID')
        return value

    @staticmethod
    def _source_manifest(project):
        files=engine.source_files(project)
        metadata=Path(project)/'project-manifest.json'
        if metadata.is_file():
            try:excluded={item['path'] for item in json.loads(metadata.read_text()).get('remote_assets',[]) if isinstance(item,dict) and isinstance(item.get('path'),str)}
            except (OSError,json.JSONDecodeError):raise ValueError('Malformed generated project manifest')
            files=[item for item in files if item['path'] not in excluded]
        return files

    def stage(self, project, job_id, timeout=900):
        job_id=self._job_id(job_id)
        if type(timeout) is not int or not 1<=timeout<=1800:raise ValueError('Render timeout outside 1..1800 seconds')
        project=engine.physical_path(Path(project));files=self._source_manifest(project)
        source_manifest=[dict(item) for item in files]
        identity=hashlib.sha256(engine.canonical(source_manifest)).hexdigest()
        destination=self.spool/job_id
        if destination.exists():
            self.validate_request(destination)
            request=json.loads((destination/'request.json').read_text())
            if request['input_sha256']!=identity:raise ValueError('Job ID already binds different source')
            return {'status':'queued','job_id':job_id,'job_dir':destination,'input_sha256':identity,'source_manifest':source_manifest}
        self.spool.mkdir(parents=True,exist_ok=True)
        scratch=Path(tempfile.mkdtemp(prefix='.job-',dir=self.spool));(scratch/'input').mkdir();(scratch/'output').mkdir()
        try:
            for item in files:
                source=project/item['path'];target=scratch/'input'/item['path'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
            request={'schema':1,'job_id':job_id,'timeout_seconds':timeout,'input_sha256':identity,'source_manifest':source_manifest}
            (scratch/'request.json').write_text(json.dumps(request,sort_keys=True,indent=2)+'\n')
            scratch.rename(destination)
        except BaseException:
            shutil.rmtree(scratch,ignore_errors=True);raise
        return {'status':'queued','job_id':job_id,'job_dir':destination,'input_sha256':identity,'source_manifest':source_manifest}

    def validate_request(self, job_dir):
        job_dir=engine.physical_path(Path(job_dir))
        request=json.loads((job_dir/'request.json').read_text())
        job_id=self._job_id(request.get('job_id'))
        if job_dir.name!=job_id or request.get('schema')!=1:raise ValueError('Renderer job identity mismatch')
        if type(request.get('timeout_seconds')) is not int or not 1<=request['timeout_seconds']<=1800:raise ValueError('Invalid renderer timeout')
        actual=self._source_manifest(job_dir/'input')
        if actual!=request.get('source_manifest') or hashlib.sha256(engine.canonical(actual)).hexdigest()!=request.get('input_sha256'):
            raise ValueError('Renderer source hash mismatch')
        return request

    def collect(self, job_id):
        job_id=self._job_id(job_id);job_dir=self.spool/job_id;request=self.validate_request(job_dir)
        result_path=job_dir/'result.json'
        if not result_path.is_file():return {'status':'running','job_id':job_id,'job_dir':job_dir}
        result=json.loads(result_path.read_text())
        if result.get('job_id')!=job_id or result.get('input_sha256')!=request['input_sha256']:raise ValueError('Renderer result/job binding mismatch')
        if result.get('status')!='ready':return {'status':result.get('status','held'),'job_id':job_id,'reason':result.get('reason','render held')}
        relative=result.get('media_path')
        if not isinstance(relative,str) or Path(relative).is_absolute() or '..' in Path(relative).parts:raise ValueError('Invalid renderer media path')
        media=engine.physical_path(job_dir/relative)
        if media.is_symlink() or not media.is_file() or engine.sha(media)!=result.get('media_sha256'):raise ValueError('Renderer media hash mismatch')
        if result.get('source_manifest')!=request['source_manifest']:raise ValueError('Renderer source result mismatch')
        return {'status':'ready','job_id':job_id,'job_dir':job_dir,'media_path':media,
                'source_manifest':result['source_manifest'],'asset_manifest':result.get('asset_manifest',[]),
                'render_log':result.get('render_log',''),'media_sha256':result['media_sha256'],
                'input_sha256':request['input_sha256']}

    def wait(self, job_id, timeout=1800):
        deadline=time.monotonic()+timeout
        while time.monotonic()<deadline:
            result=self.collect(job_id)
            if result['status']!='running':return result
            time.sleep(self.poll_seconds)
        raise TimeoutError('Renderer job exceeded its wait deadline')

    def cleanup(self, job_id):
        job_id=self._job_id(job_id);job_dir=self.spool/job_id
        if job_dir.exists():
            request=self.validate_request(job_dir)
            if not (job_dir/'result.json').is_file():raise ValueError('Cannot clean an unfinished render')
            shutil.rmtree(job_dir)


def render_into(project, output, *, spool):
    """Use the isolated renderer for a generated project's post-review corrections."""
    client = RenderClient(spool)
    source = client._source_manifest(project)
    identity = hashlib.sha256(engine.canonical(source)).hexdigest()
    job_id = 'revision-' + identity[:48]
    client.stage(project, job_id)
    result = client.wait(job_id)
    if result['status'] != 'ready':
        raise ValueError('Isolated revision render held: ' + result.get('reason', 'unknown'))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(result['media_path'], output)
    if engine.sha(output) != result['media_sha256']:
        raise ValueError('Isolated revision media checksum changed')
    return output
