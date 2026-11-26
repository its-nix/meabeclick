#!/usr/bin/env python3
"""Process one isolated generated project at a time from /spool."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import engine
from render_sandbox import RenderClient

MAX_ASSET_BYTES=5*1024*1024
ALLOWED_IMAGE_TYPES={'image/png','image/jpeg','image/webp'}


def _matches_image_type(data, content_type):
    if content_type=='image/png':return data.startswith(b'\x89PNG\r\n\x1a\n')
    if content_type=='image/jpeg':return data.startswith(b'\xff\xd8\xff')
    if content_type=='image/webp':return len(data)>=12 and data[:4]==b'RIFF' and data[8:12]==b'WEBP'
    return False


class HTTPSRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        if urllib.parse.urlsplit(newurl).scheme!='https':raise ValueError('Asset redirect must remain HTTPS')
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def fetch_remote_assets(job_dir, opener=None):
    job_dir=Path(job_dir);request=RenderClient(job_dir.parent).validate_request(job_dir)
    project_manifest=job_dir/'input'/'project-manifest.json'
    try:manifest=json.loads(project_manifest.read_text())
    except (OSError,json.JSONDecodeError):return []
    assets=manifest.get('remote_assets',[])
    if not isinstance(assets,list) or len(assets)>5:raise ValueError('Invalid remote asset list')
    opener=opener or urllib.request.build_opener(HTTPSRedirect())
    receipts=[]
    for asset in assets:
        if not isinstance(asset,dict) or not all(isinstance(asset.get(k),str) and asset[k].strip() for k in ('url','path','license','purpose')):raise ValueError('Remote asset provenance required')
        parsed=urllib.parse.urlsplit(asset['url'])
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password:raise ValueError('Remote asset must be a public HTTPS URL')
        relative=Path(asset['path'])
        if relative.is_absolute() or '..' in relative.parts or not re_asset_path(asset['path']):raise ValueError('Unsafe remote asset output path')
        target=job_dir/'input'/relative
        if target.exists():raise ValueError('Remote asset path already exists')
        req=urllib.request.Request(asset['url'],headers={'User-Agent':'MeaBeclickContentMachine/1.0'})
        response=opener.open(req,timeout=20)
        final=urllib.parse.urlsplit(response.geturl())
        if final.scheme!='https' or not final.hostname:raise ValueError('Asset fetch did not remain HTTPS')
        kind=response.headers.get_content_type()
        if kind not in ALLOWED_IMAGE_TYPES:raise ValueError('Unsupported remote asset content type')
        chunks=[];size=0
        while size<=MAX_ASSET_BYTES:
            chunk=response.read(min(65536,MAX_ASSET_BYTES+1-size))
            if not chunk:break
            chunks.append(chunk);size+=len(chunk)
        data=b''.join(chunks)
        if not 0<len(data)<=MAX_ASSET_BYTES:raise ValueError('Remote asset exceeds size limit')
        if not _matches_image_type(data,kind):raise ValueError('Remote asset bytes do not match the declared image type')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        receipts.append({'path':relative.as_posix(),'source_url':asset['url'],'resolved_url':response.geturl(),'license':asset['license'],'purpose':asset['purpose'],'content_type':kind,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    return receipts


def re_asset_path(value):
    import re
    return bool(re.fullmatch(r'assets/remote-[1-5]\.(png|jpe?g|webp)',value))


def render_project(project,output,timeout):
    executable='/app/node_modules/.bin/hyperframes'
    env={**os.environ,'HTTPS_PROXY':'http://egress:3128','https_proxy':'http://egress:3128',
         'HTTP_PROXY':'http://egress:3128','http_proxy':'http://egress:3128',
         'ALL_PROXY':'http://egress:3128','all_proxy':'http://egress:3128',
         'NO_PROXY':'localhost,127.0.0.1,::1','no_proxy':'localhost,127.0.0.1,::1'}
    result=subprocess.run([executable,'render','--quality','delivery','-o',str(output/'asset.mp4')],
                          cwd=project,capture_output=True,text=True,timeout=timeout,env=env)
    log=(result.stdout+'\n'+result.stderr)[-12000:]
    (output/'render.log').write_text(log)
    if result.returncode or not (output/'asset.mp4').is_file():raise RuntimeError('HyperFrames render failed')
    return log


def process_job(job_dir,renderer=render_project,asset_opener=None):
    job_dir=Path(job_dir);client=RenderClient(job_dir.parent);request=client.validate_request(job_dir)
    result_path=job_dir/'result.json'
    if result_path.is_file():return json.loads(result_path.read_text())
    output=job_dir/'output';output.mkdir(exist_ok=True)
    result={'schema':1,'job_id':request['job_id'],'input_sha256':request['input_sha256'],
            'status':'held','source_manifest':request['source_manifest'],'asset_manifest':[]}
    try:
        assets=fetch_remote_assets(job_dir,opener=asset_opener)
        result['asset_manifest']=assets
        log=renderer(job_dir/'input',output,request['timeout_seconds'])
        media=output/'asset.mp4'
        if not media.is_file() or media.is_symlink() or not media.stat().st_size:raise ValueError('Renderer output missing or empty')
        result.update(status='ready',media_path='output/asset.mp4',media_sha256=engine.sha(media),render_log=str(log)[-12000:])
    except Exception as exc:
        result.update(status='held',reason=type(exc).__name__)
    temporary=result_path.with_suffix('.tmp');temporary.write_text(json.dumps(result,ensure_ascii=False,sort_keys=True,indent=2)+'\n');temporary.replace(result_path)
    return result


def run(spool='/spool',interval=2):
    root=Path(spool);root.mkdir(parents=True,exist_ok=True)
    lock=(root/'.renderer.lock').open('a')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    while True:
        for job in sorted(root.iterdir()):
            if not job.is_dir() or job.name.startswith('.') or not (job/'request.json').is_file() or (job/'result.json').exists():continue
            process_job(job)
        time.sleep(interval)


if __name__=='__main__':run(os.environ.get('RENDER_SPOOL','/spool'))
