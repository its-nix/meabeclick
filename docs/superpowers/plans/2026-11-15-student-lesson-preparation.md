# Student Lesson Preparation Implementation Plan

> **For agentic workers:** Use nixkit:executing-plans to implement this plan task by task. Preserve the existing Drive-native cutover and review gates.

**Goal:** Prepare a student-specific native lesson draft from a confirmed booking and known learning context, with linked Drive artifacts and tutor review before delivery.

**Architecture:** Extend the existing durable native job path. Reuse verified student/enrollment/report evidence and existing generation boundaries; publish native Slides/Docs through the current converter and append stable linked Sheets records. Missing context requires tutor input, not an invented topic or assumed mastery.

**Tech stack:** TypeScript, existing SQLite job leases, Codex generation boundary, Google Drive conversion and Sheets.

## Verified starting point

Main includes PRs 119–121. Booking jobs, personal Drive sync, native export, embedded notes, animations and linked draft records exist. Automatic authoring is disabled. The worker's source is getPilot, not fresh generation. generateVisualLesson explicitly rejects contexts outside three-unit normal distribution; its models and official-source checks must be expanded before claiming generic coverage. The legacy automatic path remains retired.

## 1. Assemble a truthful preparation brief

- [ ] Add a focused native-learning preparation-context module using the booking's enrollment identity, subject, level, duration and requested topic. Inspect teachingContextFor and targeting.ts for reusable evidence; avoid its first-subject-enrollment fallback when a booking supplies an enrollment ID.
- [ ] Include recorded taught topics, checked practice evidence and previously used official source IDs. Distinguish unknown readiness from demonstrated understanding. Minimize learner-identifying prompt data.
- [ ] Persist a versioned context on the existing job, preserving current lease, cancellation and ownership fences. Missing topic or ambiguous level enters needs-preparation with concrete tutor-facing missing fields.
- [ ] Test exact enrollment selection, missing context, cross-student exclusion, evidence interpretation, cancellation and retry stability.

## 2. Author fresh supported lesson drafts

- [ ] Replace getPilot as the production authoring source through an injected generator interface; retain pilot review routes as calibration fixtures.
- [ ] First support fresh lessons within the validated mathematical family, using verified sources and actual student context. Keep unsupported families explicit until their models, checking and renderer exist.
- [ ] Extend visual-generation.ts context/schema/prompt deliberately; changing only purpose:'review' or removing supportedNativeContext is insufficient. Never silently fall back to the pilot or revive retired lesson reuse.
- [ ] Seal model, rules, source, input and output provenance. Preserve brand, conversational Hebrew, speaker notes and question-only independent work. Use bounded repair and existing error classification.
- [ ] Verify context reaches the real prompt, invalid mathematical output cannot publish, and retries do not duplicate completed generation or overwrite tutor edits. Real generated examples need rendered review in addition to fixture tests.

## 3. Publish and link the complete review package

- [ ] Persist generated output before publishing so a Drive retry reuses the same validated content. Store immutable generation provenance separately from later native file edits.
- [ ] Use existing native export/publisher for teacher Slides, homework and protected activity links. Verify each game fits the generated topic; pilot-only activity links must not be reused for unrelated content.
- [ ] Append stable student, booking, materials and assignment IDs through register.ts. Keep existing tutor edits and customer assignments untouched. Verify links and native speaker notes after conversion.
- [ ] For agent-led feedback, edit current native review files where supported. Validate full regenerated replacements before archiving predecessors; retain one current candidate per reviewed lesson. Do not silently replace an assigned customer version.
- [ ] Test lost acknowledgements, restart, partial publishing failure, duplicate jobs, wrong owner/parent, and private-answer isolation.

## 4. Tutor review and controlled activation

- [ ] Show missing-context requests, preparation state and review links in the existing tutor workspace. Clearly distinguish source reuse from fresh generation.
- [ ] Keep student delivery blocked while draft preparation is validated. Approval and delivery require a separate, explicit tested transition; do not equate successful export with teaching approval.
- [ ] Exercise confirmed booking → brief → real generated draft → native artifacts → linked register → tutor review using isolated synthetic records. Do not create fake production bookings or count synthetic runs as the production reliability streak.
- [ ] Run affected unit, characterization and browser checks, build/type checks and normal PR gates. Activate only the supported draft path with a rollback switch after reviewing real generated output.

## Integration boundaries

Open PRs 104 and 106 target broad legacy generation/reporting changes and are not prerequisites for this first native draft increment. Review and port a needed behavior independently rather than merging those branches wholesale. Student assessment questionnaires, general cross-topic component reuse and automatic student release remain later increments.

## Implementation ledger

2026-11-15: added versioned preparation briefs to newly enqueued job snapshots.
Exact booking/enrollment ownership is enforced; plan observations are limited to
that enrollment and student. Coverage and status remain distinct, corrected events
are excluded, and readiness stays unknown. Missing topic/readiness are explicit.
Existing snapshots remain readable; enqueue replays preserve the first brief.
24 focused brief/job/worker tests passed; independent review found no blockers.
Generation, UI collection of missing fields, practice/source history enrichment and
activation remain unfinished. No production switch was enabled.
