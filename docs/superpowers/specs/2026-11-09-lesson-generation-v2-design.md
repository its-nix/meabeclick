# Lesson generation v2 — teaching quality and coherent practice

Status: builder-reviewed design for owner review; implementation and promotion have not started.

Independent builder check, 2026-11-09: no important unanswered questions reported.

This design adapts the teaching ideas in Nikol's MeaBeClick Bagrut Presentations guide. It preserves the website's visual identity and the existing interactive learning system. It does not adopt the guide's separate palette, PowerPoint destination, fixed one-hour duration or three-unit assumptions.

## Problem statement

Students need explanations they can understand, manipulate and apply. Tutors need a complete, relevant lesson they can teach with little preparation. The presentation, games and homework must develop the same understanding, with support that gradually decreases.

The current generator has useful foundations: typeset maths, controlled diagrams, animation controls, hints, private teaching notes, game templates, printing and protected student progress. Its primary presentation nevertheless represents an 8–15-minute module rather than an entire booked lesson. Other generated slides are bypassed when that module exists. Most non-function topics fall back to worked equations because the teaching renderer supports only five representations. Library reuse can also serve an unchanged master without incorporating the current student's question or learning history.

Stronger instructions alone will not close those gaps. The production generation contract, supported representations and assembly/reuse rules must implement the same teaching rules as the skills.

## Decisions confirmed by Lior

1. Generate a complete bundle for the booked duration: teaching plan, short interactive presentation sections, purposeful games and follow-up homework.
2. Include a verified official question when suitable for the objective and level. Use clearly labelled original practice when suitable official enrichment is unavailable.
3. Keep the experience calm and clear, adapting playful illustrations, contexts and rewards to the learner's age and readiness.
4. Plan against the student's request and available history/readiness. Reuse suitable library activities and generate missing material; a ready master must not bypass personalisation.
5. Prefer meaningful automatically checkable homework. Open written reasoning is explicitly identified as requiring tutor assessment rather than presented as certainly graded by AI.
6. Make interactive mathematical explanations the default. Add short videos selectively; rendering a video must not delay lesson readiness.

Website logo, palette and Heebo typography remain canonical. Generality means mathematics across supported grades and unit tracks, not expansion into other subjects.

## Solution

Create one shared teaching plan, then produce coordinated presentation, game and homework activities from it. Keep specialised authoring guides for those three experiences, with shared rules for teaching, mathematical conventions, sources and quality. The same versioned rules must inform the production generator and the project skills.

The normal path remains automatic. Existing student, booking, curriculum and practice information should supply context without an extra form or preparation step for the tutor. Unknown information stays unknown. A short diagnostic can test uncertain prerequisites; the system must not invent a history or diagnose weakness from absence of evidence.

### Teaching flow

The plan names a small set of achievable objectives and defines what a successful independent response would demonstrate. Its normal sequence is retrieval/diagnosis, concrete explanation, guided example, supported attempt, application or official question, targeted game practice and an independent exit check. Relevant older material can appear as deliberate spaced review.

Timings include reading, student thinking, discussion and transitions. The planned core blocks total the booked duration, currently 45, 90 or 135 minutes. A longer lesson does not simply gain more text. It can include deeper practice or another coherent section. Optional remediation and stretch activities sit outside the nominal core budget and explain what they replace when used. The tutor and learner control pacing; the schedule is guidance rather than a countdown.

Each screen has one teaching purpose. Show what a mathematical idea means, why the operation makes sense, and then how to perform it. Student wording stays short and concrete. Extended explanation, likely misconceptions, timing and transitions belong in private presenter notes.

### Example of coordinated learning

A lesson about adding unlike fractions could let a student repartition fraction bars, explain why the pieces need equal sizes, complete a guided sum, repair a denominator error in a game, and solve a fresh sum in homework. The linked activities share the same mathematical idea and terminology; independent tasks use new instances rather than copying the worked answer.

An older learner can receive the same useful model with a mature context and understated feedback. Visual playfulness must not imply low mathematical readiness or follow age stereotypes.

## User stories

