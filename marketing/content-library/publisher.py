"""Explicit publishing bridge. Export is a handoff, never a publication receipt."""
import json
from pathlib import Path
import shutil
import engine


def export_submission(queue,key,output):
    job=queue.validate(key)
    if job['status']!='approved' or job['approval_sha']!=key:raise ValueError('Exact package approval required')
    destination=Path(output)/key
    if destination.exists():raise ValueError('Existing handoff requires reconciliation')
    destination.mkdir(parents=True)
    package=job['package']
    try:
        shutil.copyfile(Path(package['bundle'])/'asset.mp4',destination/'asset.mp4')
        if engine.sha(destination/'asset.mp4')!=package['media_sha256']:raise ValueError('Handoff bytes changed')
        (destination/'submission.json').write_text(json.dumps({'package_sha256':key,'package':package,'state':'handoff_only','instruction':'Use connected provider exact schema; reconcile real returned ID/status. Export is not a social post.'},ensure_ascii=False,indent=2)+'\n')
        queue.begin_submission(key)
    except BaseException:
        shutil.rmtree(destination);raise
    return destination


def import_receipt(queue,key,receipt):
    if receipt.get('package_sha256')!=key:raise ValueError('Receipt package mismatch')
    queue.receipt(key,receipt)
