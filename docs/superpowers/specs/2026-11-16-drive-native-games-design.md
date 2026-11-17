# Drive-native games as the only game system

Status: DRAFT for the owner. Decisions marked **DECIDE** need Lior before
build. Nothing in this document deletes code; removal is step 4 and waits for
steps 2 and 3. Todoist: 6j2wr8hwPFF4PVPH.

## Decision already made (PRODUCT.md, Lesson autopilot, 2026-11-16)

One practice-game system, the Drive-native one. Game types are code in the
site; the content of each game, tailored to the student, is JSON in Drive,
copied into the site database on tutor approval so a student session never
waits on Google. The classic system and the legacy site-made lesson pages are
removed completely, with no backwards compatibility.

## What exists today (audited 2026-11-16)

| | Classic (to remove) | Native (to keep and extend) |
|---|---|---|
| Game types | 12 templates under `src/lib/games/*`, played at `/app/play/[template]` | Game kinds `region`, `axis`, and (added 2026-11-16) `quiz`. Round checks already include `choice` (2-4 options), `number` and `tutor-review` open-ended (`VISUAL_LESSON_SCHEMA`, `deck/schema.ts`, `gradeDeckTask`) |
| Content store | `lesson_games` (migration 033), `game_filler` (031), seed files | `games` array inside the generated bundle, kept in the native job snapshot |
| Validation | `validateSemantics` in `lesson-games.ts`, per template | `visualLessonProblems` in `deck/model.ts` |
| Student results | `results_v2` (score, total, tries, stars, seconds, missed per `data_id` and `template`), `getBest`, feeds parent progress | None. The review runtime records no learner scores. Preview grader is isolated |
| Student delivery | Portal links to `/app/learn/*` and `/app/play/*` | Blocked until owner approval of a real teaching review |
| Open-ended work | Not a template | Tasks already carry `grading: 'checked' | 'tutor-review'` |

## Design

### 1. Drive JSON file

One JSON file per lesson in the student's Drive folder, next to the Slides and
Docs homework. Shape: `{ version, lessonRef, games: [ { id, title, intro,
kind, rounds: [...] } ] }`. Every round names the plan skill it practices
(`skillNodeId`). The file is the editable source; Nikol or Lior can fix a
question in Drive.

Validation reuses the existing bundle validator, so the same rules apply
whether content was generated or hand-edited: no keyboard math in prose
(`^ { }`, `a_1`; added 2026-11-16), TeX only inside `\( \)`, answers hidden from
student artifacts. A file that fails validation is never copied.

### 2. Copy on approval

When the tutor approves a lesson, the site reads the file at a recorded Drive
revision, validates it, and writes it to a new `native_games` table with the
revision id and a content hash. Students read only from the database. Editing in
Drive after approval creates a new revision that the tutor must approve again;
the student keeps the approved copy until then.

### 3. Question kinds

Build on the existing round shape (`prompt`, `hints`, `solution`, `grading`,
`check`). Add check kinds beyond `region` and `axis`.

**DECIDED 2026-11-16 (kinds, first wave): `choice`, `number`, open-ended.** These
already exist as task checks (`choice`, `number`, `grading: 'tutor-review'`), so
the first increment was only allowing a `quiz` game kind whose rounds use them
(done, test-first, `tests/unit/visual-deck.test.mjs`). Remaining here: the
generator prompt in `rules.ts` still describes only two games of region/axis, so
it will not yet produce quiz games. Second wave: matching, sequence, error hunt,
the classic templates Nikol still uses. The classic templates are not
ported wholesale; only kinds a tutor actually assigns.

### 4. Results and parent evidence

New `native_results`: `student_id`, `booking_id`, `game_id`, `round_id`,
`skill_node_id`, `outcome` (`correct`, `assisted`, `incorrect`,
`awaiting-review`), `attempts`, `seconds`, `at`. A `tutor-review` round writes
`awaiting-review` and the tutor records the outcome. Everything that reads
`results_v2` today (`results.ts`, `lessons.ts`, `lesson-games.ts`,
`storage-inventory.ts`, and whatever feeds parent progress through them) switches to this table;
step 2 starts by tracing exactly which parent-evidence paths depend on it.

