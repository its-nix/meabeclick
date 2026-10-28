# Verified development loops — proposal (v1)

**Status: proposed, not activated.** This is a project-level operating proposal; it does not configure Hermes, cron, GitHub, production, or external messaging. `PRODUCT.md` remains the authority for product decisions; this file only defines evidence and workflow expectations. The current Hermes/Nix OS policy files requested by the mandate were not present in the checked-out `/home/liornisimov/Projects/os` paths, so this document does not claim OS-level approval or topology compliance.

## Observed baseline (2026-10-28, Asia/Jerusalem)

| Area | Observation | Status / evidence |
|---|---|---|
| Repository | `origin` is `https://github.com/its-nix/meabeclick.git`; base `bb8a55748c6f61f18e097c188792a14352fc01dc`; task worktree initially clean. | Verified locally. |
| Product authority | `PRODUCT.md` ranks tutor preparation time first and parent-visible progress second; March 2027 business values are targets; new-feature gate is 10 consecutive clean delivered Codex generations. | Verified in `PRODUCT.md`; no current outcome inferred. |
| Hermes profiles | `default`, `meabeclick`, `meabeclickeng`, `meabeclickgrowth`, `meabeclickux` appeared running in `hermes profile list`. | Snapshot only; not a permission/security audit. |
| Kanban | On board `meabeclick`: 1 running, 6 blocked, 11 done, 106 archived. Six blocked titles were inspected; four assigned to lead, one engineering, one UX. Existing blocked work includes enabling generation health check; do not duplicate it. | Read-only board DB inventory + `hermes kanban stats`; no bodies/PII copied here. Queue is not empty. |
| Scheduler | Current profile has one active `nix-skill-scout-meabeclick`, `40 18 * * 6`, local delivery; last run 2026-10-24 completed `ok`. Gateway reports running, heartbeat 55 seconds, cron doctor found no issues. | Verified for `meabeclick` only. Other profiles' schedules were not inventoried. Do not create another dispatcher or edit this job. |
| GitHub | Open PRs #65–69: restore-db safety (#65), synthetic release environment (#66), and three dependency bumps (#67–69). Each had a completed `build` success and `deploy` skipped at inspected head; no merge/deploy authorized. | Live `gh pr list` snapshot; exact-head status may change. |
| Product metrics/gate | `node scripts/vision-metrics.mjs --json` failed to open its default local DB (`SQLITE_ERROR`, unable to open database file). No production DB was accessed. | Gate, funnel, prep-time, and revenue outcomes are **UNKNOWN** here; not passed or failed. |
| Local test readiness | Node 22.22.0 and npm 10.9.4 are available; `node_modules` is absent. | Full app checks not run; no dependency installation performed. |
| OS governance files | `README.md` and historical `docs/ARCHITECTURE.md` exist in `/home/liornisimov/Projects/os`; the latter explicitly marks old topology superseded. The mandated current `nix-os.yaml`, profile `ROLE.md`s, `STATE-AND-SECRETS.md`, `config/hermes.example.yaml`, `skills/packs.json`, and `automation/skill-scout/jobs.json` were absent at the requested paths. | Governance/topology and profile least-privilege cannot be independently verified from those paths. No changes made to OS repo. |

## Loop contract template

Every deployed procedure must record: **name | goal | owner | trigger/cadence (Asia/Jerusalem) | input authority | bounded steps | verification oracle | completion/stop | failure circuit-breaker | escalation | durable evidence | idempotency key | cost/WIP budget**. “Proposed” or “tested locally” is not “operational”. Event-driven activation is preferred; quiet healthy checks return `NO_CHANGE`, with no card or message. No task is done on worker prose alone.

## Proposed contracts (not activated)

### A. Lead priority / WIP

`A | preserve tutor time and parent-visible progress | meabeclick | Kanban state change; weekday 08:30 read-only reconciliation only if a useful deterministic check exists | PRODUCT.md, board, open PRs, approved aggregates only | dedupe; rank allowed work; enforce ≤2 concurrent items and ≤1 substantial implementation PR per engineer; assign bounded cards; verify handoffs | exact tests/PR-head checks/independent review and product gate evidence | NO_CHANGE if no actionable signal; stop at WIP cap or human gate | after 3 evidence-based attempts or repeated same-cause failure, stop and block/reroute | LNX for critical/decision-required only | board links, PR/SHA, exact test output | board task ID + source signal fingerprint | max two active work items; no spend`.

Current lead findings: existing queue includes blocked work; no live product metrics are available in this run. Avoid duplicate daily health checks: PR #60 is merged, PR #56's generation health check is merged, and board task `t_912863d9` is blocked on enabling the check. The latter is not authorized here because it may require server/production changes.

### B. Engineering defect to reviewable PR

`B | fix one reproducible regression without risking family data | meabeclickeng | actionable issue, failed exact-head CI, scoped lead task | synthetic fixtures, PRODUCT.md, repo/CI | reproduce; make one coherent isolated change; run build/tests/check:ci and relevant browser flow; open focused PR; request independent UX review for family-facing changes | regression test + current PR-head CI + reviewer verdict | stop at review-ready; never merge/deploy | max 3 evidence-based attempts; preserve failure and block on missing proof | lead; Lior for release | branch, diff, test output, SHA, CI URL, reviewer result | issue/card ID + base/head SHA | one substantial PR per engineer; no production/customer data`.

