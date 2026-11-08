# Shared artifact-generation quality

Lior resumed implementation after reviewing the recurring Todoist themes.
The learning-review corpus is evidence for the reusable generation machinery,
not a set of presentations to patch in isolation. The teal/parchment design
ticket is stale; retain the current shared brand.

## Required behavior

- Produce coherent explanations, teacher notes, homework and games from the
  lesson's skill, level and request. Explanations show concrete examples and
  intermediate steps; teacher notes stay private.
- Support concept-appropriate numeric visual representations in the shared
  scene renderer. Fractions, part/whole reasoning, right triangles and a
  function with its tangent must not depend on formula-only slides or a
  hand-edited review case. Generated content never supplies executable code.
- Check fresh generated material before publication, preserving precise
  artifact/scene failures and feeding them to one bounded repair attempt.
  Existing structural checks remain. A separate model critique checks math,
  teaching alignment and answer-key consistency; it is evidence, not a proof
  of pedagogical correctness. Shared engine failures stop retries.
- New question-based games have at least ten questions, with difficulty
  metadata and adaptation within the assigned skill. Record difficulty played.
  Speed drill retains its timer and a bank of at least ten questions. Board
  activities retain natural item counts. Practice does not automatically
  change the learning plan.
- Keep historical lessons, assigned games, tutor edits and publications
  readable. New generation requirements must not invalidate existing data.

## Validation and release

Use failing regressions for shared mechanisms, browser checks for new visual
types and game selection, and the Linux/Node 22 test/build/warning gates.
Generate a fresh representative synthetic batch using the real pipeline,
pinning model and source provenance; preserve the previous corpus. Compare
across topics and record unresolved teaching review. No customer material
replacement, library import, merge or deployment is part of local validation.

## Implementation choices delegated to the builder

Use bounded numeric SVG renderers rather than arbitrary generated SVG/HTML.
Use three ordinal practice difficulty levels, current-session evidence and
unseen-question fallback. Reuse the installed lesson engine for critique.
Preserve actionable quality reports privately; student copy contains no
model diagnostics. Additional editor/report workflows are subsequent tasks
using these shared contracts, not prerequisites for this generation change.
