# Native learning feedback and worker/validator loop

Goal: staff leave ordinary Google comments, batch them for an agent in the existing
teaching Sheet, review verified proposals, and accept changes without losing file
IDs or customer history. Fresh generation requires a separately authenticated
fresh reviewer agent before native publication; missing auth never counts as approval.

Rulings: use existing isolated worktree and personal Drive connection. Keep SQLite
only for durable job locks/idempotency/audit; use two managed tabs in the existing
index for visible review controls and feedback. Do not rewrite human command cells.
Reviewer uses a new ephemeral Codex session with the same verified model, tools
disabled, bounded calls, strict JSON plus rendered image evidence. User explicitly
chose same-model independence over cross-provider setup. No authoring conversation
is passed to the reviewer; report records same-provider identity honestly. No automatic student release or arbitrary code
execution from comments. General generation-policy suggestions require explicit
human acceptance; preserve provenance and validation. Current artifact fixes are
bounded text edits with expected-content and Google revision guards; unsupported
structural/diagram changes become actionable blocked proposals, never fake fixes.

## Boundaries and tasks

1. Durable store: migration041 plus learning-feedback/store.ts and focused tests.
File/comment identity, edited-comment reopening, ready batch snapshot, leased claim,
proposal/report persistence, stale/human-edit conflicts, accepted policy ledger.
2. Google adapter: learning-feedback/google.ts and tests. Paginated comments/replies,
managed Reviews and Feedback Sheet tabs, preserved human commands, native content
readback, guarded Slides/Docs text edits, comment reply/resolve idempotency and
private owner/root verification. Sheets data comments are proposals for human
application; never automatically modify student progress or operational records.
3. Independent validator: native-learning/validation.ts and tests; reuse the installed Codex CLI with isolated reviewer sessions. Validate actual provider/model, content/evidence hashes, complete
checks/findings; provider failures are safe classified errors. No tooling or write
capabilities. Rendered review evidence prepared by shared native renderer.
4. Orchestrator and integration: scheduled collector, trusted scoped registry,
proposal author, deterministic/independent validation, human accept/apply/readback,
separate policy approval, notes/comment preservation and no duplicate work after
lost acknowledgements. Authoring worker gates fresh publication on validator and
persists report by exact bundle version. One bounded creator repair if possible;
otherwise leave failed review visible for tutor action.
5. Verification/rollout: unit tests for parser/auth/idempotency/leases/stale versions,
synthetic full lifecycle, browser/private-route guards, build/typecheck, independent
code review, actual fresh reviewer and Google smoke checks without fake student bookings.
Document phone-friendly Sheet workflow and update canonical iteration skill. Normal
PR/merge/deploy checks; preserve private review gate. Fix known deploy supersession
SHA parsing while touching rollout so API Server Error cannot fake deployment.

Execution: tasks1-3 have disjoint file ownership and run in parallel; orchestrator
integrates their explicit exported interfaces. Do not read prohibited student or
pricing directories or print credentials. All customer-assigned files stay intact.

User steering: keep first iteration simple. Same model with a separate fresh agent;
no Claude/Grok credential renewal or provider integration is in scope. Capture the
independent-review instructions in a reusable skill and shared runtime review policy.

## Execution ledger

Implemented: migration041/durable feedback store, version-bound human controls,
Google adapter, native comments/guarded edits, exact-token actions, individual
policy rollback, durable notifications, fresh same-model reviewer and one-repair
generation gate. Added reusable independent reviewer skill, tutor diagnostics and
queue link, backend status/control route, real native/PDF/player evidence.

Independent code reviewers found and verified fixes for stale renderer approvals,
stale native text during model calls, approval-before-ack durability, hidden final
failed verification, late-resolution races, policy scope and notification retries.
Focused core suites passed, build/typecheck passed with22existing warnings,16
phone/desktop journeys passed. Real model pressure rejected80% versus38% and an
answer leak. Complete corrected example passed fresh gpt-5.6-terra review with no
findings after65native previews+150browser states at1280/390 (36image pages).
No real student bookings or scores were created.

Remaining release work: final CI image/browser smoke and deployment, verify
live sample/notes/Sheet/comment processing through site OAuth, then activate the
five-minute feedback collector. Existing ChatGPT account/model remains unchanged.
The prior GitHub supersession parsing bug is fixed with a regression, so an API
Server Error body cannot silently skip deployment.

External setup verified: both Slides and Docs returned HTTP200 through the site's
saved personal Drive OAuth connection after the owner enabled the correct project.
