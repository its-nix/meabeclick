import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import audio_qa
import engine


class AudioQATests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.project = self.root / 'project'
        self.project.mkdir()
        (self.project / 'index.html').write_text('visual')
        (self.project / 'click.wav').write_bytes(b'source')
        self.media = self.root / 'video.mp4'
        self.media.write_bytes(b'video')
        self.job = {'post': {'id': 'P001'}, 'constraints': {'audio': 'sfx-only'},
                    'audio_assets': [{'path': 'click.wav', 'sha256': engine.sha(self.project / 'click.wav'),
                                      'creator': 'Example', 'source': 'https://example.org/audio',
                                      'license': 'CC0-1.0', 'licenseUrl': 'https://creativecommons.org/publicdomain/zero/1.0/',
                                      'verification': 'Verified source license'}],
                    'audio_plan': {'duration': 2, 'cues': [{'id': 'click', 'asset': 'click.wav', 'at': .1,
                                                           'source_start': 0, 'duration': .2, 'gain_db': -6}]}}
        self.probe = {'streams': [{'codec_type': 'video', 'width': 1080, 'height': 1920, 'r_frame_rate': '30/1', 'nb_frames': '60', 'duration': '2'},
                                  {'codec_type': 'audio', 'codec_name': 'aac', 'sample_rate': '48000', 'channels': 2, 'duration': '2'}],
                      'format': {'duration': '2'}}

    def inspect(self, job=None, probe=None, peak=-3):
        bundle = engine.freeze(job or self.job, self.project, self.media, self.root / 'artifacts')
        def command(args):
            if args[0] == 'ffprobe':
                return json.dumps((probe or self.probe) if str(args[-1]).endswith('asset.mp4') else {'format': {'duration': '1'}})
            if 'loudnorm=print_format=json' in args:
                return json.dumps({'input_tp': str(peak), 'input_i': '-32.5'})
            return ''
        with patch.object(audio_qa, 'command', side_effect=command):
            return audio_qa.inspect(bundle)

    def test_audio_pass_requires_listening(self):
        report = self.inspect()
        self.assertTrue(report['full_decode'])
        self.assertTrue(report['listening_required'])
        self.assertEqual(report['listening_status'], 'pending')
        self.assertEqual(report['true_peak_dbtp'], -3)

    def test_silent_pass_and_wrong_stream_rejected(self):
        job = {'post': {'id': 'P001'}, 'constraints': {'audio': 'silent'}}
        probe = copy.deepcopy(self.probe); probe['streams'].pop()
        self.assertFalse(self.inspect(job, probe)['listening_required'])
        with self.assertRaisesRegex(ValueError, 'stream'): self.inspect(job)
        with self.assertRaisesRegex(ValueError, 'stream'): self.inspect(probe=probe)

    def test_bad_cue_and_rights_and_clipping_fail(self):
        for change in ('overflow', 'source_overflow', 'rights', 'hash', 'nan'):
            with self.subTest(change=change):
                job = copy.deepcopy(self.job)
                if change == 'overflow': job['audio_plan']['cues'][0]['at'] = 1.9
                if change == 'source_overflow': job['audio_plan']['cues'][0]['source_start'] = .9
                if change == 'rights': job['audio_assets'][0].pop('license')
                if change == 'hash': job['audio_assets'][0]['sha256'] = '0' * 64
                if change == 'nan': job['audio_plan']['cues'][0]['gain_db'] = float('nan')
                with self.assertRaises(ValueError): self.inspect(job)
        with self.assertRaisesRegex(ValueError, 'peak'): self.inspect(peak=.1)

    def test_decode_failure_prevents_report(self):
        bundle = engine.freeze({'post': {'id': 'P001'}, 'constraints': {'audio': 'silent'}},
                               self.project, self.media, self.root / 'artifacts')
        probe = copy.deepcopy(self.probe); probe['streams'].pop()
        def command(args):
            if args[0] == 'ffprobe': return json.dumps(probe)
            self.assertIn('-xerror', args)
            self.assertIn('-err_detect', args)
            raise RuntimeError('decode failed')
        with patch.object(audio_qa, 'command', side_effect=command):
            with self.assertRaisesRegex(RuntimeError, 'decode failed'):
                audio_qa.inspect(bundle, self.root / 'report')
        self.assertFalse((self.root / 'report/audio-technical.json').exists())

    def test_frozen_tampering_rejected_before_tools(self):
        bundle = engine.freeze(self.job, self.project, self.media, self.root / 'artifacts')
        (bundle / 'asset.mp4').write_bytes(b'tampered')
        with patch.object(audio_qa, 'command') as command:
            with self.assertRaises(ValueError): audio_qa.inspect(bundle)
            command.assert_not_called()

    def test_unsupported_modes_and_audio_configuration(self):
        job = copy.deepcopy(self.job);job['constraints']['audio'] = 'unknown'
        with self.assertRaises(ValueError): self.inspect(job)
        for key, value in [('sample_rate', '44100'), ('channels', 1), ('codec_name', 'pcm_s16le')]:
            probe = copy.deepcopy(self.probe);probe['streams'][1][key] = value
            with self.assertRaises(ValueError): self.inspect(probe=probe)


if __name__ == '__main__': unittest.main()
