/**
 * Every table this app has, and what it is FOR right now.
 *
 * ## Why a list exists at all
 *
 * The move to the entity model (`*_v2`) was done table by table and never
 * finished, so "which table is the real one" became a per-table fact that
 * lived only in people's heads. Three separate production bugs in two days
 * came from reading the wrong half of a pair, each one silent:
 *
 *   #81  appendToPortal looked students up in `students` (3 rows) instead of
 *        `students_v2` (7), so every lesson generated since the migration
 *        reached nobody's page.
 *   #86  generated homework went to the portal file while typed homework
 *        went to the `homework` table, so neither side saw the other's.
 *   —    /api/students/<code>/activity reads lessons from `lessons_v2`,
 *        which has never been written to outside tests, so the tutor's card
 *        lists zero lessons however many exist.
 *
 * None of those failed loudly. Each returned an empty result, which looks
 * exactly like "there is nothing here".
 *
 * This list is the antidote: one place that states the status of every
 * table, checked by a test against the migrations, so adding a table forces
 * a decision and retiring one cannot be half-done in silence.
 */

/**
 * The statuses, chosen around the failure they exist to prevent.
 *
 * Every one of the bugs above was a READ of a table nothing writes. That
 * returns an empty list, which is indistinguishable from "there is nothing
 * here" — so it is the read, not the write, that has to be policed.
 */
export type TableStatus =
  /** Written and read today. */
  | 'live'
  /** Superseded. Still READ so old rows stay visible, never written again.
   *  Carries the condition under which the read can stop. */
  | 'draining'
  /** Schema and code exist, nothing in production writes it yet. Reading it
   *  is FORBIDDEN: it answers empty, and empty looks like no data. */
  | 'unadopted'
  /** Referenced by nothing at all. Neither read nor written. */
  | 'dead';

export interface TableFact {
  status: TableStatus;
  /** What it holds, and for 'draining'/'dead', what has to be true to move
   *  on from it. One sentence — this is a map, not documentation. */
  note: string;
}

