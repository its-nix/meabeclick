# Visual math lesson calibration

Status: product decisions agreed in conversation; concrete design awaiting final readback. This supersedes the visual-quality assumptions of the first v2 candidate gallery, not its customer-data and access safeguards.

## Intent and agreed scope

Create one complete, reference-quality generated lesson that demonstrates the improved authoring mechanism. Lior rejected the first v2 gallery because its repeated card layout, sparse scenes and formula-heavy explanations did not reach the quality of Nikol's presentation workflow. More valid JSON or additional slide numbers alone would not address that feedback.

The agreed pilot is a90-minute introduction to normal distribution for the three-unit Bagrut35372 target. Its synthetic learner understands percentages and averages but is new to normal distribution. Its worked assessment anchor is summer2025 questionnaire35372, question3, matching the reference for a useful comparison of the two authoring workflows. Independent checks, homework and games use fresh problems.

Deliver a teacher-led HTML presentation of roughly20–30 meaningful slides, a private presenter guide,10–15 minutes of homework and two short concept games. Keep the original website logo, blue/slate/white identity and Heebo. The format and teaching profiles must remain usable beyond this topic and level. Review this complete lesson before another ten-example batch or production promotion.

The later proposal for student/tutor readiness questions and agent-selected activity reuse is explicitly deferred in [the feedback record](../../quality/learning-feedback.md). It adds no questionnaire, reuse decision engine or library expansion to this pilot.

## What the references establish

Three supplied decks contain54 slides/pages. Their useful practices are distinct slide roles, a visible timed agenda, clear hierarchy, original question reading, staged reasoning, misconception checks and exit questions. The stronger continuation presentation has substantive notes on every slide. Some question crops and labels need better legibility in the new output. Private reference files and render evidence remain outside tracked source.

The expanded skill declares presentation authoring as required, PDF inspection/cropping as conditional, and image generation as optional. The production service needs an HTML counterpart to that workflow; it must not depend on a private ChatGPT session or an assumed hidden skill. See [the research and comparison](../../research/2026-11-10-visual-math-learning-workflows.md).

## Student and teacher experience

The presentation uses a large16:9 slide canvas with quiet navigation, keyboard stepping and teacher-controlled reveals. It supports a readable opening state, pause, replay and going backward. A slide can show a full-width model, a comparison, a question/detail view, an annotated diagram or staged mathematical working. Every composition has one clear teaching purpose. Avoid the same large empty card on every slide.

Student-facing Hebrew is short, concrete and friendly. Show an example or visual relationship before introducing its name or rule. Put longer spoken explanations in the private guide. The diagram, text, equation and feedback describe the same state after every interaction. Motion must expose a mathematical relationship that the learner can explain; backgrounds, logos and decoration do not count as teaching illustrations.

The teacher has a separate guide with time, a natural explanation, a pause question, expected understanding, likely misconception, help if stuck, transition and source where relevant. It links to the matching presentation slide without exposing notes in the audience window. Preserve notes editing and notes-only progress semantics.

On phones, homework and games reflow into readable activities with adequately sized controls. Original question images have a readable detail/zoom view and an accessible transcription. Do not shrink a complete exam page until its text is illegible. Reduced-motion mode shows the same complete mathematical states without requiring animation playback.

## Teaching sequence

Use26 slides as the initial authoring target, adjustable within20–30 when the rendered teaching sequence warrants it. Revealing another arithmetic line does not automatically require another slide. The agenda includes thinking, silent reading, writing and discussion, not just animation runtime.

| Minutes | Initial slide allocation | Teaching purpose |
| --- | --- | --- |
| 0–5 | 1–3 | Branded opening, objective and retrieval of percentages/average |
| 5–20 | 4–8 | Build distribution intuition; explain center, spread and symmetry |
| 20–32 | 9–12 | Connect half-standard-deviation bands to area; distinguish a band from cumulative probability |
| 32–42 | 13–15 | Guided original example and a short visual concept game |
| 42–64 | 16–20 | Read the authentic question, identify givens, attempt and reveal the reasoned solution |
| 64–80 | 21–23 | Fresh transfer, a second short concept game and independent evidence |
| 80–90 | 24–26 | Misconception comparison, exit check and homework handoff |

The authoring mechanism may adjust individual slide allocations while preserving the90-minute total and its objectives. Mixed review of unrelated topics is not needed for this synthetic introductory brief.

The model must visibly support at least these explanations:

- An illustrative population/distribution helps explain why the center is common and extremes are less common. Illustrative samples are labelled and do not supply a fabricated grading key.
- Changing spread with center held fixed changes the interpretation of distances. Linked labels and formulas follow the actual parameters.
- A band and the cumulative region up to the same boundary appear as distinct, comparable shaded regions.
- A cumulative percentage can identify a position relative to the mean before algebra recovers a missing parameter.
- The same mathematical relationship is applied to a fresh context after support is removed.

Situational illustrations may support school/test or water-use contexts. Exact graphs, axes, formulas and question images come from mathematical models or verified sources, not generative image approximations. Audio and pre-rendered video are optional; native interactive explanation is the primary medium.

## Mathematics and authentic source treatment

