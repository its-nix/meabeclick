"""Technical QA of immutable silent/audio bundles; audio always needs human listening."""
import argparse
import array
import tempfile
import wave
import json
import math
from pathlib import Path
import re
import subprocess

import engine

AUDIO_MODES = {'sfx-only', 'narration', 'music', 'mixed'}


def command(args):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr[-1200:]}')
    return result.stdout + result.stderr


def number(value, label):
    if isinstance(value, bool): raise ValueError(f'Invalid {label}')
    try: result = float(value)
    except (TypeError, ValueError) as exc: raise ValueError(f'Invalid {label}') from exc
    if not math.isfinite(result): raise ValueError(f'Invalid {label}')
    return result


def probe(path):
    return json.loads(command(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', path]))


PROCEDURAL_VERSION = 'meabeclick-light-instrumental-v1'


def synthesize(path, duration):
    """Original fixed arpeggio/chord score; no recordings, external assets or RNG."""
    duration = number(duration, 'music duration')
    if not 1 <= duration <= 60: raise ValueError('Music duration outside supported range')
    samples = array.array('h'); rate = 48000; beat = .625
    chords = ((48,52,55),(45,48,52),(53,57,60),(55,59,62))
    for i in range(round(duration * rate)):
        t=i/rate; chord=chords[int(t/(beat*4))%4]; age=t%(beat/2)
        note=chord[int(t/(beat/2))%3]+12; freq=440*2**((note-69)/12)
        envelope=min(1,age/.012)*math.exp(-age*8)
        melody=(math.sin(2*math.pi*freq*t)+.18*math.sin(4*math.pi*freq*t))*envelope
        pad=sum(math.sin(2*math.pi*(440*2**((n-69)/12))*t) for n in chord)/3
        fade=max(0,min(1,t/.4,(duration-t)/.8))
        value=int(32767*.11*fade*(.7*melody+.3*pad));samples.extend((value,value))
    import sys
    if sys.byteorder!='little':samples.byteswap()
    with wave.open(str(path),'wb') as out:
        out.setnchannels(2);out.setsampwidth(2);out.setframerate(rate);out.writeframes(samples.tobytes())
    return {'kind':'original_procedural','generator':PROCEDURAL_VERSION,'duration':duration,
            'sha256':engine.sha(path),'creator':'MeaBeclick procedural score',
            'verification':'Reproducible original synthesis; human listening pending'}


def encode_music(wav, output):
    command(['ffmpeg','-v','error','-y','-i',wav,'-c:a','aac','-b:a','192k','-ar','48000','-ac','2',output])


def packet_hash(path):
    value=command(['ffmpeg','-v','error','-i',path,'-map','0:a:0','-c:a','copy','-f','hash','-hash','sha256','-'])
    matches=re.findall(r'SHA256=([0-9a-f]{64})',value)
    if len(matches)!=1:raise ValueError('Encoded audio identity unavailable')
    return matches[0]


def verify_procedural(bundle, asset, duration):
    if asset.get('generator')!=PROCEDURAL_VERSION or abs(number(asset.get('duration'),'generator duration')-duration)>.1:
        raise ValueError('Unsupported procedural music provenance')
    with tempfile.TemporaryDirectory(prefix='music-proof-') as scratch:
        wav=Path(scratch)/'original.wav';encoded=Path(scratch)/'original.m4a'
        regenerated=synthesize(wav,asset['duration'])
        if regenerated['sha256']!=asset['sha256']:raise ValueError('Procedural waveform provenance mismatch')
        encode_music(wav,encoded)
        if packet_hash(encoded)!=packet_hash(Path(bundle)/'asset.mp4'):
            raise ValueError('Encoded audio differs from original procedural score')
    return True


def rights_and_cues(bundle, job, duration):
    assets = job.get('audio_assets', [])
    plan = job.get('audio_plan', {})
    if not assets or not plan.get('cues'): raise ValueError('Audio rights/assets and cue plan are required')
    if abs(number(plan.get('duration'), 'plan duration') - duration) > .1:
        raise ValueError('Audio plan duration differs from media')
    sources = {}
    for asset in assets:
        procedural = asset.get('kind') == 'original_procedural'
        required = ('path','sha256','creator','verification') if procedural else ('path','sha256','creator','source','license','licenseUrl','verification')
        for key in required:
            if not isinstance(asset.get(key), str) or not asset[key].strip(): raise ValueError(f'Missing audio rights {key}')
        # New licenses need an explicit policy review rather than a truthy rights flag.
        if not procedural and (asset['license'] != 'CC0-1.0' or asset['licenseUrl'] != 'https://creativecommons.org/publicdomain/zero/1.0/'):
            raise ValueError('Unsupported audio rights license')
        if not procedural and not re.match(r'https://[^/]+/', asset['source']): raise ValueError('Invalid rights source URL')
        relative = Path(asset['path'])
        if relative.is_absolute() or '..' in relative.parts: raise ValueError('Invalid audio asset path')
        path = bundle / 'source' / relative
        if not path.is_file() or engine.sha(path) != asset['sha256']: raise ValueError('Audio rights asset hash mismatch')
        if procedural: verify_procedural(bundle, asset, duration)
        key = relative.name
        if key in sources: raise ValueError('Ambiguous audio asset name')
        sources[key] = number(probe(path)['format']['duration'], 'source duration')
    ids = set()
    for cue in plan['cues']:
        identity = cue.get('id')
        if not isinstance(identity, str) or not identity or identity in ids: raise ValueError('Missing/duplicate cue ID')
        ids.add(identity)
        source = cue.get('asset')
        if source not in sources: raise ValueError('Cue has no rights-verified source')
        at = number(cue.get('at'), 'cue start')
        length = number(cue.get('duration'), 'cue duration')
        start = number(cue.get('source_start'), 'cue source start')
        number(cue.get('gain_db'), 'cue gain')
        if at < 0 or start < 0 or length <= 0 or at + length > duration + .001 or start + length > sources[source] + .001:
            raise ValueError('Cue overflows media/source bounds')
    if 'master_gain_db' in plan: number(plan['master_gain_db'], 'master gain')
    return {'procedural_verified': all(a.get('kind') == 'original_procedural' for a in assets), 'rights_verified': True, 'asset_count': len(assets), 'cue_count': len(ids), 'cue_bounds_valid': True}


def inspect(bundle, directory=None):
    bundle = Path(bundle)
    manifest = engine.verify(bundle)
    job = manifest['payload']['job']
    mode = job.get('constraints', {}).get('audio')
    if mode != 'silent' and mode not in AUDIO_MODES: raise ValueError('Unknown explicit audio mode')
    data = probe(bundle / 'asset.mp4')
    videos = [s for s in data['streams'] if s['codec_type'] == 'video']
    audios = [s for s in data['streams'] if s['codec_type'] == 'audio']
    if len(videos) != 1 or len(audios) != (0 if mode == 'silent' else 1) or len(data['streams']) != len(videos) + len(audios):
        raise ValueError('Unexpected video/audio stream configuration')
    video = videos[0]
    duration = number(data['format']['duration'], 'duration')
    frames = int(video['nb_frames'])
    if (video['width'], video['height']) != (1080, 1920) or video['r_frame_rate'] != '30/1' or not 1 <= duration <= 60 or frames < 2 or abs(frames / 30 - duration) > .1:
        raise ValueError('Unexpected format/runtime')
    report = {'artifact_id': manifest['artifact_id'], 'media_sha256': manifest['payload']['media']['sha256'],
              'mode': mode, 'width': video['width'], 'height': video['height'], 'fps': 30, 'frames': frames,
              'duration': duration, 'audio_streams': len(audios), 'listening_required': bool(audios),
              'listening_status': 'pending' if audios else 'not_required', 'true_peak_dbtp': None, 'integrated_lufs': None}
    if audios:
        audio = audios[0]
        if audio.get('codec_name') != 'aac' or str(audio.get('sample_rate')) != '48000' or audio.get('channels') != 2:
            raise ValueError('Audio stream must be 48kHz stereo AAC')
        if abs(number(audio.get('duration'), 'audio duration') - duration) > .1: raise ValueError('Audio stream duration differs from video')
        report.update(rights_and_cues(bundle, job, duration))
        report.update({'audio_codec': 'aac', 'sample_rate': 48000, 'channels': 2})
    command(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', bundle / 'asset.mp4', '-map', '0:v', '-map', '0:a?', '-f', 'null', '-'])
    report['full_decode'] = True
    if audios:
        raw = command(['ffmpeg', '-hide_banner', '-nostats', '-i', bundle / 'asset.mp4', '-map', '0:a:0', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
        matches = re.findall(r'\{[^{}]*"input_i"[^{}]*\}', raw, re.S)
        if not matches: raise ValueError('Missing loudness measurements')
        meters = json.loads(matches[-1])
        peak = number(meters['input_tp'], 'true peak')
        loudness = number(meters['input_i'], 'integrated loudness')
        if peak > -1: raise ValueError('Audio true peak exceeds -1 dBTP headroom')
        if report.get('procedural_verified') and (mode != 'music' or not -35 <= loudness <= -18):
            raise ValueError('Original light music must measure -35..-18 LUFS')
        report.update({'true_peak_dbtp': peak, 'integrated_lufs': loudness,
                       'loudness_policy': 'measured; sparse SFX has no continuous loudness target' if mode == 'sfx-only' else 'measured; human intelligibility review required'})
    # Detect mutation during expensive decoding before emitting evidence.
    engine.verify(bundle)
    report['technical_pass'] = True
    if directory is not None:
        directory = Path(directory); directory.mkdir(parents=True, exist_ok=True)
        (directory / 'audio-technical.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect(args.bundle, args.output), indent=2, allow_nan=False))


if __name__ == '__main__': main()
