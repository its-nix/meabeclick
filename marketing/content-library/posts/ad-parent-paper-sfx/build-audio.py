"""Reproduce the SFX-only comparison while copying the approved video stream."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--video', type=Path, required=True)
args = parser.parse_args()
plan = json.loads((ROOT / 'sound-plan.json').read_text())
if hashlib.sha256(args.video.read_bytes()).hexdigest() != plan['parent_media_sha256']:
    raise ValueError('Input video does not match the approved silent parent')
assets = ROOT / 'assets' / 'sfx'
mix = ROOT / 'assets' / 'audio' / 'sfx-mix.wav'
mix.parent.mkdir(parents=True, exist_ok=True)
render = ROOT / 'renders' / 'P004-parent-paper-SFX-v1.mp4'
render.parent.mkdir(exist_ok=True)
sources = ['page-turn.mp3', 'wood-click.mp3']
command = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=15']
for name in sources:
    command += ['-i', str(assets / name)]
filters = []
for name in sources:
    rows = [c for c in plan['cues'] if c['asset'] == name]
    index = sources.index(name) + 1
    filters.append(f'[{index}:a]aresample=48000,aformat=channel_layouts=stereo,asplit={len(rows)}' + ''.join(f'[{c["id"]}-in]' for c in rows))
for cue in plan['cues']:
    delay = round(cue['at'] * 1000)
    filters.append(f'[{cue["id"]}-in]atrim=start={cue["source_start"]}:duration={cue["duration"]},asetpts=PTS-STARTPTS,highpass=f=100,lowpass=f=12000,afade=t=in:d=0.001,afade=t=out:st={max(0,cue["duration"]-0.008)}:d=0.008,volume={cue["gain_db"]}dB,adelay={delay}|{delay}[{cue["id"]}]')
filters.append('[0:a]' + ''.join(f'[{c["id"]}]' for c in plan['cues']) + f'amix=inputs={len(plan["cues"])+1}:normalize=0,volume={plan.get("master_gain_db",0)}dB,atrim=duration=15[out]')
command += ['-filter_complex', ';'.join(filters), '-map', '[out]', '-c:a', 'pcm_s24le', str(mix)]
subprocess.run(command, check=True)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(args.video), '-i', str(mix), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', '15', '-movflags', '+faststart', str(render)], check=True)
print(json.dumps({'output': str(render), 'video': 'stream copy', 'sha256': hashlib.sha256(render.read_bytes()).hexdigest()}))
