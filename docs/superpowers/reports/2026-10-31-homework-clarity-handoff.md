# Homework clarity/progress slice — engineering handoff

## Scope and authority

Task `t_0ce74a2e`, bounded slice of Todoist `6hpRcPVgRHcqMXcH` / `t_d65510f4`.
UX specification consumed: `t_3629f800` and this slice's explicit no-photo acceptance criteria; `PRODUCT.md` remains binding.
Base: `c933d2d` on `origin/main`. Independent UX/reliability approval is **not** supplied by this engineering handoff.

## Implemented

- Numbered Hebrew RTL task articles, explicit context/data/instruction layout where present in the source, separate spaced data lines, and sequential line-start numbered problems.
- Existing skill and assignment date shown when present, due date only when present. Assignment date is labelled **ניתן ב־**, not misrepresented as a lesson date. The existing family homework payload has no lesson topic/date association: no new lookup or inferred association was added.
- Written-task-only submitted-or-graded count + native progress element, labelled `מטלות בכתב הוגשו או נבדקו` / `הגשת מטלות בכתב`, live count announcement, and explicit distinction from a tutor judgement. Rows with game `url` are excluded from numerator and denominator regardless of visit/play history: this is not overall homework completion or game mastery. Existing skill-progress information remains unchanged below it. Count includes the existing written-task history (including display-only legacy rows), not an invented "active lesson" subset.
- Existing reversible, server-confirmed submission path retained for writable written tasks. Stable keyed DOM, task-specific accessible toggle names/states, visible focus, 44px controls, pending duplicate protection via existing function guard. `aria-disabled` keeps keyboard focus during saving. Graded work remains settled, games retain game links, legacy tasks without a database ID are display-only rather than a nonfunctional save control.
- Text-node-only rendering through existing `FormulaText` in all sections. No HTML interpretation; long content reflows while retaining bidi isolates.

## Compatibility boundary (review explicitly)

`task` is an unstructured string, not a structured exercise schema. This slice **does not** change generation, persistence, API fields, auth, or migrations. It recognizes explicit `נתונים:` / `הנתונים:` / `נתון:` followed by `שאלה:` / `השאלה:` / `הוראה:` / `הוראות:`; splits top-level newline/semicolon/comma-space datum separators while preserving decimals, nested tuples and delimited math. Sequential numbered problems must start at the beginning of the task, on separate lines.

Unknown/ambiguous free prose is retained intact (including line breaks), not silently rewritten or classified by guessed mathematical meaning. Thus **automatic semantic separation of every possible legacy/generated free-form task is not claimed**. Missing metadata is omitted, not fabricated. UX/lead should explicitly judge whether this conservative compatibility boundary is acceptable for this independent first slice; broader structured content/generation work is outside this PR.

Completion uses the existing task-level `submitted` flag; no independent per-subproblem persistence is invented. Completing written work retains the existing submission/tutor-notification behavior, not a new local-only checklist.

## Verification

Executed on Node v22.22.0:

- `npm run build`: PASS.
- `npm test`: **1622 passed, 0 failed, 0 skipped**.
- `npm run check:ci`: PASS, **22 warnings at existing baseline**.
- `git diff --check`: PASS.
- `npm audit --omit=dev`: 0 vulnerabilities. `npm ci --ignore-scripts` reported 9 total dev-inclusive advisories (6 low, 3 high); dependency changes are excluded from this slice.
- `PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/browser/homework-clarity.mjs`: PASS on headless Chrome **148.0.7778.96**. Browser tool installed only under scratch, no project dependency/lockfile changes.
- Synthetic viewport/page widths: 320/320, 390/390, 1440/1440. 200% text at 320: page width 320. Browser caught and verified a badge reflow correction.
- Browser checks exercise explicit sections/numbered problems, omitted absent dates, literal hostile markup, graded/no-ID/game states, focus outline/44px size, Space activation, pending non-optimistic count and duplicate prevention, server-failure alert/unchanged state, retry/undo, reload, empty state. A final phase uses **unintercepted local API + disposable SQLite** to prove submission persistence and undo across reload; other edge-state fixtures are deliberately intercepted synthetic responses, not claimed as API evidence.
- TDD: parser section/numbering/math-delimiter failures observed before implementations; browser heading assertion failed against the original built board. Existing formula-isolation source test updated to cover every projected section, not bypassed.

No real Safari/iPhone/Android device or manual screen-reader testing run. No WCAG conformance claim. Independent UX/reliability review remains required before merge; exact-head GitHub checks must be read from the PR, not inferred from these local results.

## Bounded review remediation — `t_6f1a2338`

Consumed lead findings against prior PR head `18ad61be1e9becfde2d2c35f5dcef71d36465a80`; no independent UX approval is supplied here. The submission button's accessible name now matches its visible initial (`סיימתי`), pending (`שומר…`), submitted (`ביטול הגשה`), and undone actions. Existing pressed/busy/disabled semantics and server-confirmed PATCH remain unchanged.

Browser regression assertions failed before each correction (pending accessible-name mismatch; aggregate incorrectly `2 מתוך 5 מטלות הושלמו`), then passed. Coverage now checks initial/pending/submitted/undo names, pending undo, unplayed game exclusion, synthetic visit/play-history/return without completion evidence, unchanged separate mastery, and game-only `0 מתוך 0` without an invalid zero-max progress bar. The synthetic game document is only a navigation fixture, not evidence that a real game was completed. Local real-API submission/reload/undo coverage remains in place.

Remediation verification: build PASS; full `npm test` 1622 passed / 0 failed / 0 skipped; `check:ci` PASS at existing 22-warning baseline; browser PASS on Chrome 148.0.7778.96 at 320/390/1440 widths and 200% text; `git diff --check` PASS. Real device and manual AT: **NOT_RUN**. Exact published SHA and hosted checks are recorded in the PR/Kanban handoff after publication. No API/model/auth/generation/persistence/migration/photo change. Ambiguous prose remains intact and lesson topic/date inference remains absent.

## Privacy, release and recovery

No real records/photos, sensitive KB paths, production databases/credentials, paid generation, family contact, or production access. Test harness isolates all data and disables real external services; browser blocks nonlocal requests.

No camera, picker, preview, upload UI, file storage, endpoint or migration. Photo scope remains blocked on the parent product/privacy decisions. No merge/deploy or Todoist completion performed. Rollback is a code revert (no data migration); any merge/deploy needs Lior's approval.

Synthetic screenshots and browser JSON are attached to the Kanban handoff, not committed as generated binary artifacts.
