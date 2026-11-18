#!/usr/bin/env node
/**
 * The vision's targets (PRODUCT.md, "Vision"), measured from tables that
 * already exist. Read-only. Deliberately imports nothing from src/: it has
 * to run inside the production container by being piped to `node -`,
 * and the runtime image ships build/, not scripts/ or src/.
 *
 *   node scripts/vision-metrics.mjs [--json]           # local, DATA_DIR/results.db
 *   ssh mea 'docker exec -i <container> node --input-type=module - --json' < scripts/vision-metrics.mjs
 *
 * Lesson preparation is not measured here: lessons are prepared as Drive-native
 * drafts (native_lesson_jobs) and approved by a person, so the old
 * generation-run share and clean-run streak no longer exist.
 *
 * Plan mix: bookings created in the last 30 days, by the plan they stored.
 * `bookings_v2.duration` is that plan — minutes, the same key `plans.ts`
 * sells (45 יחיד, 90 כפול, 135 משולש). No extra column. A hold still in
 * `pending_bookings` is not a booking yet, so it is not in the mix.
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;

/** The sold ladder, copied because this script imports nothing from src/.
 *  A test pins it to `PLANS` in plans.ts (minutes, kind, name — not price). */
export const PLAN_LADDER = [
  { minutes: 45, kind: 'single', name: 'יחיד' },
  { minutes: 90, kind: 'double', name: 'כפול' },
  { minutes: 135, kind: 'triple', name: 'משולש' },
];

const inWindow = (iso, from, to) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t > from && t <= to;
};