**DECIDED 2026-11-16 (skill mapping).** Recommended: the generator assigns `skillNodeId`
per round from the student's plan at authoring time, and validation rejects a
round whose node is not visible to that student (same rule as
`assertSkillForStudent` today). The alternative, mapping at play time, loses
the tutor's ability to correct it.

### 5. Delivery to the student (revised 2026-11-16)

Principle (Lior): build on the tools Google already exposes instead of building our
own, for the reliability at little cost.

- **Homework is the Google Doc**, not a site page. The native pipeline already
  produces it (question-only, formulas as images). Tables, figures and extra
  material are links to Drive files shared with the same person.
- **Access:** students are expected to have Google accounts now. The Doc is shared
  to the student's (or parent's) Google account directly. Where a student has none,
  link sharing is the fallback. This replaces the earlier assumption that students
  rarely have a Google account and that the site must render homework.
- **The site is for games only**, played from the approved DB copy. The homework
  Doc links to its games.
- **Privacy guard conflict:** `central-drive/api.ts` fails with `privacy` when any
  file or the root has a permission that is not a named user or group. Sharing to a
  student's account passes. Link sharing does not, so a fallback needs a deliberate
  exception: student-facing homework Docs live in a published folder outside the
  private-root check, contain no student identity or answers, and use unguessable
  links. Tracked in Todoist.
- **Homework upload groundwork (6hpRcPVgRHcqMXcH):** no site upload. Each homework
  Doc links to a submission folder in Drive that the student can add to. A future AI
  grader and the tutors read submissions from Drive.

## Steps

1. This spec, reviewed by the owner.
2. Build in native: new kinds, Drive read and validate, copy on approval,
   `native_results`, game delivery (homework is already the Google Doc). Tests first for each kind and for the
   copy-on-approval path.
3. Repoint student, parent and tutor links from `/app/learn/*`,
   `/app/lessons/*/edit` and `/app/play` to the native path. Replace the
   `/learn/parabolas` landing sample with a native sample game.
4. Remove classic: routes, templates, `lesson_games`, `game_filler`, seeds,
   legacy tests (about 15 files, including the characterization test that
   asserts historical URLs stay valid). Drop the tables in a migration.

## Done when

A student plays a Drive-sourced multiple-choice game on the site; the result
appears on the parent page against a plan skill; no classic code or route
remains. Verified with real Google (not a mock), the browser tests on the
supported Linux Node 22 environment, and a bounded independent review.

## Risks

- Removing classic before step 2 ships stops parent evidence.
- Policy files are pinned by `authoring-manifest.json` and
  `renderer-manifest.json`; changing the validator gives future native drafts a
  new identity. Already true after the 2026-11-16 math rule.
- `feat/sitewide-ux-20261114` (another agent) rewrites the student, parent,
  portal and booking pages. Step 3 waits for it to land or be dropped.

## Contracts for step 2 (so the pieces can be built independently)

Finding 2026-11-16: `NativeLessonState` is `queued | preparing | needs-preparation
| review | failed | cancelled`. There is no approval. The games live inside
`native_lesson_jobs.bundle`; no games JSON file is written to Drive today.

**DECIDED 2026-11-16 (approval lives in the Sheet, using the model that already
exists).** Drive audit the same day: the active registry is the Sheet
"01 רישום תלמידים והתקדמות" in Teaching > "02 תלמידים ומעקב" (the older
"Learning register" in the earlier tree is retired). Its schema is in
`src/lib/learning/workspace.ts` with tabs Students, Materials, Lessons,
Assignments, Progress. Approval is NOT a new checkbox or a site button:

