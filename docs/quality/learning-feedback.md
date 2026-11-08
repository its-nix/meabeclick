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

## Tutor game access — local candidate, 2026-11-07

Todoist `6hwqV7hXX2cqqfxH`; synthetic fixture: `tests/unit/tutor-game-preview.test.mjs`.
Games opened from the tutor's lesson feed previously carried student score
credentials and returned to the student board. Legacy stored links also kept
their retired game paths. The tutor feed and catalog now issue authenticated,
private previews without student identity, best scores, skill progress or result
signatures. Published assignment previews read their immutable snapshot; the
editor's draft preview remains separate. Return links retain the selected
student workspace or lesson picker; missing games recover within tutor pages.
Student-signed links, stored material and results are preserved.

Focused route tests reproduce the legacy/current link failure and check tutor
auth, rejected score writes, published/draft isolation and catalog context.
`tests/browser/tutor-game-preview.mjs` checks completed gameplay and queued-result
isolation on a synthetic mobile page. Combined verification passed: Linux/Node
22 build and warning gate, all 1,753 tests, and the mobile gameplay browser
regression. No customer material was replaced or deployed.
