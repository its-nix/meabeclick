# Implementation map

Paths are relative to the MeaBeclick checkout. Verify current callers before editing; this map is a starting point.

| Concern | Source |
|---|---|
| Engine invocation, lesson plan and validation | `src/lib/server/lesson/prep.ts`, `engine.ts`, `spawn.ts`, `structured-output.ts` |
| Hebrew teaching instructions, learning contract | `src/lib/learning/schema.ts`, `model.ts` |
| Shared brand and original logo | `src/lib/brand.ts`, `src/lib/components/BrandMark.svelte` |
| Presentation, interactive practice and print | `src/lib/server/learning-render.ts`, `src/lib/learning/{runtime,visual,styles,math}.ts` |
| Private notes | `src/lib/server/presenter-notes.ts`, tutor presenter route |
| Versioning, assignments, evidence, progress | `src/lib/server/learning-store.ts`; inspect current exports |
| Games | `games/registry.json`, `src/lib/server/lesson-games.ts`, `src/lib/games/`, `src/routes/app/play/[template]/` |
| Fresh versus reused lessons | `src/lib/server/lesson/queue.ts` and its library lookup imports; inspect actual reuse before changing it |
| Synthetic review briefs and runner | `scripts/learning-review-cases.mjs`, `generate-learning-review.mjs`, `package-learning-review.mjs` |
| Versioned synthetic corpus and protected review routes | `src/lib/server/learning-review*`, `src/routes/app/learning-review/`, `src/routes/app/review-game/` |
| Quality contract and feedback history | `docs/quality/interactive-learning.md`, `presentation-standard.md`, `learning-feedback.md` |

Review samples are public-repo-safe synthetic fixtures behind a tutor-only runtime route. Do not use the library import API as a shortcut: a ready master can become eligible for customer reuse. Do not create real bookings merely to run quality checks.

The CLI subscription/model availability can differ between local and production accounts. Verify the actual runtime, pin a supported model for a batch, and retain model, effort, CLI, source fingerprint, input and output checksums. Do not claim the exact production billing tier from a local login.

A useful feedback record is:

```
ID / status / candidate version
Example and stage (synthetic or anonymized)
Observed: ...
Wanted: ...
Root cause and affected assets: ...
Fix, regression evidence, before/after links: ...
Deployment and rollback reference: ...
Teaching feedback still needed: ...
```

For batch/resume/replacement commands and stale-lock recovery, read `docs/quality/learning-review.md`. Prior released review corpora are preserved in Git history; temporary generation folders alone are not durable evidence.

V2 contracts: `learning/teaching*.ts`, `server/lesson/teaching-context.ts`, `official-questions.ts`, `server/teaching-display.ts`. Report coverage and safe release: `server/reports/teaching-coverage.ts`, `server/lesson/taught-bundle.ts`, migration038. Actual publication navigation: `server/assigned-teaching.ts`; original-class versus assigned-homework routing: `server/learning-store.ts`. Use both unit tests and live `teaching-lifecycle` / `teaching-report-coverage` characterization tests for changes at these seams.

Checked game geometry lives in `src/lib/games/diagrams.ts`; v2 wire output is expanded by `lesson/prep.ts` before validation. Shared graph axes live in `src/lib/games/graph-plot.ts`. Keep catalogue IDs stable for already published material; add versioned IDs for changes.

## Composed visual calibration

- Contract/math/projection/checking: `src/lib/learning/deck/model.ts`, `normal.ts`, `schema.ts`.
- Authoring prompt and real Codex boundary: `rules.ts` in that directory and `src/lib/server/lesson/visual-generation.ts`. Task schema fixes question controls/probability flags; source-specific branches fix official identifiers/answer metadata. Human review still checks visible reasoning.
- Shared HTML, responsive/print design and controls: `src/lib/server/visual-deck-render.ts`, `src/lib/learning/deck/styles.ts`, `runtime.ts`. Preserve common axes, model/control agreement and screen state after printing.
- Isolated review: `src/lib/server/visual-pilot.ts`, `/app/learning-pilot`, `/api/learning-pilot`; memory-only preview attempts, no customer evidence writes.
- Provenance/packaging: `scripts/generate-visual-pilot.mjs`, `visual-pilot-validation.mjs`, `package-visual-pilot.mjs`; immutable generated bundle plus sealed source fingerprint. Output is `learning-pilot-corpus.json`; it does not activate production generation.
- Evidence: visual-deck/generation unit tests, visual-pilot HTTP characterization, `npm run test:pilot:browser` (focused controls plus complete packaged candidate). Real candidate content and reference comparison remain mandatory.
