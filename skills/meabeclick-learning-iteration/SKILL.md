---
name: meabeclick-learning-iteration
description: Improve MeaBeclick's generated math presentations, presenter notes, homework and games from teaching feedback. Use for lesson-generation quality changes and regressions in this repository, including feedback on numbered review examples and safe rollout to existing customers.
---

# MeaBeclick learning iteration

Work in the `meabeclick` repository; locate its checkout rather than assuming an absolute path. The canonical skill is `skills/meabeclick-learning-iteration/`. If invoked from an installed copy, update the canonical source and keep the installed copy aligned.

Read `PRODUCT.md`, `docs/quality/presentation-standard.md` and `docs/quality/interactive-learning.md` for the affected contract. Read [the implementation map](references/implementation-map.md) when choosing the layer to change. Product decisions override older implementation notes.

## Turn feedback into a reproducible improvement

Accept ordinary conversation as the feedback channel. A case number and stage help, but are not a required form. Inspect the referenced artifact and identify the smallest concrete problem. Ask only for information that prevents a meaningful next step. Avoid turning a request about one confusing explanation into an unrelated redesign.

Record substantial requests in `docs/quality/learning-feedback.md`: a sanitized example, observed/wanted behavior, affected assets, fix and validation. Link the case/stage or synthetic fixture. Never copy real student names, private links, payment details or credentials into this public repository. Do not read the prohibited local `mea-beclick-kb/students/` or `pricing/` directories.

Fix the reusable mechanism: Hebrew voice and teaching sequence belong in generation instructions; content contracts in schemas/validation; brand, typography, motion, math layout and interaction in shared renderers; game behavior in its template. Correct a bad generated artifact only as an explicitly versioned replacement, alongside the systemic fix where applicable.

Preserve an example that demonstrates the failure and check the result against it. Prefer a small meaningful regression over assertions that merely duplicate the implementation. For visual or wording changes, inspect real rendered before/after content, including Hebrew/LaTeX and the affected narrow viewport or print layout.

## Customer invariants

- Assigned lessons, tutor edits, published versions, links and student progress belong to customers. A generator update does not authorize deleting or silently replacing them, or invalidating old library masters.
- Legacy lessons without new optional fields must still load. Require new fields at generation time, not by breaking historical reads.
- Presenter notes stay in tutor-only routes and never enter student/projector JSON. Notes-only edits must not reset learning progress.
- Independent graph construction must show its required target curve as the question stimulus while hiding candidate/solution curves, solution coordinates and answer-revealing initial controls until earned feedback. Other independent practice must not reveal its answer in the stimulus or caption. Worked demonstrations and freely adjustable graphs must describe their actual visible state.
- Review mode must remain authenticated, isolated from reusable library masters and free of score/progress writes. Check auth, preview behavior and escaping when changing routes or generated HTML/SVG.
- Keep the shared logo/palette in `src/lib/brand.ts`. Generated content does not choose its own branding or arbitrary executable HTML.

## Generate evidence proportionate to the change

For a new review batch, use `node scripts/generate-learning-review.mjs --out <new-temporary-directory> --model <verified-account-model>`. The script uses the real generation path with isolated storage, bounded concurrency, checkpoints and an explicit model/source fingerprint. It does not publish or import lessons. Do not silently change model or generator inside a batch. Shared quota/auth/model failures should stop new jobs; diagnose before retrying. Interrupted jobs may need a deliberate retry, not an endless loop.

Keep prior review artifacts intact. For affected-case regeneration, use a new output directory and `--case <id>`; compare the old and new result. Ten new calls are appropriate for a broad teaching-contract change, not every typo. Package a full corpus with `node scripts/package-learning-review.mjs --from <directory>` only when all ten validate. Use explicit `--replace <new-candidate-directory>` to substitute regenerated cases; packaging retains per-case model/source provenance and verifies every artifact. Keep the baseline directory for before/after comparison. The protected review index is `/app/learning-review`; inclusion there means **awaiting teaching feedback**, not pedagogical approval.

Run the affected unit/characterization checks; build and typecheck. For changes to lessons or review flows, run `npm run test:learning:browser` and/or `npm run test:review:browser` as relevant. Use CI's supported Node version for the full suite; inspect failures rather than dismissing them as platform differences. For risky math, grading, persistence or authorization changes, use an independent bounded review when requested/available. Keep the regression test focused on the actual failure.

Use the project's normal PR and deployment checks. Existing user authorization persists; this skill adds no new approval step. Preserve a rollback point and state what deployed. Production reliability requires the actual generation streak specified in `PRODUCT.md`; synthetic review examples do not count as production bookings or prove student learning quality.

Finish with the changed behavior, evidence, review links and remaining uncertainty. Invite feedback on the specific new examples without treating silence as approval to replace customer materials.
