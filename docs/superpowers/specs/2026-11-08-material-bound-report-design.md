# Material-bound lesson reporting — proposed design

Status: proposal, not implemented. Lior has requested implementation and approved
separating teaching coverage from understanding. The checkbox granularity question
is pending: the recommended design below uses teachable subtopics, rather than
whole plan skills. It must be adjusted if he chooses whole skills.

## Purpose

The tutor reports what the actual lesson covered, using the presentation as the
checklist. Covered/not covered and a topic comment are independent of an optional
judgment of understanding. Reports inform preparation and homework for later
lessons without treating an untaught topic as a student difficulty.

## Tutor behavior

- Resolve published materials explicitly associated with the booking. Select the
  taught material; preselect it only when exactly one eligible material exists.
- Show its teachable topics with covered/not-covered controls and optional comments.
  Link each topic to its associated presentation scenes. Do not infer semantic
  groups or skill links from scene titles.
- New generation supplies an optional, validated topic manifest with stable IDs
  within the material, titles, scene IDs and known curriculum skill keys. These
  identifiers are not assumed to be universal subtopic IDs across different lessons.
- Existing material without a manifest remains usable. The tutor can add named
  topic rows with optional scene references and explicit plan-skill links in this
  report, without altering or regenerating the published material. With no usable
material, the tutor may still file explicit manual topics or explicit empty coverage,
with source=manual and no material binding. That is not legacy unknown coverage. The existing
  plan-based report remains available as explicitly legacy/unknown coverage.
- Understanding remains an optional, separate judgment for each plan skill. Topic
  coverage never sets mastery, and selecting a mastery status never sets coverage.
- Explicit filing confirms the complete checklist, including the valid case where
  zero topics were covered. Blank comments carry no negative judgment.

## Immutable provenance and revisions

Pin the material slug, material ID/version and content hash, plus the exact topic
manifest, per-topic choices/comments and plan-skill links in an append-only report
revision. Corrections reuse the filed material snapshot rather than resolving the
possibly replaced homework material. An explicit correction may instead select a
different eligible material when the original selection was wrong; append the new
binding and keep the previous revision and its source intact. Existing notes and
events are preserved.

A new filing supplies an expected report revision; stale windows receive a conflict.
The server validates booking ownership, material association, scene/topic membership,
unique IDs, comment bounds and skill membership in the booking's enrollment plan.

Latest-revision coverage governs current behavior. Historical claims remain visible,
but a corrected-away covered topic must not continue to count as taught solely
because an older report wrote a covered event. Legacy reports retain their existing
meaning; missing coverage is distinct from an explicit empty checklist.

## Practice and future lessons

Generate written homework from covered topic titles, linked skills and tutor comments,
with the uncovered topics as exclusions. Validate returned topic references against
that exact report revision. Valid topic IDs alone are insufficient: a separate
bounded assessment must check mathematics, private answer keys, covered-topic fit
and uncovered-topic exclusions before release. Its failure withholds the new
practice and records the failed assessment. Do not infer that covering one topic covered its entire
plan skill. Comments and the source snapshot stay tutor-only.

Do not release or attach a whole-skill library master merely because one of its
skills was mentioned. Reuse is allowed only with explicit compatible topic provenance
showing that the practice contains no untaught material. Unknown/broader library
fallbacks remain withheld in explicit topic mode. Do not filter an experience into
an invalid lesson or repeat questions to satisfy a ten-question bank.

Prepared practice containing untaught or unmapped topics stays preparation. Explicitly
untaught work needs durable withholding so expiry and generation-failure fallbacks
cannot release it later. Zero covered topics releases no new homework. Historical
unknown reports retain their established fallback behavior.

Already released work is preserved. Async generation checks the current report
revision again inside the write transaction, so a slow older filing cannot publish
homework after a correction supersedes it.

Future preparation receives the most recent effective report's covered/uncovered
material-scoped topics and comments. The plan skill remains the tutor's selection;
partial coverage narrows the next lesson rather than silently advancing it. Whole
library reuse must satisfy the same scope or be bypassed. Do not claim canonical
cross-lesson subtopic mastery from generated topic IDs.

## Implementation boundaries and verification

Use the existing SvelteKit, SQLite append-only material/history and signed practice
infrastructure; no new runtime dependency. Add a report-revision migration rather
than rewriting historic material. The migration number is chosen at implementation
against the then-current registry.

Regressions must cover explicit empty versus legacy unknown coverage, partial skill
coverage, foreign topic/scene/skill IDs, material edits after filing, corrections,
stale tabs and async completions, expiry, engine/library failure and protection of
already released practice. Synthetic mobile/desktop reporting must show coverage
and understanding separately, preserve comments and prove the downstream scope.
No real bookings, customer-content replacement, migration deployment or rollout is
part of this proposal.

## Builder calls

The legacy manual-topic fallback, single-material preselection, conservative library
reuse and one optional understanding judgment per whole plan skill are implementation
recommendations, not decisions attributed to Lior. Explicit material reselection
on correction, manual explicit reports without material, and independent homework
scope/key assessment resolve builder-review edge cases as implementation calls.
The implementation plan follows
once the important reporting granularity decision is settled.
