"""Run an independent, structured director review with at most two safe revisions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import engine
import audio_qa

HERE=Path(__file__).resolve().parent
HYPERFRAMES=HERE.parents[1]/'node_modules/.bin/hyperframes'


def command(args,cwd=None,timeout=180):
    try:
        result=subprocess.run([str(a) for a in args],cwd=cwd,capture_output=True,text=True,timeout=timeout)
    except subprocess.TimeoutExpired as exc:raise TimeoutError(f'{Path(str(args[0])).name} timed out') from exc
    if result.returncode:raise RuntimeError(f'{Path(str(args[0])).name} failed: {result.stderr[-1200:]}')
    return result.stdout


def evidence(bundle,directory):
    directory=Path(directory);directory.mkdir(parents=True,exist_ok=True)
    technical=audio_qa.inspect(bundle,directory)
    frames=technical['frames']
    samples=sorted(set([0,round((frames-1)*.12),round((frames-1)*.24),round((frames-1)*.42),round((frames-1)*.56),round((frames-1)*.72),round((frames-1)*.86),frames-1]))
    select='+'.join(f'eq(n\\,{n})' for n in samples)
    sheet=directory/'phone-sheet.jpg'
    command(['ffmpeg','-v','error','-y','-i',bundle/'asset.mp4','-vf',f'select={select},scale=360:640,tile=4x2','-frames:v','1',sheet])
    pictures=[sheet]
    for label,n in [('opening',0),('payoff',samples[-2]),('final',frames-1)]:
        path=directory/f'{label}.jpg'
        command(['ffmpeg','-v','error','-y','-i',bundle/'asset.mp4','-vf',f'select=eq(n\\,{n})','-frames:v','1',path]);pictures.append(path)
    technical['sample_seconds']=[round(n/30,3) for n in samples]
    (directory/'technical.json').write_text(json.dumps(technical,indent=2)+'\n')
    return technical,pictures


def inspect_with_codex(bundle,directory):
    manifest=engine.verify(bundle);directory=Path(directory)
    # Frozen input is reverified before cached review reuse.
    if (directory/'review.json').exists():return engine.validate_review(json.loads((directory/'review.json').read_text()),manifest['artifact_id'])
    technical,pictures=evidence(bundle,directory)
    source={r['path']:(bundle/'source'/r['path']).read_text() for r in manifest['payload']['source_files'] if r['path'].endswith('.html')}
    if sum(len(s) for s in source.values())>120000:raise ValueError('Source exceeds review packet limit; human review required')
    packet={'artifact_id':manifest['artifact_id'],'brief':manifest['payload']['job'],'technical':technical,'html_sources':source}
    prompt=(HERE/'director-prompt.md').read_text()+'\n\nFROZEN REVIEW PACKET:\n'+json.dumps(packet,ensure_ascii=False)
    args=['codex','exec','--ignore-user-config','--ephemeral','--sandbox','read-only','--skip-git-repo-check',
          '-c','web_search="disabled"','--output-schema',str(HERE/'director-review.schema.json'),
          '--output-last-message',str(directory/'worker-response.json'),'--color','never','--json','-C',str(directory)]
    for picture in pictures:args.extend(['--image',str(picture)])
    args.append('-')
    allowed=('PATH','HOME','USER','LOGNAME','TMPDIR','LANG','LC_ALL','CODEX_HOME','TERM','SSL_CERT_FILE','SSL_CERT_DIR')
    env={k:v for k,v in os.environ.items() if k in allowed}
    try:
        result=subprocess.run(args,input=prompt,capture_output=True,text=True,env=env,timeout=240)
    except subprocess.TimeoutExpired as exc:raise TimeoutError('Director worker timed out after240seconds') from exc
    (directory/'worker-events.jsonl').write_text(result.stdout)
    (directory/'worker-stderr.txt').write_text(result.stderr)
    if result.returncode:raise RuntimeError('Director worker failed; see worker-stderr.txt')
    try:report=json.loads((directory/'worker-response.json').read_text())
    except (OSError,json.JSONDecodeError) as exc:raise ValueError('Director returned no valid JSON') from exc
    engine.validate_review(report,manifest['artifact_id'])
    with (directory/'review.json').open('x') as f:f.write(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    return report


def run(snapshot,post_id,project,media,output,references,max_revisions=2):
    if type(max_revisions) is not int or not 0<=max_revisions<=2:raise ValueError('At most two revisions are allowed')
    project,media,output=engine.physical_path(project),engine.physical_path(media),engine.physical_path(output);output.mkdir(parents=True,exist_ok=True)
    job=engine.resolve_job(snapshot,post_id,references)
    initial=engine.freeze(job,project,media,output/'artifacts')
    policy=hashlib.sha256(b''.join((HERE/n).read_bytes() for n in ['engine.py','director.py','audio_qa.py','director-review.schema.json','director-prompt.md'])).hexdigest()
    run_dir=output/'runs'/(initial.name+'-'+policy[:12]+f'-r{max_revisions}');run_dir.mkdir(parents=True,exist_ok=True)
    lock=run_dir/'running.lock'
    try:fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    except FileExistsError as exc:raise RuntimeError('This artifact review is already running (or has an interrupted lock); inspect before resuming') from exc
    os.close(fd)
    try:
        if (run_dir/'result.json').exists():
            result=json.loads((run_dir/'result.json').read_text())
            engine.validate_result(result,initial.name,policy,max_revisions,lambda identity:engine.verify(output/'artifacts'/identity))
            for attempt in result['attempts']:
                persisted=engine.validate_review(json.loads((run_dir/attempt['artifact_id']/'review.json').read_text()),attempt['artifact_id'])
                if persisted!=attempt['review']:raise ValueError('Cached aggregate differs from the persisted director response')
            return result,run_dir
        def review(identity):
            return inspect_with_codex(output/'artifacts'/identity,run_dir/identity)
        def revise(identity,report):
            bundle=output/'artifacts'/identity;engine.verify(bundle)
            candidate_root=Path(tempfile.mkdtemp(prefix='candidate-',dir=run_dir));candidate=candidate_root/'project'
            try:
                engine.apply_patches(bundle/'source',candidate,report['patches'])
                raw=command([HYPERFRAMES,'check','--json'],cwd=candidate)
                check=json.loads(raw[raw.find('{'):])
                if not check.get('ok') or any(check[k]['errorCount'] or check[k]['warningCount'] for k in ['lint','runtime','layout','contrast','craft']):raise ValueError('Revised project did not pass full HyperFrames checks')
                dest=run_dir/identity/'revision-check.json';dest.write_text(json.dumps(check,indent=2)+'\n')
                command([HYPERFRAMES,'render','--quality','delivery','-o',candidate/'renders/candidate.mp4'],cwd=candidate)
                next_bundle=engine.freeze(job,candidate,candidate/'renders/candidate.mp4',output/'artifacts',parent=identity)
                if next_bundle.name==identity:raise ValueError('Correction did not produce a different artifact')
                return next_bundle.name
            finally:shutil.rmtree(candidate_root)
        result=engine.review_loop(initial.name,review,revise,max_revisions)
        result.update({'root_artifact':initial.name,'policy_sha256':policy,'max_revisions':max_revisions,'owner_approved':False,'coverage':'sampled decoded frames plus frozen source; no continuous listening/playback'})
        engine.validate_result(result,initial.name,policy,max_revisions,lambda identity:engine.verify(output/'artifacts'/identity))
        with (run_dir/'result.json').open('x') as f:f.write(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        return result,run_dir
    finally:lock.unlink()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--snapshot',type=Path,required=True);p.add_argument('--references',type=Path);p.add_argument('--post',required=True);p.add_argument('--project',type=Path,required=True);p.add_argument('--media',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--max-revisions',type=int,choices=[0,1,2],default=2)
    a=p.parse_args();snapshot=json.loads(a.snapshot.read_text());references=json.loads(a.references.read_text()) if a.references else snapshot.get('references',json.loads((HERE/'references.json').read_text()));result,run_dir=run(snapshot,a.post,a.project,a.media,a.output,references,a.max_revisions)
    print(json.dumps({'status':result['status'],'root_artifact':result['root_artifact'],'artifact_id':result['artifact_id'],'revisions':result['revisions'],'run_dir':str(run_dir),'error':result.get('error')}))
    return 0 if result['status']=='ready_for_human' else 2

if __name__=='__main__':sys.exit(main())
