"""Test-only simulated reviewer; production never imports this module.

Tests must still freeze a real tiny MP4; this does not bypass trusted-report validation.
"""
import json
from pathlib import Path
import subprocess
import uuid
import creative_verification as cv


def tiny_video(path, color="white"):
    path=Path(path)
    subprocess.run(['ffmpeg','-v','error','-threads','1','-f','lavfi','-i',f'color=c={color}:s=90x160:r=30:d=0.1','-an','-c:v','libx264','-pix_fmt','yuv420p','-y',str(path)],check=True,capture_output=True)
    return path


def passing_reviewer(*, role, evidence, context, policy, invocation_id):
    return {'role':role, **{k:evidence[k] for k in ('artifact_id','media_sha256','context_sha256','policy_sha256','evidence_sha256')},'session_id':invocation_id,'verdict':'pass','checks':{k:'pass' for k in cv.CHECKS},'coverage':{'original_frame_indices':list(range(evidence['frame_count'])),'sheet_ids':[s['id'] for s in evidence['sheets']],'motion_windows':evidence['motion_windows'],'continuous_playback':False},'findings':[],'patches':[],'summary':'Simulated fixture review of tiny silent test video; not an actual creative judgment.'}


def attest(bundle, caption, cta, state_dir=None):
    """Return a schema-valid reference for a genuine frozen tiny-video test bundle."""
    return cv.inspect_candidate(bundle,caption,cta,state_dir or Path(bundle).parent/'fixture-verification',reviewer=passing_reviewer)['verification']
