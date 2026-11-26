from datetime import datetime
import unittest
from zoneinfo import ZoneInfo

import planner


class CapacityPlannerTests(unittest.TestCase):
    def test_slots_are_future_unique_two_per_day_and_skip_occupied(self):
        now=datetime(2026,11,18,10,0,tzinfo=ZoneInfo('Asia/Jerusalem'))
        occupied=['2026-11-18T12:30:00+02:00']
        slots=planner.concept_slots(4,now,occupied)
        parsed=[datetime.fromisoformat(x) for x in slots]
        self.assertEqual(len(set(slots)),4)
        self.assertTrue(all(value>now for value in parsed))
        self.assertNotIn(occupied[0],slots)
        self.assertEqual(planner.review_batch_id(now),'review-2026-W47')

    def test_slot_count_is_bounded_to_review_safety_cap(self):
        with self.assertRaisesRegex(ValueError,'0..20'):planner.concept_slots(21)
        self.assertEqual(planner.concept_slots(0),[])


class DailyCalendarTests(unittest.TestCase):
    def test_calendar_includes_one_contiguous_month_of_local_dates(self):
        now = datetime(2026, 10, 22, 19, tzinfo=ZoneInfo('Asia/Jerusalem'))
        days = planner.upcoming_days(now)
        self.assertEqual(days[0].isoformat(), '2026-10-23')
        self.assertEqual(days[-1].isoformat(), '2026-11-22')
        self.assertEqual(len(days), 31)
        self.assertEqual(len(set(map(planner.daily_slot, days))), len(days))

    def test_sunday_review_batch_remains_fixed_during_the_preparation_week(self):
        zone = ZoneInfo('Asia/Jerusalem')
        tuesday = datetime(2026, 11, 24, 8, tzinfo=zone)
        sunday = datetime(2026, 11, 29, 8, tzinfo=zone)
        monday = datetime(2026, 11, 30, 8, tzinfo=zone)
        days = planner.next_review_week(tuesday)
        self.assertEqual(days, planner.next_review_week(sunday))
        self.assertEqual([d.isoformat() for d in (days[0], days[-1])], ['2026-11-30','2026-12-06'])
        self.assertEqual(len(days), 7)
        self.assertGreater(planner.next_review_week(monday)[0], days[-1])

    def test_gap_requires_same_version_on_both_connected_channels(self):
        now = datetime(2026, 11, 24, 19, tzinfo=ZoneInfo('Asia/Jerusalem'))
        day = planner.upcoming_days(now)[0]
        channels = [{'network':'instagram','account':'ig'}, {'network':'facebook','account':'fb'}]
        package = {'artifact_id':'first','scheduled_at':planner.daily_slot(day)}
        ig = {**channels[0],'status':'scheduled','package':package,'receipt':{'provider':'buffer','readback_verified':True}}
        fb = {**channels[1],'status':'scheduled','package':{**package,'artifact_id':'second'},'receipt':{'provider':'buffer','readback_verified':True}}
        self.assertEqual(planner.publishing_gaps([day], [ig, fb], channels), [day.isoformat()])
        self.assertEqual(planner.publishing_gaps([day], [ig, {**fb, 'package':package}], channels), [])
        self.assertEqual(planner.publishing_gaps([day],
            [ig, {**fb, 'package':{**package, 'caption':'Unmatched caption'}}],
            channels), [day.isoformat()])



if __name__=='__main__':unittest.main()
