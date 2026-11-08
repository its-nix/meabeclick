# Material-bound lesson reporting

Approved 2026-11-08; implementation branch `codex/presentation-report`. Not deployed.

Tutors select published material associated with the booking, or explicitly report manual topics without material. A sole eligible material is preselected. Every topic has its own covered/not-covered choice and optional private comment. The checklist confirmation also accepts zero covered topics. Whole-plan-skill understanding is optional and independent. Older plan-based reporting remains explicitly labelled unknown coverage; an explicit topic report cannot be silently downgraded to unknown coverage.

Migration040 adds immutable report source/topic revisions, independent homework assessments, a monotonic filing counter, and durable homework withholding. Corrections pin the original material version/hash unless the tutor explicitly selects a current eligible source, including a new version of the same material. Source preview links are tutor-only and render the exact pinned version; prior checklists remain visible in the report history.

Explicit reports withhold unreleased prepared homework and interactive practice. Expiry, generation failure and late booking generation cannot release excluded practice. Already released work is preserved. Written homework must name only covered local topic IDs and pass a separate bounded assessment of mathematics, private answer keys, taught scope and exclusions. Failed generation/assessment remains withheld. Broad library homework and games are bypassed in explicit mode; this implementation has no compatible topic-provenance library inventory to reuse safely. The latest effective report narrows future generation; broad whole-library preparation is bypassed for that context. Topic IDs are local to material, not cross-lesson mastery.

Private comments/source snapshots stay in tutor surfaces and fenced teaching context. Public experience JSON omits reporting metadata; family homework payloads omit private keys and provenance. Private context is explicitly excluded from generated student copy.

Synthetic verification covers validation, empty versus unknown, partial skill coverage, immutable snapshots/source preview, correction/reselection, stale windows and async completions, durable withholding through expiry/failure/late insertion, assessment gating and preservation of released work. Mac Chrome was checked at 1440, 390 and 320 pixels with no overflow or runtime errors. No real customer files, remote models, deployment, push or merge were used.
