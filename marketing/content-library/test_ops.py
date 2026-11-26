import importlib.util
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone

import ops

NOW = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)

class OperationsTests(unittest.TestCase):
    def test_historical_capacity_blocks_acquisition_but_not_education(self):
        self.assertFalse(ops.capacity_gate('booking', now=NOW)['allowed'])
        self.assertTrue(ops.capacity_gate('educational', now=NOW)['allowed'])

    def test_participation_can_publish_with_exact_approval_and_no_capacity_claim(self):
        policy = dict(cta='participation',credentials_healthy=True,approved=True,
                      reconciliation_clear=True,now=NOW)
        self.assertTrue(ops.submission_gate(**policy)['allowed'])
        self.assertIn('approval_missing', ops.submission_gate(**(policy|{'approved':False}))['reasons'])
        self.assertIn('daily_limit', ops.submission_gate(**(policy|{'daily_deliveries':2}))['reasons'])

    def test_current_capacity_and_verified_waitlist(self):
        cap = {'total_hours': 31, 'occupied_hours': 31, 'observed_at': NOW.isoformat()}
        self.assertFalse(ops.capacity_gate('booking', cap, NOW)['allowed'])
        cap.update(waitlist_url='https://example.com/waitlist', waitlist_verified_at=NOW.isoformat())
        self.assertTrue(ops.capacity_gate('waitlist', cap, NOW)['allowed'])
        cap['waitlist_url'] = 'javascript:alert(1)'
        self.assertFalse(ops.capacity_gate('waitlist', cap, NOW)['allowed'])
        cap['occupied_hours'] = 32
        self.assertFalse(ops.capacity_gate('booking', cap, NOW)['allowed'])

    def test_unknown_or_future_capacity_is_not_live(self):
        for observed in [None, '2026-11-16T00:00:00Z', '2026-10-01T00:00:00Z']:
            self.assertFalse(ops.capacity_gate('booking', {'total_hours': 31, 'occupied_hours': 5, 'observed_at': observed}, NOW)['allowed'])
        self.assertFalse(ops.capacity_gate('buy-now', now=NOW)['allowed'])

    def test_all_submission_gates_and_delivery_limits(self):
        kwargs = dict(credentials_healthy=True, approved=True, reconciliation_clear=True, now=NOW)
        self.assertTrue(ops.submission_gate(**kwargs)['allowed'])
        for changed in [dict(paused=True), dict(credentials_healthy=False), dict(approved=False), dict(reconciliation_clear=False), dict(daily_deliveries=1, requested_deliveries=2), dict(monthly_deliveries=20)]:
            self.assertFalse(ops.submission_gate(**(kwargs | changed))['allowed'])
        self.assertFalse(ops.submission_gate(**(kwargs | {'daily_deliveries': -1}))['allowed'])

    def test_exact_windows_and_honest_attribution(self):
        row = {'provider_post_id': 'post-1', 'artifact_id': 'artifact-1', 'window_start': '2026-11-01T00:00:00Z', 'window_end': '2026-11-08T00:00:00Z', 'metrics': {'reach': 100, 'conversions': 3}}
        result = ops.summarize_results([row])
        self.assertIsNone(result['posts'][0]['metrics']['conversions'])
        self.assertEqual(result['posts'][0]['metrics']['reach'], 100)
        row['utm_content'] = 'artifact-1'
        self.assertEqual(ops.summarize_results([row])['posts'][0]['metrics']['conversions'], 3)
        row['metric_windows'] = {'reach': {'start': row['window_start'], 'end': '2026-11-09T00:00:00Z'}}
        with self.assertRaises(ValueError): ops.summarize_results([row])

    def test_only_closed_windows_and_matching_spend_are_accepted(self):
        row = {'provider_post_id': 'p', 'artifact_id': 'a', 'window_start': '2026-11-01T00:00:00Z', 'window_end': '2026-11-15T00:00:00Z', 'metrics': {'spend': 10, 'conversions': 2}, 'utm_content': 'a'}
        with self.assertRaises(ValueError): ops.summarize_results([row], now=NOW)
        row['window_end'] = '2026-11-08T00:00:00Z'
        row['metric_windows'] = {'spend': {'start': row['window_start'], 'end': '2026-11-14T00:00:00Z'}}
        with self.assertRaises(ValueError): ops.summarize_results([row], now=NOW)
        row['metric_windows']['spend']['end'] = row['window_end']
        self.assertEqual(ops.summarize_results([row], now=NOW)['posts'][0]['metrics']['spend'], 10)

    def test_missing_receipts_negative_metrics_and_rate_windows_rejected(self):
        with self.assertRaises(ValueError): ops.summarize_results([{'artifact_id': 'a'}])
        with self.assertRaises(ValueError):
            ops.summarize_results([{'provider_post_id': 'p', 'artifact_id': 'a', 'window_start': '2026-11-01T00:00:00Z', 'window_end': '2026-11-08T00:00:00Z', 'metrics': {'reach': -1}}])
        self.assertEqual(ops.window_rate(5, 10, ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z'), ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z')), 0.5)
        with self.assertRaises(ValueError): ops.window_rate(5, 10, ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z'), ('2026-11-01T00:00:00Z','2026-11-07T00:00:00Z'))
        self.assertIsNone(ops.window_rate(None, 10, ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z'), ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z')))
        self.assertIsNone(ops.window_rate(5, 0, ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z'), ('2026-11-01T00:00:00Z','2026-11-08T00:00:00Z')))
        self.assertEqual(ops.next_experiment([])['status'], 'proposal')
        self.assertIsNone(ops.next_experiment([])['winner'])

    def test_timer_is_generated_only_and_paths_are_separate_arguments(self):
        spec = importlib.util.spec_from_file_location('timer', Path(__file__).with_name('install-timer.py'))
        timer = importlib.util.module_from_spec(spec); spec.loader.exec_module(timer)
        with tempfile.TemporaryDirectory(prefix='machine path ') as directory:
            config = Path(directory) / 'settings.json'
            payload = timer.timer_payload(config, Path(directory), interval=900)
            self.assertEqual(payload['ProgramArguments'][-3:], ['tick', '--config', str(config.resolve())])
            self.assertEqual(payload['StartInterval'], 900)
            self.assertEqual(payload['EnvironmentVariables']['PATH'], '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
            with self.assertRaises(ValueError): timer.timer_payload(config, Path(directory), interval=0)

if __name__ == '__main__': unittest.main()