### C. Independent synthetic UX / education QA

`C | make mobile Hebrew/RTL and teaching presentation verifiable | meabeclickux | changed relevant PR or scoped spec request | PRODUCT.md and canonical `docs/quality/*`; synthetic-only examples | inspect actual DOM/browser at phone and desktop widths; test RTL/LTR maths, accessibility, errors/loading; report severity and reproduction; independently rerun after fix | reproducible findings and screenshots without real user data; absence of future feature is NOT_IMPLEMENTED | PASS or bounded change request; stop on product decision | no self-review; request changes/block on missing artifact | lead | task/spec, synthetic fixture, reproducible viewport/check results | PR SHA + scenario ID | no production generation/model spend absent measured cost approval`.

### D. Aggregate growth review

`D | identify one measurable zero-spend enrollment friction hypothesis | meabeclickgrowth | weekly Monday only after approved aggregate source is accessible | existing aggregate metrics only; no row-level family data | define segment, baseline/window/denominator or UNKNOWN, one change, metric, observation window, zero budget, stop/rollback; route through lead | reproducible aggregate denominator and later outcome | inconclusive if insufficient observations; stop after one proposal | no inventing denominators; no tiny-cohort overfit | lead, then Lior for any outreach/publication/spend | query/script/version/window and proposal card | source window + hypothesis ID | one active proposal, default spend zero`.

### E. Student learning evidence (product loop, not agent-per-child)

`E | show attributable, truthful progress and next action | lead (design), UX (journey), engineering (app) | only after product implementation: completed report, submitted/graded practice, or learning need | app-owned SQLite facts, scoped to authorized student and correct skill | store attributable evidence; distinguish coached from independent work; create tutor-confirmed suggestion | deterministic identity/skill/scoping tests and authorized UI review | remain `not_checked`/`needs review` absent proof | hold on wrong attribution, missing provenance, or exposure | lead; privacy incident to LNX immediately | synthetic tests and code/CI evidence only | event ID + implementation version | no export of individual student records; no Hermes agent per child`.

### F. Harness improvement

`F | prevent repeat failure with the smallest reusable verifier | lead + independent specialist | weekly or repeated failure category | test/CI/review evidence only | choose one missing fixture, test, runbook, or instruction; implement one bounded improvement | test demonstrates the failure would be caught; full suite when available | NO_CHANGE if no recurring preventable failure | stop after three attempts; retain failing evidence | lead | test path, output, PR/SHA | failure-category fingerprint | one harness change at a time; no framework/skill acquisition`.

### G. Educational artifact quality

`G | ensure generated lesson content is accurate, relevant, legible, and useful | engineering harness + independent UX; lead owns interpretation | generator/schema/renderer/intake/scoring change; any recurring rubric failure | synthetic Hebrew briefs with known solutions, existing quality rubrics, baseline references | test request precedence, source mapping, answer keys, multistep exam-style practice, slide render/phone screenshot; independently inspect answer key | deterministic maths checks where possible + second-person answer-key inspection + actual rendered screenshot | any wrong key, unintended topic, private-content leak, or broken renderer = HOLD/FAIL | no auto-PASS; stop on missing independent check | lead; Lior on product-rule decision | prompt/fixture ID, rendered image path, test result, reviewer | contract version + scenario ID | bounded synthetic samples, no unnecessary paid generation`.

## Delegated work created 2026-10-28

These are queued work, not completed results:

- `t_b83ebb43` — `meabeclickeng`, reproduce the specific lesson request vs plan/library precedence using synthetic fixtures; ready at creation. No code change is presumed necessary.
- `t_2aa27f12` — `meabeclickux`, specify the synthetic educational-content verification corpus and visual/RTL acceptance checks; ready at creation.
- `t_289c4211` — `meabeclickgrowth`, aggregate baseline and one zero-spend hypothesis only if supported; gated in `todo` until this lead task completes.

No other work was created. Existing blocked card `t_912863d9` already covers enabling the generation health check, so it was not duplicated.

## Safe local harness prototype

`node scripts/agent-loop-dry-run.mjs <state-path>` accepts one JSON object from stdin: `{"fingerprint":"opaque-synthetic-id","actionable":false}`. It writes only to the explicitly supplied local state path and emits either `NO_CHANGE` or one `PROPOSED_ACTION` with a stable idempotency key. It does **not** create Kanban tasks, call Hermes/cron, message LNX/Discord, access product or production data, or prove scheduler activation. It is a single-process dry-run prototype; concurrent invocations and remote orchestration are out of scope. Exercise it only with synthetic input and scratch state.

## Activation gates / explicitly unknown

Before any recurring agent schedule or external delivery: reconcile the actual current OS governance files and all relevant profile/board permissions; verify only one board dispatcher; inspect every related profile's active schedule by unique job ID/name; agree on WIP/cost settings; test no-change and changed-state behavior; specify local evidence retention and LNX delivery; and obtain OS/config approval for any scheduler/topology mutation. Existing systemd timers remain untouched. Nothing in this document activates A–G.
