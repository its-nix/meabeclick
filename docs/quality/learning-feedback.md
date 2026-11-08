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

Synthetic regressions and browser checks cover privacy, numeric precision, matching diagrams and formulas, adaptive evidence, timed completion and preview isolation. The [execution record](../superpowers/reports/2026-11-08-generation-machinery.md) records accepted and rejected real-model cases; the later targeted-repair continuation below records the complete candidate validation. Model critique is evidence for tutor review, not teaching approval; no customer assignments or existing pilot artifacts are replaced by this iteration.

### Findings from real generated candidates

Independent review rejected some candidates that passed automated critique. A valid but inefficient equation step must not be labelled mathematically false. Error Hunt must identify the first genuinely invalid transition, including the distinction between function height and tangent slope. Both production and critique now receive these requirements from the shared contract.

An ordinary quadratic exploration exposes only `h` and `k`; asking the student to manipulate `a` was impossible. Shared control metadata now drives both rendered inputs and model instructions, including each control's range and restrictions. Teaching sequences begin with a concrete example before naming the rule, and challenges remain within the assigned skills. A bounded repair preserves passing artifacts unless a minimal dependency correction is necessary. Earned student feedback belongs in `check.success`; the renderer does not automatically reveal authored worked frames after success.

Graph Match previously scaled each option independently, making proportional lines look identical. All curves now share coordinates and numeric axis ticks. Fresh generation rejects a target copied from the already visible reference and choices that collapse to the same plotted curve. Prompts state the renderer's centered, unit-spaced sampling grid. Existing stored games remain readable.

Fifteen-question banks exposed a rotation bug that could drop options after the thirteenth round. Rotation now uses the bank-independent option offset, with permutation/key/metadata regressions through forty questions. Explanations identify the mathematical claim rather than its shuffled option position. Fixed Error Hunt step references remain valid.

A real critique exceeded its former two-minute deadline. Critique now honors a lower configured budget up to the existing five-minute ceiling, uses concise passing explanations and stops new batch scheduling on an engine timeout. Timeout regressions use a long-enough fixture budget to distinguish a hung critic from slow test-process startup. Engine faults still do not consume semantic repair attempts.

The execution record tracks accepted and rejected candidates, exact source/model configurations, checksums and outstanding teaching review. New model trials use separate sealed directories; changing the evaluation model does not change the production model configuration.

### Generation text contract correction — 2026-11-08 continuation

Reproduced a trust-boundary mismatch: the generated learning schema accepted empty,
blank or overlong question-stimulus text, while the renderer rejected it. Frame and
question-stimulus formula/caption limits now share the renderer's existing 600/180
character bounds and require non-whitespace content. Historical runtime acceptance
is unchanged. The application enforces these constraints even when an engine returns
unconstrained JSON; provider schema enforcement is not the only check.

Nullable-union failures now retain the unique matching type branch's precise field
path and actual/allowed length. This prevents a bad caption from being reported only
as an invalid question stimulus. Tests reproduce both failures red→green and cover
exact bounds, Unicode whitespace, valid alternatives and invalid unions. Full Linux
Node 22 verification passes 1,807 tests, build and the 22-warning baseline.

At this text-contract checkpoint, no new model trial had been performed and the
four rejected cases remained rejected. The continuation below supersedes the
pending repair-design status; the strict gate remains in force.


### Targeted repair and complete review candidate — 2026-11-09

Lior approved repairing located artifacts within the existing single repair round.
Trusted schema-bound replacement units now preserve passing slides, examples,
homework, scenes, game questions and metadata. Unknown/global failures use the one
full-bundle fallback. Every repaired candidate receives full structural validation
and independent critique; newly exposed defects reject it without another retry.
Malformed replacements cannot address arbitrary paths or modify unrelated data.

The new sealed four-case trial produced READY linear graphs, quadratic
transformations, combined graphs and derivatives. Independent content reviewers
recomputed all answers and accepted all four exact candidates. Targeted repairs
changed one linear slide; the quadratic matching game and summary scene; and the
combined lesson objective plus four slides. Derivatives passed the first attempt.
Together with six previously accepted cases, explicit packaging produced a ten-case
candidate outside Git. Browser checks covered128 scene viewports,24 games and ten
assessment pages without runtime/math errors or score writes. This mixed-source
candidate preserves per-case provenance and is awaiting human teaching review;
it is not a controlled quality benchmark or a production reliability streak.

Source0e8bbd7 passed1,826 Linux Node22 tests, build and warning gate (22 existing
warnings), independent code review and GitHub CI. Existing pilot/customer material
is preserved; no generated answer key was hand-edited, imported or deployed.