Use the school-diagram profile appropriate to this assessment: mean, s, half-standard-deviation positions and the printed approximate band percentages. Explain standard score where the question requires it. Do not mix these percentages with a different exact-normal-table convention. A point such as z=1.75 can determine a value without implying an unsupported school-band probability at that point.

The original [summer2025 paper](https://meyda.education.gov.il/sheeloney_bagrut/2025/6/HEB/35372.pdf), question3 on page8, has been downloaded and visually matched to the reference. Its SHA256 is `11823e215717c0e9f572aace6ca4bb6f9db19bd4ed8ca8995b2541413cab81f8`. Recomputed school-diagram answers are mean72, half-step axis labels52 through92 in increments of4,16 percent above80,200 students and a score of86 for standard score1.75. These are private teaching/checking data when used as an assessment, not hidden public HTML fields.

The original question and all needed diagrams remain intact in a trusted crop/detail view with a separate readable transcript. Source metadata identifies authority, year, session, questionnaire, page and question. Annotations and solutions are separate layers or views. Generated variations are labelled authored/adapted; they must not acquire an invented official attribution. Add the verified source through the existing trusted-catalogue process. The full paper and the private reference decks are not published as lesson assets.

The winter2025 question was separately located and checked, but need not be included in the core lesson. Select a fresh independent problem with all givens, a checked answer and a genuinely new reasoning attempt. Keep exact values until an explicit requested rounding step.

## Homework, games and evidence

Homework covers the introduced objectives in10–15 minutes, with standalone givens, typeset mathematics and a relevant diagram when it supports the question. Start with an attempt, offer graduated hints and provide a worked solution only after an attempt and explicit request. A subsequent fresh check supplies independent evidence. Open explanations remain explicitly tutor-reviewed.

Two short games use the same distribution model: one asks the learner to choose/build a shaded region that matches a statement, and one asks them to reconstruct or correct a missing position/label. Give each several brief rounds with increasing demand and useful feedback. Rewards mark completion and insight without replacing the mathematical goal. They must support touch and keyboard use and use fresh data, not leak the main worked-question answer.

Use existing trusted grading/progress boundaries where applicable. Review previews write no customer scores, submissions or progress. Any new answer type needs a deterministic server-side checker before it can be labelled automatically graded. Do not invent a mastery claim from an animation, a hinted success or a game completion alone.

## Authoring mechanism and bounded implementation choices

Builder calls, rather than extra owner requirements:

1. Extend the existing HTML/SVG learning infrastructure with a versioned slide-composition contract. A slide can contain multiple semantic blocks and staged model states. Reuse compatible grading, notes and source access seams. Legacy formats and customers retain their existing render path.
2. Keep generated mathematical content as validated data. Trusted renderer components produce HTML/SVG; the model does not receive unrestricted executable JavaScript, arbitrary external embeds or control of branding. The contract must actually express the proposed compositions and visual relationships rather than reducing them to caption/TeX/numeric tuples in one card.
3. Use the available presentation-authoring and HyperFrames slideshow guidance for storyboard, composition, reveals and rendered review. Prefer the current native math/motion stack for this pilot. JSXGraph, Manim or another player is a later technical choice only if a demonstrated capability gap warrants it; no extra paid service or second video stack is required.
4. Preserve the current generation engine/account. Production prompts and schemas must consume the revised authoring contract; installing a local skill alone is insufficient. Record actual model, rules, schema, source fingerprints and artifact hashes.
5. Generate the pilot through an isolated candidate runner using the reusable path. A manually edited showcase with no repeatable authoring mechanism does not meet the task. If a content or visual failure needs repair, fix its common cause and produce an explicitly versioned replacement with provenance.

The updated repository skill will require a storyboard with teaching purpose and intended visual per slide, subject-specific composition, authentic source treatment, private notes and a rendered whole-deck comparison. Keep detailed presentation, game, homework and mathematical guidance in the existing scoped references. Preserve the current compatibility, release-time, authorization and customer-data requirements.

## Verification and delivery

Inspect every rendered pilot slide in sequence, and manipulate each mathematical interaction. Compare representative explanation, question, solution and recap slides against the supplied references. Independently check source transcription, mathematical transitions, answers, labels and feedback. Technical test counts do not establish teaching quality.

Verify desktop presentation, narrow homework/game layouts, Hebrew/LaTeX, keyboard navigation, reduced motion, private notes/keys and print output. Student print includes givens and appropriate worked teaching content while withholding independent-task answers; tutor solutions remain private. Meaningful regressions cover newly supported compositions, model/label agreement and disclosure boundaries. Run affected checks, build/typecheck, supported-Node full tests and browser regressions before integration.

Deliver one authenticated review bundle containing presentation, private notes, homework and both games, plus concise comparison evidence and known teaching limitations. Keep original reference assets and prior candidate corpora. No customer publications, tutor edits, assignments, links or evidence are replaced. Production-v2 activation stays off until owner teaching review; this pilot does not establish the production reliability streak.

When the owner has reviewed the calibration and the reusable skill refinement is complete, return to the deferred readiness-clarification/reuse idea for discussion. Do not implement it inside this task.
