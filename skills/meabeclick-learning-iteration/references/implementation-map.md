# Implementation map

Paths are relative to the MeaBeclick checkout. Verify current callers before editing; this map is a starting point.

| Concern | Source |
|---|---|
| Draft jobs per booking, retries, review state | `src/lib/server/native-learning/jobs.ts`, `worker.ts`, `preparation-brief.ts` |
| Authoring, generation and independent validation | `native-learning/authoring.ts`, `validation.ts`, `preparation-review.ts`; engine in `src/lib/server/lesson/{engine,spawn,prompt,structured-output,visual-generation}.ts` |
| Authoring policy and review criteria | `src/lib/learning/deck/rules.ts`, `review-rules.ts` |
| Slide contract, math and checking | `src/lib/learning/deck/{model,normal,schema}.ts` |
| Official questions | `src/lib/server/lesson/official-questions.ts` |
| Bundle export, Google Slides/Docs registration, Drive layout | `native-learning/bundle.ts`, `register.ts`, `src/lib/server/central-drive/` |
| Approval, student games, homework sharing, results | `native-learning/{approval-google,approval-sync,games,student-games,homework-share,results}.ts` |
| Shared HTML, controls and print | `src/lib/server/visual-deck-render.ts`, `src/lib/learning/deck/{styles,runtime}.ts` |
| Protected review activities | `src/lib/server/visual-pilot.ts`, `/app/native-review-activities`, `/api/learning-pilot` |
| Shared brand and original logo | `src/lib/brand.ts`, `src/lib/components/BrandMark.svelte` |
| Feedback on registered files | `src/lib/server/learning-feedback/` |
| Quality contract and feedback history | `docs/quality/visual-math-calibration.md`, `learning-feedback.md` |

Review samples are public-repo-safe synthetic fixtures behind a tutor-only runtime route. Do not create real bookings merely to run quality checks.

The CLI subscription/model availability can differ between local and production accounts. Verify the actual runtime, pin a supported model for a batch, and retain model, effort, CLI, source fingerprint, input and output checksums. Do not claim the exact production configuration was exercised unless it was.

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

Prior released review corpora are preserved in Git history; temporary generation folders alone are not durable evidence.

## Composed visual calibration

- Contract/math/projection/checking: `src/lib/learning/deck/model.ts`, `normal.ts`, `schema.ts`.
- Authoring prompt and real Codex boundary: `rules.ts` in that directory and `src/lib/server/lesson/visual-generation.ts`. Task schema fixes question controls/probability flags; source-specific branches fix official identifiers/answer metadata.
- Shared HTML, responsive/print design and controls: `src/lib/server/visual-deck-render.ts`, `src/lib/learning/deck/styles.ts`, `runtime.ts`. Preserve common axes, model/control agreement and screen state after printing.
- Isolated review: `src/lib/server/visual-pilot.ts`, `/app/native-review-activities`, `/api/learning-pilot`; memory-only preview attempts, no customer evidence writes.
- Provenance/packaging: `scripts/generate-visual-pilot.mjs`, `visual-pilot-validation.mjs`, `package-visual-pilot.mjs`; immutable generated bundle plus sealed source fingerprint. Output is `learning-pilot-corpus.json`.
- Evidence: visual-deck/generation unit tests, visual-pilot HTTP characterization, `npm run test:pilot:browser`. Real candidate content and reference comparison remain mandatory.
