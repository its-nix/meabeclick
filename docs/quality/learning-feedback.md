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

### V2 candidate review: publication and evidence seams (2026-11-10)

The independent critic found computed answers in derived-family questions, captured-time homework replacement, missing automatic-game navigation, missing live report goal coverage, lost original presentation access after homework replacement, optional source links treated as mandatory, unsupported normal precision, and discarded known library grades. Reproducing unit and live API tests now cover these cases. The fixes preserve givens and private keys across screen/print/video, use a fresh release-time guard, restore immutable game links with tutor-only score-free previews, append explicit goal coverage, retain original presentation/editor/API access, distinguish source intent, bound precision and compare authoritative reuse context. Ten fresh synthetic bundles are generated separately; owner teaching approval and production-v2 activation remain pending.

### Real v2 corpus: mathematical and rendering corrections (2026-11-10)

The first sealed real batch exposed false amount/percentage equality in04, missing/independently scaled graph coordinates in06/07, and a normal cumulative frame whose shaded upper bound contradicted its explanation in08. Validation also held05's duplicate diagram labels,09's fractional agenda times and10's choice-index source check. These cases are regenerated in a separate candidate with per-case provenance;01–03 retain their validated original artifacts.

The independent reading also found that checked homework hid its shared task, removing temperature/price/distribution givens from the visible question and student print. The renderer now retains that stimulus. Additional HTTP/source/print regressions cover stale saved goal selections, optional enrichment language beside mandatory question links and contradictory guided/challenge metadata. Browser and decoded-video inspection caught chart axis fill, PDF page breaks and HyperFrames root sizing; visual inspection supplements numerical/layout tests.

The next independent pass found unmarked a/b target identities and unsupported square-area graphics in05, coefficient/width wording in07, parameters shared across separately released objectives in08, an off-centre diameter in09, and a privately defined polynomial/unspecified recurring-decimal precision in10. The mechanism now supplies checked labelling diagrams, exposes the supported a control, and strengthens standalone givens, visual-capability and exact-answer conventions. Five affected cases are regenerated under a third source checkpoint, preserving previous evidence.

The final pass caught bare TeX in graph labels and games whose shared distribution givens existed only in preview metadata. Graph labels now render formulas consistently; new generated games require a persistent stimulus rendered above the activity. A later08 run fixed its game but repeated a worked answer in its independent scene. Explicit game-only assembly keeps corrected08's lesson/homework and fresh31% check, importing only the later verified `twoTruths`. Separate provenance and context-mismatch regressions protect that selection. The independent critic cleared all ten selected examples and the assembly seam; owner teaching approval remains pending.

### Owner rejected v2 teaching presentation quality (2026-11-10)

Lior rejected the candidate gallery: it does not resemble the presentation quality produced with Nikol's ChatGPT skill. Requested improvements are more meaningful slides, engaging illustrations, dynamic visual explanations, delightful and insightful student experiences, and stronger alignment to genuine official Israeli assessments. Website branding, private notes and existing customer materials remain requirements. The next refinement is being grilled with the owner; v2 is not approved for production promotion.

Inspection found6–8 scenes per candidate and a12-scene validation cap. Percentages04 and integrals10 use only typeset-step scenes; the latter explains signed area without plotting or shading the region. Pythagoras05's area explanation shows arithmetic instead of a square-area model. The same large card/sidebar composition repeats across subjects. Only one candidate uses a verified official source. These are visual capability and teaching-design limitations; passing structural, mathematical and browser tests did not establish the desired presentation quality.

The supplied ZIP contains a skill and references, not a rendered benchmark deck. Its authoring instructions explicitly delegate deck creation to a platform presentation skill. Incorporating selected teaching rules into the fixed HTML renderer did not reproduce that separate authoring workflow. Research and owner decisions are recorded separately before changing the generation contract: [visual math workflow research](../research/2026-11-10-visual-math-learning-workflows.md).

The owner then accepted fuller teacher-controlled decks (roughly20–30 meaningful slides per90 minutes), authentic original assessment questions followed by annotations/reconstruction/solutions, and one complete calibration lesson before another ten-example batch. Three subsequently supplied reference decks total54 slides/pages; their layout, progression and source-question treatment were inspected. The expanded skill identifies the presentation-authoring dependency explicitly. The reference comparison and assessment-source checks are recorded in the research note; website branding, complete private notes and historical customer materials remain protected. The calibration brief is being settled through the requested grilling process.

The calibration brief is now agreed: a90-minute introduction to school-profile normal distribution for the three-unit35372 target, assuming percentages and averages are understood but normal distribution is new. The worked exam anchor is summer2025 questionnaire35372 question3, matching the reference for a fair workflow comparison. Independent practice, homework and games use fresh problems.

## Deferred owner idea — readiness clarification and activity reuse

Revisit after the visual calibration lesson and generation-skill refinement are completed and reviewed. The owner observed that the design interview itself improves alignment: ask the student or tutor a few targeted questions about understanding before choosing the teaching sequence. Track the resulting context and material versions so the agent can reuse suitable parts of previous presentations and generate only missing or unsuitable material, controlling duplication without sacrificing fit. This would build on the existing context/reuse safeguards. Student/tutor clarification flows, broader component-library selection and automated reuse decisions are outside the current visual-calibration task. Returning to this note is a discussion checkpoint, not permission to silently enable a new customer workflow.