export const STORAGE: Record<string, TableFact> = {
  // ── The entity model, which is where new work belongs ──────────────
  google_identities: { status: 'live', note: 'Verified Google subjects mapped to existing family or student authorization.' },
  google_auth_flows: { status: 'live', note: 'Browser-bound, expiring OAuth transactions and one-time pending signup profiles.' },
  accounts:      { status: 'live', note: 'The billing/login family.' },
  family_acquisition_sources: { status: 'live', note: 'Self-reported family source reused for future bookings; past booking snapshots remain unchanged.' },
  students_v2:   { status: 'live', note: 'The student. Keyed by id; `code` is the URL slug.' },
  teachers:      { status: 'live', note: 'Who teaches. One row in practice.' },
  enrollments:   { status: 'live', note: 'A student in a subject. UNIQUE per (student, subject).' },
  bookings_v2:   { status: 'live', note: 'A booked hour, keyed on student_id.' },
  engine_status: { status: 'live', note: 'Whether the lesson engine is down and until when; shown on the dashboard (migration 026).' },
  pending_bookings: { status: 'live', note: 'A booking with a known family\'s email, held until that family confirms it (migration 021).' },
  payments:      { status: 'live', note: 'Charges in integer agorot. Manual marking, no auto-billing.' },
  homework:      { status: 'live', note: 'One store for both sides since #86; `done` is the hand-marked submission.' },
  learning_assignments: { status: 'draining', note: 'Which earlier practice each student was given. Read by the native preparation brief and the Drive archive; the removed generator was its only writer. Done when no earlier lesson matters to a brief.' },
  access_credentials: {
    status: 'live',
    note: 'Hashed single-use entry: 15-minute account links and 48-hour student invitations; raw secrets are never stored.',
  },
  access_credential_audit: {
    status: 'live',
    note: 'Secret-free outcomes for access-credential redemption attempts, used for security auditing.',
  },
  calendar_failures: {
    status: 'live',
    note: 'Calendar writes that failed, surfaced on the dashboard. Written by '
        + 'db.ts flagCalendarFailure() from /api/book and read by '
        + '/api/calendar-failures. calendar_failures_v2 was meant to replace it '
        + 'and never did, so this is the one live table.',
  },

  // ── Learning plans ────────────────────────────────────────────────
  plans:              { status: 'live', note: 'One plan per enrollment, from a template.' },
  plan_nodes:         { status: 'live', note: 'Topics, branches and skills.' },
  plan_prereqs:       { status: 'live', note: 'Which skill needs which.' },
  plan_events:        { status: 'live', note: 'Append-only history: status, coverage, corrections (#85).' },
  lesson_reminders:   { status: 'live', note: 'One row per reminder attempted; UNIQUE (booking, kind) IS the idempotency guarantee.' },
  lesson_reports:     { status: 'live', note: 'The tutor\'s end-of-lesson report.' },
  lesson_report_notes:{ status: 'live', note: 'Free text attached to a report.' },
  report_prompts:     { status: 'live', note: 'Which lessons have already been chased. INSERT OR IGNORE.' },
  lesson_requests:    { status: 'live', note: 'What a parent asked for with a booking.' },
  lesson_materials:   { status: 'draining', note: 'Published plans and slides of lessons made before the Drive-native pipeline. Read by the native preparation brief and the Drive archive; nothing writes it. Done once the archive is verified and the brief no longer needs it.' },
  native_games: { status: 'live', note: 'Validated copies of tutor-approved Drive game files, written by the Sheet sync; students read only these.' },
  native_results: { status: 'live', note: 'Runtime store for native game results; Progress rows are appended from it.' },
  native_homework_shares: { status: 'live', note: 'Which approved homework Docs are shared with which student Google account, so withdrawal revokes exactly that grant.' },
  native_lesson_jobs: { status: 'live', note: 'Durable booking/student-scoped native draft jobs, retry leases and artifact IDs; review never authorizes delivery.' },
  learning_archive:   { status: 'live', note: 'One frozen archive job and its verified native-workspace receipt; source content stays in Drive and historical material storage.' },

  // ── Generation ────────────────────────────────────────────────────
  lessons: {
    status: 'draining',
    note: 'Lessons made by the removed generator, keyed on student NAME, which '
        + 'is why two students called נוגה are a real hazard here. Read by the '
        + 'tutor\'s student card, the native preparation brief and the Drive '
        + 'archive; nothing writes it. Done once the archive is verified.',
  },
  lessons_v2: {
    status: 'unadopted',
    note: 'The shape lessons SHOULD have — student_id, enrollment_id — and '
        + 'homework.lesson_id already points at it. Nothing in production '
        + 'has ever written a row. It must not be READ for lesson lists: an '
        + 'endpoint that did returned an empty list for every student, which '
        + 'reads as "no lessons yet". Only the Drive archive copies it as-is.',
  },

  // ── Draining: read so old rows stay visible; no new writer may appear.
  //    db.ts's own legacy writers are the one exception, and each entry
  //    below says whether it still has one. ─────────────────────────────
  students: {
    status: 'draining',
    note: 'Pre-entity students. Read only through db.ts\'s legacy helpers. '
        + 'Done when nothing imports those.',
  },
  bookings: {
    status: 'draining',
    note: 'Pre-entity bookings, unioned into the overlap check so an old '
        + 'hour still blocks its slot. Measured 2026-09-22: zero rows with '
        + 'start in the future, so the union\'s legacy half can go.',
  },

  // ── Dead ──────────────────────────────────────────────────────────
  calendar_failures_v2: {
    status: 'dead',
    note: 'Created by migration 001 and referenced by no code at all — not '
        + 'read, not written, not in a test. The live table is '
        + 'calendar_failures.',
  },

  // ── Marketing funnel (migration 016) ─────────────────────────────
  marketing_events: {
    status: 'live',
    note: 'A visit, click or booking step. Anonymous until a booking links visitor_id '
        + 'to it; no name/phone/email/IP/message column exists to write one in regardless. '
        + 'Raw events are deleted after 365 days.',
  },

  learning_feedback_artifacts: {status: 'live', note: 'Registered private native review files and their collection state; never student release.'},
  learning_feedback_comments: {status: 'live', note: 'Durable comment fingerprints and human reply snapshots used to fence stale reviews.'},
  learning_feedback_runs: {status: 'live', note: 'Leased feedback proposals, exact-version human acceptance and independent verification audit.'},
  learning_feedback_policies: {status: 'live', note: 'Separately accepted future generation guidance with an immutable revocation audit.'},
  learning_feedback_notifications: {status: 'live', note: 'Idempotent Google thread reply outbox; notification retries never rerun generation.'},

  // ── Bookkeeping ───────────────────────────────────────────────────
  schema_version: { status: 'live', note: 'Which migrations have run.' },
};