/** 'YYYY-MM' of the calendar month before `now`, in Israel. */
function previousMonth(now) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit' })
    .format(now).split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, '0')}`;
}

export function measure(db, now) {
  const to = now.getTime();
  const from = to - 30 * DAY;

  const taught = db.prepare(`SELECT student_id, "end" FROM bookings_v2 WHERE status != 'cancelled'`).all();
  const activeStudents = new Set(taught.filter((b) => inWindow(b.end, from, to)).map((b) => b.student_id)).size;

  const month = previousMonth(now);
  let paidAgorot = 0, owedAgorot = 0;
  for (const p of db.prepare(`SELECT date, amount_agorot, status FROM payments`).all()) {
    if (!String(p.date).startsWith(month)) continue;
    if (p.status === 'paid') paidAgorot += p.amount_agorot;
    else if (p.status === 'owed') owedAgorot += p.amount_agorot;
  }

  /* Created (`at`), not taught (`end`): the mix is the choice a family made
     in the window, including a lesson that has not happened yet. */
  const booked = db.prepare(
    `SELECT duration, at FROM bookings_v2 WHERE status != 'cancelled'`
  ).all().filter((b) => inWindow(b.at, from, to));
  const counts = new Map(PLAN_LADDER.map((p) => [p.minutes, 0]));
  let other = 0;
  for (const b of booked) {
    const minutes = Number(b.duration);
    if (counts.has(minutes)) counts.set(minutes, counts.get(minutes) + 1);
    else other += 1;
  }

  return {
    activeStudents,
    revenue: { month, paidAgorot, owedAgorot },
    planMix: {
      total: booked.length,
      other,
      plans: PLAN_LADDER.map((p) => ({ ...p, count: counts.get(p.minutes) })),
    },
    notes: [
      "active students counts only lessons booked through the site (bookings_v2); lessons arranged outside it are not counted.",
      "plan mix counts bookings created in the last 30 days (bookings_v2.at), not lessons taught. The plan is the stored duration in minutes; cancelled bookings are excluded, and a missing or unknown duration is other. A hold still in pending_bookings is not a booking yet.",
      "funnel steps are anonymous first-party events: a random visitor id, no name, phone, email or IP. A step counts distinct visitors, and a row with no visitor id counts on its own. Plan selections are counted per event, so one visitor can select more than one plan.",
    ],
    funnel: funnelSince(db, from, to),
  };
}

/** The booking funnel, in order. Event names are the ones marketing_events
 *  accepts (migration 030). Labels are what this script prints. Copied here
 *  because the script imports nothing from src/. */
export const FUNNEL_STEPS = [
  ['landing_visit', 'landing view'],
  ['booking_start', 'booking start'],
  ['plan_selected', 'plan selected'],
  ['time_selected', 'time selected'],
  ['booking_submitted', 'details submitted'],
  ['lesson_scheduled', 'booking confirmed'],
];

/** Plan keys a `plan_selected` event may carry, with the Hebrew name the
 *  booking page shows. A test pins the names to plans.ts. */
export const PLAN_KINDS = [
  ['single', 'יחיד'],
  ['double', 'כפול'],
  ['triple', 'משולש'],
];

function columnSet(db, table) {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
  if (!exists) return new Set();
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
}

function emptyFunnel() {
  return {
    steps: FUNNEL_STEPS.map(([event, label]) => ({
      event, label, n: 0, ofLanding: null, ofPrevious: null,
    })),
    plans: Object.fromEntries(PLAN_KINDS.map(([kind]) => [kind, 0])),
    sources: [],
    referrers: [],
    heardFrom: {},
  };
}

/** Distinct visitors for an event, plus each row that has no visitor id.
 *  `when` is a SQL fragment such as `event = 'landing_visit'`. */
function visitorCount(aliasEvent) {
  return `COUNT(DISTINCT CASE WHEN ${aliasEvent} THEN visitor_id END) + SUM(CASE WHEN ${aliasEvent} AND visitor_id IS NULL THEN 1 ELSE 0 END)`;
}

function funnelSince(db, fromMs, toMs) {
  const events = columnSet(db, 'marketing_events');
  const bookings = columnSet(db, 'bookings_v2');
  if (!events.has('event') || !events.has('at') || !events.has('visitor_id')) return emptyFunnel();

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const rows = db.prepare(`
    SELECT event,
           COUNT(DISTINCT visitor_id) AS visitors,
           SUM(CASE WHEN visitor_id IS NULL THEN 1 ELSE 0 END) AS anonymous
    FROM marketing_events
    WHERE at > ? AND at <= ?
    GROUP BY event
  `).all(fromIso, toIso);
  const counts = new Map(rows.map((r) => [r.event, Number(r.visitors) + Number(r.anonymous)]));
  const landing = counts.get('landing_visit') ?? 0;
  const steps = FUNNEL_STEPS.map(([event, label], i) => {
    const n = counts.get(event) ?? 0;
    const prev = i === 0 ? null : (counts.get(FUNNEL_STEPS[i - 1][0]) ?? 0);
    return {
      event,
      label,
      n,
      ofLanding: i === 0 ? null : (landing ? n / landing : null),
      ofPrevious: prev === null ? null : (prev ? n / prev : null),
    };
  });

  const plans = Object.fromEntries(PLAN_KINDS.map(([kind]) => [kind, 0]));
  if (events.has('detail')) {
    for (const r of db.prepare(`
      SELECT detail, COUNT(*) AS n FROM marketing_events
      WHERE event = 'plan_selected' AND at > ? AND at <= ?
      GROUP BY detail
    `).all(fromIso, toIso)) {
      if (Object.prototype.hasOwnProperty.call(plans, r.detail)) plans[r.detail] = Number(r.n);
    }
  }

  const sources = [];
  if (events.has('utm_source')) {
    for (const r of db.prepare(`
      SELECT utm_source AS source,
             ${visitorCount(`event = 'landing_visit'`)} AS visits,
             SUM(CASE WHEN event = 'lesson_scheduled' THEN 1 ELSE 0 END) AS confirmed
      FROM marketing_events
      WHERE at > ? AND at <= ?
      GROUP BY utm_source
    `).all(fromIso, toIso)) {
      const visits = Number(r.visits);
      const confirmed = Number(r.confirmed);
      if (!visits && !confirmed) continue;
      sources.push({ source: r.source ?? null, visits, confirmed });
    }
    sources.sort((a, b) => b.visits - a.visits || String(a.source).localeCompare(String(b.source)));
  }

  const referrers = [];
  if (events.has('referrer')) {
    for (const r of db.prepare(`
      SELECT referrer,
             ${visitorCount(`event = 'landing_visit'`)} AS visits,
             SUM(CASE WHEN event = 'lesson_scheduled' THEN 1 ELSE 0 END) AS confirmed
      FROM marketing_events
      WHERE at > ? AND at <= ?
      GROUP BY referrer
    `).all(fromIso, toIso)) {
      const visits = Number(r.visits);
      const confirmed = Number(r.confirmed);
      if (!visits && !confirmed) continue;
      referrers.push({ referrer: r.referrer ?? null, visits, confirmed });
    }
    referrers.sort((a, b) => b.visits - a.visits || String(a.referrer).localeCompare(String(b.referrer)));
  }

  const heardFrom = {};
  if (bookings.has('heard_from')) {
    for (const r of db.prepare(`
      SELECT heard_from AS heardFrom, COUNT(*) AS n
      FROM bookings_v2
      WHERE heard_from IS NOT NULL AND at > ? AND at <= ?
      GROUP BY heard_from
    `).all(fromIso, toIso)) {
      heardFrom[r.heardFrom] = Number(r.n);
    }
  }

  return { steps, plans, sources, referrers, heardFrom };
}

const pctFunnel = (x) => (x === null ? 'n/a' : `${Math.round(x * 100)}%`);

function printFunnel(m) {
  console.log('funnel (30d)');
  for (const s of m.funnel.steps) {
    const tail = s.ofPrevious === null
      ? ''
      : `    ${pctFunnel(s.ofPrevious)} of previous, ${pctFunnel(s.ofLanding)} of landing`;
    console.log(`  ${s.label.padEnd(22)}${s.n}${tail}`);
  }
  const plans = PLAN_KINDS.map(([kind, name]) => `${name} ${m.funnel.plans[kind] ?? 0}`).join(' · ');
  console.log(`plans selected (30d)     ${plans}`);
  console.log('sources (30d)            landing views · bookings confirmed');
  if (!m.funnel.sources.length) console.log('  (none)');
  for (const s of m.funnel.sources) {
    console.log(`  ${(s.source ?? '(direct)').padEnd(22)}${s.visits} · ${s.confirmed}`);
  }
  console.log('referrers (30d)          landing views · bookings confirmed');
  if (!m.funnel.referrers.length) console.log('  (none)');
  for (const s of m.funnel.referrers) {
    console.log(`  ${(s.referrer ?? '(none)').padEnd(22)}${s.visits} · ${s.confirmed}`);
  }
  const heard = Object.entries(m.funnel.heardFrom);
  console.log(`heard from (30d bookings) ${heard.length ? heard.map(([k, n]) => `${k} ${n}`).join(' · ') : 'none'}`);
}

const ils = (agorot) => `₪${(agorot / 100).toLocaleString('he-IL')}`;

function main() {
  const path = process.env.DB_PATH || join(process.env.DATA_DIR ?? './data', 'results.db');
  const m = measure(new DatabaseSync(path, { readOnly: true }), new Date());
  if (process.argv.includes('--json')) { console.log(JSON.stringify(m, null, 2)); return; }
  console.log(`active students (30d)     ${m.activeStudents} / 10`);
  console.log(`revenue ${m.revenue.month}         paid ${ils(m.revenue.paidAgorot)} · owed ${ils(m.revenue.owedAgorot)} / ₪10,000`);
  const mix = m.planMix.plans.map((p) => `${p.name} ${p.count}`).join(' · ');
  console.log(`plan mix (30d bookings)   ${mix} · other ${m.planMix.other}`);
  for (const n of m.notes) console.log(`note: ${n}`);
  printFunnel(m);
}

/* argv[1] is '-' when the script is piped to `node -` over SSH. */
const arg = process.argv[1];
if (!arg || arg === '-' || import.meta.url === pathToFileURL(arg).href) main();