1. As a tutor, I want a complete plan for the booked duration so I can teach without assembling several unrelated outputs.
2. As a tutor, I want the current student question and relevant learning history reflected in the plan so it addresses the real need.
3. As a tutor, I want uncertain prerequisites identified honestly so I can diagnose them quickly.
4. As a learner, I want short explanations with meaningful visual changes so I can follow one idea at a time.
5. As a learner, I want to manipulate mathematical objects so I can test predictions and see consequences.
6. As a learner, I want contexts and presentation appropriate to my age and readiness so the material feels relevant and respectful.
7. As a learner, I want graduated help and another chance after a mistake so practice remains useful.
8. As a learner, I want a fresh independent check so I can discover whether I understand beyond the worked example.
9. As a tutor, I want notes that explain what to say, ask, listen for and do next so I can teach naturally.
10. As a tutor, I want notes and answer keys kept separate from projection and student materials so I control the reveal.
11. As an exam learner, I want suitable authentic questions with their original diagrams and source details so I practise reading real exam material.
12. As a learner, I want adapted and original practice labelled accurately so I can distinguish it from an unchanged official question.
13. As a tutor, I want questions solved and checked before use so mistakes in a generated solution do not become teaching material unnoticed.
14. As a learner, I want games that exercise a specific decision or skill so playing develops understanding.
15. As a learner, I want homework connected to what was taught so I can consolidate rather than encounter unexplained material.
16. As a learner, I want reliable feedback on checkable tasks and an honest assessment status for written reasoning so uncertainty is visible.
17. As a parent, I want supported practice distinguished from independent evidence so progress is represented truthfully.
18. As a mobile learner, I want usable controls, legible diagrams and a printable alternative so I can work on available devices.
19. As a tutor, I want suitable existing activities reused so quality improvements do not require unnecessary regeneration.
20. As the owner, I want versioned examples and repeatable review so feedback improves the mechanism without rewriting customer work.

## Implementation decisions

### Shared teaching context and plan

Introduce a lesson-level contract above the existing learning experiences. It carries objectives, prerequisite assumptions/unknowns, a core agenda, activity references, optional branches, closing assessment and homework intent. Activities connect through stable objective, problem and misconception identifiers.

Teaching context separates grade, unit track, curriculum/programme, target questionnaire, readiness evidence, language and notation. Grade is not a substitute for unit track. Prefer explicit stored data; retain uncertain or conflicting inputs for a diagnostic or tutor clarification. Select only relevant evidence from recent reports and practice. An attempt made with hints does not establish independent mastery.

Create a bounded context snapshot for generation and later explanation. Keep customer context private. Do not put real student details into skills, public fixtures, external source-search queries or shared library masters.

The exact internal types, database layout, generation-call decomposition and module boundaries are builder decisions. They must preserve these observable behaviours and the existing bounded retry/quota handling.

### Production rules and skills

Maintain one project teaching contract with specialised presentation, game and homework guides plus shared mathematical/source guidance. Extend the existing learning-iteration workflow for future feedback. Scope these rules to MeaBeclick; do not modify unrelated global presentation or media skills.

Production must consume the versioned teaching rules rather than depend on a developer's personal skill installation. An update records the rule/schema version in generation provenance. A private presenter-note change remains distinct from student-content changes.

### Presentation and presenter notes

Preserve Hebrew RTL, warm direct language, short student prompts, deterministic formula rendering and controlled animation. Reveal reasoning in stages. Keep required question stimuli visible during independent work while withholding the candidate solution and answer-revealing controls.

Extend private notes with pacing, a natural explanation/opening, a question, expected understanding, likely misconception, concrete help, transition and source references where relevant. Notes refer to the actual numbers and diagram. They should help the teacher speak rather than repeat the slide verbatim. New generation can require the richer notes while historical content remains readable.

The presentation includes a readable lesson map and navigation between coherent sections. Printed output uses faithful static diagrams and explicit writing space. Video is an optional accompaniment to a mathematical explanation, with a static alternative; it is not a prerequisite for a usable lesson.

### Mathematical conventions

Shared invariants are correct arithmetic/algebra, explicit applicable domains, justified transformations, context-appropriate root selection, relevant units, exact quantities until approximation is needed, requested rounding and agreement between diagram, formula and answer. A final answer must address the question in context.

Apply notation consistently across linked text, equations, controls, notes, games and homework. Preserve terminology appropriate to the curriculum. Make the roles of radius/diameter, perpendicular/slant height, band/cumulative probability and mathematical/feasible solutions explicit where relevant.

Course-specific conventions belong to a profile. For example, Nikol's use of `s` and half-standard-deviation positions with approximate school-diagram percentages must not silently become the universal normal-distribution model. A different course can use another convention. Renderers and checkers must implement the selected profile; changing only explanatory prose is insufficient.

Retain existing graph notation by default. When an original source uses different notation, preserve the source and supply an explicit mapping or a supported display profile. Do not introduce a label the diagram or controls contradict. Hebrew wording for fractional units must describe fractions accurately, rather than sound like integer counts.

### Mathematical visuals and engagement

Extend the controlled visual registry while retaining existing function graphs, number lines, balances and worked steps. The proposed first release adds three families:

- Fraction, ratio and percentage models: bars/areas, repartitioning and part-to-whole relationships.
- Geometry templates: labelled plane figures and projections of common solids, including the distinctions needed for area, volume and height reasoning. Interactivity is limited to cases whose constraints and derived values can be recomputed reliably.
- Data and distribution models: visible data/counts and a curriculum-aware normal-distribution diagram.

These are bounded mathematical models, not a general geometry construction engine. Unsupported representations use suitable verified source diagrams or honest worked steps. Diagrams identify when they are not to scale. The initial implementation must demonstrate each new family across representative tasks; the builder chooses its internal decomposition.

Use controlled mathematical data as the source for drawings, labels, manipulation, feedback and print/video frames. Illustrative imagery can support a story or context; it must not supply the authoritative geometry, plotted data or answer. Model-authored executable HTML is not a rendering extension mechanism.

Motion should expose a change or relationship. Preserve pause, seek, speed, frame stepping, reduced-motion behaviour and learner control. Avoid decorative movement that competes with reading. Adapt contexts and rewards to the learner without creating a separate brand palette.

### Official questions and source fidelity

Resolve sources before asking the content generator to author a lesson around them. A verified question record includes authority, source URL, document/version hash, year/session, questionnaire/programme, question/subparts, page, original text and diagrams, readable crop bounds/assets, accessibility text and verification status. Use the available official curriculum/assessment metadata to judge fit rather than a matching keyword alone.

Cache verified records for reuse. A fresh public-web search must not be required for every booking. Bound retrieval, verify allowed sources/assets, and preserve provenance through derived activities. Use sources in accordance with their publishing conditions; when reproduction is unsuitable, retain a source link and use separately labelled local practice. Do not bypass access restrictions.

Distinguish unchanged official questions, adaptations and newly authored practice. Keep the official original immutable; annotations and staged solutions are separate. Crops preserve all information needed for the chosen subparts, including diagrams and shared givens. A citation or a plausible questionnaire number alone does not establish verification.

The teaching routine is read/mark givens, choose a method, attempt, reveal a staged solution and verify units/domain/context. Check numerical results independently where a reliable method is available; preserve verification evidence. Do not equate an unsupported model self-check with proof of correctness.

Optional official enrichment falls back to clearly labelled original practice when retrieval, fit or verification fails. If the student's explicit request is to solve a particular question and that question cannot be read or resolved reliably, flag that requirement for clarification; do not claim it was covered by substituting a different problem. No guessing at an unreadable sign, exponent or diagram label.

Track question use in private lesson history. Avoid accidental repetition; permit deliberate retrieval, correction or revision with an explicit purpose. Older lessons without source identifiers provide incomplete history, not proof that a question has never been used.

### Games and homework

Each activity names the learning outcome, the mathematical decision it exercises and the misconception its feedback addresses. Choose a game because its interaction fits that purpose. Vary cognitive moves: predict, construct, compare, sequence, diagnose, repair or justify. Rewards follow useful learning actions. Speed pressure is reserved for an explicit fluency goal; existing elapsed-time evidence must not become a universal success criterion.

Use linked problem data and verified variants across presentation, games and homework. An independent transfer question uses a fresh instance rather than revealing the worked example's answer. Do not alter an official question and continue labelling it unchanged official material.

Homework primarily consists of tasks with reliable checkers. Numerical answers, equivalent fractions, supported graph construction and structured reasoning choices are appropriate. Add other checker classes only when they have defensible validation. Open reasoning and proofs have explicit tutor-assessment status; optional AI assistance is not presented as certain grading.

Proposed support default: allow an attempt, then progressively useful hints, then a guided step. A learner can explicitly request a worked solution after an attempt. Record that as supported practice. Follow it with a fresh check if independent evidence is needed. Designated independent checks withhold the solution until submission and never count an answer reveal as independent success. Provide a clear way out of repeated failure rather than an endless retry loop.

Homework normally fits a short, realistic practice session; proposed default is approximately 10–15 minutes, adjusted to the objective and learner. Include relevant spaced review where evidence supports it. A long list of repetitive tasks is not a quality metric.

Respect the existing post-lesson lifecycle: homework follows what was taught, reports can refine or replace held practice, and publication/release remains explicit and idempotent. Preserve the existing no-report fallback policy unless separately changed. Completion, submission, supported success and assessed mastery remain different states.

### Reuse, compatibility and automatic operation

Assemble each new bundle against its teaching context. Reuse a compatible activity or exact-fit bundle when its objective, request, curriculum, source/question needs and content version match. Generate missing or unsuitable activities. The existence of a ready skill master alone is not sufficient to bypass that decision.

