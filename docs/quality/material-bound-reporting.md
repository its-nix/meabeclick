# Material-bound lesson reporting

Approved 2026-11-08; implementation branch `codex/presentation-report`. Not deployed.

Tutors select published material associated with the booking, or explicitly report manual topics without material. A sole eligible material is preselected. Every topic has its own covered/not-covered choice and optional private comment. The checklist confirmation also accepts zero covered topics. Whole-plan-skill understanding is optional and independent. Older plan-based reporting remains explicitly labelled unknown coverage; an explicit topic report cannot be silently downgraded to unknown coverage.

Migration040 adds immutable report source/topic revisions, independent homework assessments, a monotonic filing counter, and durable homework withholding. Corrections pin the original material version/hash unless the tutor explicitly selects a current eligible source, including a new version of the same material. Source preview links are tutor-only and render the exact pinned version; prior checklists remain visible in the report history.

Explicit reports withhold unreleased prepared homework and interactive practice. Expiry, generation failure and late booking generation cannot release excluded practice. Already released work is preserved. Written homework must name only covered local topic IDs and pass a separate bounded assessment of mathematics, private answer keys, taught scope, exclusions and student visibility. Student task text must expose neither private tutor comments/source metadata nor its own answer or worked solution. The explicit visibility result must be true; a missing or false result withholds release. Failed generation/assessment remains withheld. Broad library homework and games are bypassed in explicit mode; this implementation has no compatible topic-provenance library inventory to reuse safely. The latest effective report narrows future generation; broad whole-library preparation is bypassed for that context. Topic IDs are local to material, not cross-lesson mastery.

Private comments/source snapshots stay in tutor surfaces and fenced teaching context. Public experience JSON omits reporting metadata; family homework payloads omit private keys and provenance. Private context is explicitly excluded from generated student copy.

Synthetic verification covers validation, empty versus unknown, partial skill coverage, immutable snapshots/source preview, correction/reselection, stale windows and async completions, durable withholding through expiry/failure/late insertion, assessment gating and preservation of released work. Mac Chrome was checked at 1440, 390 and 320 pixels with no overflow or runtime errors. Synthetic UI/unit evidence used no real customer files or remote models. The parent integration record below distinguishes the later real-provider check and draft PR publication. No deployment or customer replacement.

Fresh review follow-up: delayed booking generation also rechecks the report revision and explicit scope after its async portal read; broad games and skill-evidence links cannot publish after zero/partial coverage or a correction. Previously delivered games remain. A late explicit report preserves interactive practice whose release deadline already elapsed, regardless of whether a family read previously materialized that release. These paths have focused RED→GREEN regressions;155 focused tests and build/check pass.

The whole-lesson independent critique also treats `request.priorCoverage` comments and source metadata as tutor-only context and fails any disclosure in student artifacts. This adds no model calls or changes to the four-call generation budget.


## Final integration — 2026-11-09

The topic manifest participates in the same per-artifact assessment and strict
repair catalog as the teaching content. A malformed scene/skill relationship
repairs only `learning.topics`; an individual semantic topic defect replaces its
single entry. Unrelated slides, homework, games and scenes are preserved. Local
validation enforces duplicate and known-skill membership independently of provider
schema support. Library preparation passes the assigned skill key, and imported
plans must pass the same membership check before they can replace a ready master.

Fresh independent review found the import bypass; it was reproduced RED and fixed
GREEN in both injectable preparation and the HTTP import preflight. The HTTP
regression preserves the existing master and lesson count after rejection. Narrow
re-review found no remaining actionable issues. The full suite also caught missing
storage-inventory declarations for the two new live tables; both are now declared.

Final source fingerprint:
`1c4277852068f9bbdfc78409d1185ffd15a351f0be7c7e050630adce66d71ca9`
(48 files). Linux Node22.20.0: **1,877/1,877 tests**, production build and warning
gate pass (22 existing warnings). The tested snapshot matches this worktree.
Historical root batch audit against0e8bbd7 passes on a copy; original seals remain
unchanged. Topic-report browser checks pass1440/390/320 pixels, eight synthetic
filings, no overflow/runtime errors; one deliberately stale submission returns409.
The separately assembled ten-case generation candidate passes128 scene viewports,
24 games and ten quality pages; its older generation sources are not evidence for
new topic-manifest or homework-provider behavior. The tracked pilot was restored
byte-for-byte after that outside-Git candidate check.

Migration040 is implemented but not deployed. Broad library/game reuse stays
withheld for explicit topic scope until compatible provenance exists. Human
teaching review and production rollout remain pending.


A real-provider synthetic smoke also completed through the actual scoped-homework
helper: one covered horizontal-translation topic and one excluded vertical-
translation topic linked to the same skill. It generated three distinct tasks;
a fresh assessor passed all five checks. Manual recomputation confirmed3 units
right, `y=(x-5)^2`, vertex(4,0) and value4 at x=6. Student text contains neither the
private sentinel nor source metadata. This small smoke used the helper's current
Codex CLI default model with medium effort (the helper does not pin a model), so
it is not a model comparison or broad teaching-quality claim. No booking, database
filing or release was performed. Source fingerprint matches the full-suite run.

Reviewable draft: [PR106](https://github.com/its-nix/meabeclick/pull/106), stacked
on [PR104](https://github.com/its-nix/meabeclick/pull/104). Source changes are committed
throughd2dab4c;65ce148 merges only the parent evidence documentation. Full local
Linux verification is recorded above; the existing GitHub workflow filters PRs
to main, so this stacked PR has no automatic CI run. No deployment occurred.