- **Materials** (one row per slides / homework / game, `kind` includes `game`) carries
  `review_status`, `publication_status`, `audience`, `release_id`,
  `content_sha256`. Existing rule: published requires approved and a `release_id`.
  The tutor's V is `review_status = approved`, then `publication_status =
  published`. This approves per material, not per lesson.
- **Assignments** (student, lesson, material, due date, status) decides which
  student gets which material. Existing rule: release requires an approved,
  published, student-audience material.
- **Copy on approval:** when the sync sees a game Material become approved and
  published, it reads the Drive games file, validates it, and copies it to
  `native_games`, recording `material_id`, `release_id` and `content_sha256`
  (the fingerprint columns already exist for exactly this). A student can play only
  a game whose Assignment is released and whose copy exists. Fails closed.
- **Revoke:** moving the material back from published, or cancelling the
  Assignment, withdraws access on the next sync. Recorded results are kept.
- **Feedback:** the site writes only its own status column on rows it owns, never
  tutor-owned cells, so a rejected game is visible where the tutor looks.
- **Who may tick:** whoever can edit the Sheet. The site records the observed time
  and Sheet revision, not a person.
- **Lag:** next sync. Add "sync now" only if it annoys the tutors.
- **Results map to the Progress tab:** it already has `skill`, `lesson_id`,
  `assignment_id`, `outcome`, `support`, `evidence_type`, `observed_at`. Game results
  are appended there with `evidence_type = game`, and `native_results` in the
  database stays the runtime store. This replaces the plan to invent a separate
  results vocabulary.

Migration numbers are reserved up front so parallel work cannot collide:
`042_native_approval.ts` (mirror columns, filled by the Sheet sync), `043_native_games.ts`, `044_native_results.ts`.

Tables:
- `native_games(id, material_id, release_id, student_id, game_id, kind, content_json,
  source_file_id, source_revision, content_sha256, approved_at,
  UNIQUE(material_id, release_id, game_id))`. `content_json` is the validated game exactly as
  approved; answers stay in it and are stripped on the way out.
- `native_results(id, student_id, booking_id, game_id, round_id, skill_node_id,
  outcome, attempts, seconds, at)`. `outcome` is `correct | assisted | incorrect |
  awaiting-review`. `skill_node_id` is resolved on the server from the approved
  copy and is never accepted from the browser.

Functions (new module `src/lib/server/native-learning/games.ts`):
- `exportGamesFile(bundle) -> {version, lessonRef, games}`: written to the
  student's Drive folder at publish time.
- `approveNativeLesson({bookingId, sheetRevision, drive}) -> ApprovedGame[]`: called by the Sheet sync, never by a button. Reads the
  Drive file at its current revision, runs `visualLessonProblems`-equivalent
  validation, writes `native_games`, sets the job columns. Fails closed.
- `approvedGamesForStudent(studentId, bookingId) -> PublicGame[]`: answer-stripped
  via `publicVisualLesson`.
- `recordNativeResult({studentId, bookingId, gameId, roundId, outcome, attempts,
  seconds})`: server derives `skill_node_id`.

Open item for 2c: rounds carry `objectiveId`, not a plan skill node. First task of
2c is to trace how objectives relate to `plan_nodes`, then resolve the node at
approval time and store it with the approved copy, rather than widening the Drive
JSON schema.

**Traced 2026-11-17 (2c).** `objectiveId` is an id local to one bundle (`bundle.objectives[{id,title}]`); nothing links it to `plan_nodes` (stable `key`, `title`, per-student plan). `recordNativeResult` therefore resolves the node on the server from the approved round: exact `plan_nodes.key == objectiveId`, else exact normalised objective title == skill title, among the student's own visible skill nodes (the `assertSkillForStudent` rule, narrowed to the booking's enrollment). Zero or several matches store NULL, never a guess. Consequence for 2b: `approveNativeLesson` does not yet store the node with the copy; resolution happens at record time from `native_lesson_jobs.bundle`. Progress tab: the workspace schema had no `game` evidence type, so `game` was added to `evidence_type` and to the independent-demonstration rule.

New piece: `readReleaseTicks(sheet)` and `writeSiteStatus(sheet, rows)` in the sync, which are the Sheet side of approval.

Dependency order: 042 first. Then 043 plus `approveNativeLesson` (2b) and 044
plus `recordNativeResult` (2c) can proceed independently. 2d needs both.