Do not invalidate or purge old masters merely because a new generator exists. Version eligibility for new assembly separately from the assigned materials customers already use. Existing lessons, tutor edits, published URLs and progress remain intact. New generation may require new fields; historical reads remain compatible. Replacements use append-only publications and existing optimistic-lock protections. Notes-only edits do not reset student progress.

The normal production path requires no new tutor approval or configuration step per lesson. Required validation failures are held and explained through existing operations surfaces; optional enrichment failures use the agreed fallback. Preserve bounded retries, shared auth/quota failure stops and isolated review mode. Do not introduce new messaging channels or a large administration UI.

## Testing decisions and quality bar

Test primarily through one complete bundle-generation/assembly seam: supply teaching context, selected history, source fixtures and a deterministic agent response; inspect the resulting bundle, publication decisions and learner/tutor views. Prefer existing lifecycle, rendering and review seams to a new test framework. Test externally visible outcomes rather than prompt-string counts or the implementation's call layout.

Targeted mathematical tests are appropriate for supported visual/checker families: equivalent answers, domains, geometry constraints, probability/profile distinctions, unit/rounding rules and frame/label consistency. Test any new family in meaningful edge cases, not merely against its own generated text.

Source fixtures cover valid original questions, adaptations, unsuitable level/programme, incomplete crops, corrupted/changed documents, inaccessible sources, optional fallback, mandatory unresolved requests and deliberate versus accidental repetition. Use public-safe synthetic fixtures; real student uploads and private materials stay out of Git.

Browser evidence covers live animation/controls, wrong-answer feedback and help, independent checks, every new visual family, RTL/math layout, narrow screens, reduced motion, printing, private notes/answers and zero customer writes in review mode. Preserve tests for offline/idempotent evidence, cross-booking isolation, report replacement and notes-only edits.

Evaluate a candidate generator version with ten representative synthetic bundles using the existing numbered review process. Preserve the current baseline and per-case source/model provenance. Include younger-school fraction/percentage work, three-unit contextual/statistics work, and higher-demand function/geometry reasoning among the cases. Include at least one verified official source and a tested unavailable-source fallback.

The teaching rubric asks whether a tutor can teach from the material with little preparation, whether a learner can explain the idea and attempt a fresh instance, whether help addresses plausible mistakes, whether source/level/notation match, and whether visuals make reasoning clearer. Review representative baseline/candidate pairs without favouring the version label. Known mathematical errors, false official-source claims, answer leakage, broken tasks and brand drift block promotion. Automated test success alone is not evidence of teaching quality.

The proposed release gate is owner review of the new generator version and examples, followed by normal regression/CI/deployment checks. Lior owns this decision; Nikol's teaching feedback informs it and is not a separate approval dependency. After promotion, routine lessons use the automatic path. This gate does not add an approval step to every lesson.

Synthetic review runs do not count as the production reliability streak in the product requirements. Preserve that distinction, existing reliability reporting, a rollback commit and a reversible generator-version eligibility switch. Stop rollout on concrete content/data regressions, while leaving assigned customer work usable.

## Out of scope

- Rebranding the website or copying the source guide's palette and font defaults.
- Making PowerPoint the main runtime or requiring video renders before lessons are usable.
- Other subjects, a new LMS, a general geometry engine or an arbitrary-code generation sandbox.
- Automatic proof of arbitrary mathematical reasoning or certain AI grading of unsupported written work.
- Rewriting assigned lessons, erasing progress, purging the old library or releasing review candidates as customer masters.
- New private-photo upload/intake UI, social leaderboards, reward economies, mandatory manual student profiles or new notification channels.

## Further notes and review points

The six numbered product decisions are confirmed. Support/reveal behaviour, the 10–15-minute homework default, the initial three visual families and the version-level release rubric are proposed builder defaults for owner review of this complete design.

Current product direction prioritises tutor preparation time and truthful progress evidence. Existing operational authority and customer safeguards continue to apply. Unrelated work in the main checkout is outside this design.

Implementation facts and constraints come from the existing generation, library, learning lifecycle and review code, plus the [interactive learning contract](../../quality/interactive-learning.md) and [iteration skill](../../../skills/meabeclick-learning-iteration/SKILL.md). The separate guide supplied by Nikol informed the pedagogy; it is not being installed as an alternative production engine.

The public [RAMA assessment-tool catalogue](https://rama.gov.il/tools) supports subject/grade selection and is a possible official source beyond bagrut. Ministry exam-paper discovery was confirmed, but some portal/PDF requests were blocked in the research environment. The implementation must verify actual retrieval and fit, not infer availability from a search result or hardcode a single portal endpoint.
