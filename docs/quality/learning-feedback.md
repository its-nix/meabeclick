# Learning feedback history

Give feedback in conversation; no new UI or form is needed. A useful message is: “Example 04, stage 2: the jump from 15% to 0.15 is confusing; show why we divide by 100.” Case/stage details help but are optional.

The reusable workflow is [meabeclick-learning-iteration](../../skills/meabeclick-learning-iteration/SKILL.md). Keep entries sanitized: this repository is public.

## Pilot 1 — awaiting teaching review

Ten synthetic briefs cover fractions, negative numbers, equations, percentages, Pythagoras, linear graphs, quadratic transformations, linear/quadratic representations, factorisation and derivatives. Exact generation provenance is included with the review corpus. The review index is `/app/learning-review` (tutor login).

Each bundle includes the interactive presentation, private presenter notes, homework and playable games. This is a teaching review, not approval to replace assigned lessons or make the examples reusable library masters. The synthetic run is separate from PRODUCT.md's production generation streak.

## Already addressed in the baseline

- Branding drift: original logo and shared blue/slate palette now come from the shared brand module.
- Cumbersome explanations: generation instructions ask for concrete, friendly Hebrew, a focused sequence and visible intermediate steps.
- Missing teaching support: every newly generated stage requires private notes with explanation, question, expected answer and help if stuck.

These changes need owner feedback on real generated examples; passing automated checks alone does not establish that students find the teaching clear.

## Pilot hardening — candidate generated, teaching review pending

The real synthetic run exposed strict TeX failures and games shorter than their template contracts. New generation instructions keep Hebrew/currency outside mathematical TeX and derive item-count ranges from the registry. Fresh game output now passes the same validator as authored games, with the existing single retry for bad output. Historical lesson reads are unchanged. Failed/short candidates are regenerated separately; the assembled review retains each case's generation configuration and checksum.

Runner regressions cover resume without repeated generation, checksum verification, exclusive batch ownership, shared-engine failure stop and targeted case generation. Every case remains pending human teaching feedback. These are synthetic local-account calls, not the production-generation reliability streak.

## Review observation to discuss — example 01, stage 4 notes

The independent reviewer found correct arithmetic throughout the refined fractions bundle. The oral phrase for \(3/12\) and \(4/12\) should use fractional units (“שלוש שתים־עשריות”, “ארבע שתים־עשריות”), rather than sounding like integer counts. This is recorded for the teaching-language iteration; the numbered pilot remains an authentic generated candidate awaiting owner feedback.

## Shared machinery iteration — 2026-11-08

Lior clarified that the review examples are evidence for improving reusable artifact generation across topics and artifact types. The old teal/parchment specification is stale; the shared blue/slate brand remains authoritative. The recurring requirements are concrete explanations and intermediate steps, appropriate mathematical visuals, private teacher guidance, context alignment, consistent answer keys, useful independent practice and precise repair feedback.

The implementation adds bounded fraction bars, right triangles and quadratic-function tangents to the common web/print/video scene renderer. Numeric question stimuli are separated from worked explanations, including the raw student payload and compiled formula templates. Supplied decimal values remain legible; derived tangent slopes avoid decimal cancellation noise. Guidance now describes the controls actually provided by the renderer. The generator and critic also distinguish the intentionally public legacy slide-note field from private presenter guidance. A real fractions candidate exposed a request for unsupported sliders, which prompted that shared instruction and critique correction rather than a hand edit of the candidate.

Fresh generation checks every artifact's structure and obtains a separate structured critique of its mathematics, answer key, context and teaching. One repair receives the exact rejected candidate and failures. Malformed critiques and engine faults fail closed. Private append-only reports assess a hashed generation snapshot; later tutor edits do not inherit a pass. Historical material reads remain compatible. Review packaging verifies both candidate and assessment checksums and refuses source drift.

New question banks carry stable identifiers and three difficulty levels within the assigned skills. Finite sessions use ten unseen questions; timed speed drill keeps its timer. Hint use and results influence only current-session selection, and signed results retain per-question difficulty evidence. Initial adaptive options use deterministic ordering to prevent server/client hydration from attaching the wrong answer handler. Historical banks retain their existing playback behavior.

Synthetic regressions and browser checks cover privacy, numeric precision, matching diagrams and formulas, adaptive evidence, timed completion and preview isolation. The representative real-model batch is recorded separately below when complete. Model critique is evidence for tutor review, not teaching approval; no customer assignments or existing pilot artifacts are replaced by this iteration.
