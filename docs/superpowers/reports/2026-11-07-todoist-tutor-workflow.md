# Tutor workflow tasks — 7 November 2026

Source: the shared MeaBeclick Todoist project. Lior authorized work on the
teaching tasks and asked for important decisions to use brainstorming and
grilling. This batch addresses five clear fixes; it does not implement all
35 open project tasks.

## First implementation batch

| Todoist task | Result |
|---|---|
| `6hwqGjG8P4v79qxq` dashboard links | Remove the stretched roster-link overlay that can cover unrelated controls when table-row positioning is unsupported. New student opens its dialog; report links open their booking. |
| `6hwqRhXxHpwM2cjH` payment controls | Keep a semantic table on mobile, 18px checkboxes inside 44px targets, date ordering, paid/unpaid filters, existing selection and real single/bulk mutations. Hidden selections remain explicit. |
| `6hwqV7hXX2cqqfxH` tutor games | Tutor-only previews use published game snapshots, keep tutor return context and cannot submit or flush student results. Draft previews and student-signed links stay separate. |
| `6hwqVcvmXxQMJ2fq` prepared lesson dates | Show the actual lesson date/time in Israel, with an explicit unscheduled state. Do not substitute the generation date. |
| `6hwqcXCXx9pMHGfH` library return | Both catalog and due-skill presentation links open a tutor viewer with a visible return to the exact library filters. Existing documents remain unchanged. |

Implementation is local on `codex/todoist-tutor-fixes` in a dedicated managed
worktree. Lior requested dedicated worktrees when isolation is needed; future
independent batches should follow that preference. The original checkout is
back on `main`, with its unrelated marketing notes preserved. Todoist completion
and production verification are separate from local implementation.

## Decisions confirmed by Lior

For `6hwqVPWRXc978hhq` (adaptive games):

- Every finite question-based game should run for at least ten questions.
- Difficulty adapts within the assigned lesson skills. Record the difficulty
  played; changing the learning plan remains a tutor decision.
- Speed drill keeps its timer and has at least ten questions available;
  the timer can expire before ten answers.

For `6hwqXHq5mW46xGWH` (end-of-lesson reporting): teaching coverage and
understanding are separate. “Not covered” means still to be taught, not
“needs review” or a claim that the student struggled.

## Investigated follow-up work

These are implementation recommendations, not completed changes:

- Adaptive games need difficulty metadata, enough questions at each level,
  a bounded selector, per-question evidence and backward-compatible reads.
  There is no universal six-question cap: current limits come from the
  registry, and several templates allow fewer than ten. Preserve historical
  assigned games and library masters.
- Reports already update learning-plan statuses and influence homework and
  future lesson targets. Add the missing presentation-specific checklist,
  per-topic comments and a snapshot of the taught material version. Only
  covered skills should feed taught-homework generation. Corrections need
  authoritative latest revisions while preserving earlier history.
- For `6hwqXg7qVqf9FGqq` (editor additions), generate one relevant candidate
  from the current unsaved lesson and selected item kind. Offer accept,
  edit and retry, preserving explicit save/publication. Blank additions and
  cloning an existing question do not satisfy this request. Use the existing
  lesson engine and validators rather than regenerating the whole lesson.

## Verification entry points

- `npm run build` and `npm run check:ci`.
- `npm test` under the CI platform: Linux, Node 22, an unprivileged user.
- `node tests/browser/todoist-tutor-navigation.mjs`.
- `node tests/browser/tutor-game-preview.mjs`.
- `node tests/browser/tutor-payments.mjs`.
- `npm run test:workspace:browser`.

All browser fixtures are synthetic. The navigation regression simulates
unsupported table-row positioning in Chromium; it is not an iOS Safari run.

Final results: Linux/Node 22.20.0 build, warning gate (22 existing warnings)
and all 1,753 tests passed under an unprivileged user. The three focused
browser scripts and existing workspace browser suite passed. Payment and
library journeys were inspected at 390px and 1440px; the existing workspace
suite also checked 320px. Independent bounded review found the second library
view link bypass, which was corrected before final verification. No deployment
or customer-content replacement was performed.
