# Sitewide UX implementation verification

Date: 2026-11-02. Scope: approved audit findings 1-15 and an operational tutor overview. This is bounded engineering evidence, not an accessibility or production-data certification.

## Delivered

| Finding | Implementation and evidence |
|---|---|
| 1 | All five learner destinations wrap and use native buttons. Homework checkboxes have task names and 44px targets. Payment rows become phone-safe records; affected inputs use 16px. Browser: 320px learner navigation, homework and payments, no page-wide overflow. |
| 2 | Preparation queue comes before the catalog; all filters are outside its scrolling table. Catalog pages contain at most 25 rows and URL state preserves filters/page. Browser: 320px, visible filters, queue near the top, search/reset and page 2. Unit and authenticated characterization tests cover identity and bounded results. |
| 3 | Lesson save, publish and status stay in a sticky action area; editing sections are native disclosures. Browser: 390px, 15-slide synthetic lesson, actions at viewport top after scrolling over 6,600px. Saving and publishing remain separate; editor/API tests pass. |
| 4 | Failed profile/note saves retain field-specific drafts with adjacent retry; dirty game switching confirms before any replacement. Browser: injected local note failure, retained draft across section changes, successful retry. Native game confirmation appeared, but browser automation stalled before cancellation could be confirmed; source regression verifies the guard precedes every draft mutation. |
| 5 | Five visible plan filters use existing domain flags, retain ancestor context and expand matching paths. Browser: phone review filter and local report submission landing on the visible changed skill. Plan/report tests cover hidden skills, status semantics, URL seeding and report continuity. |
| 6 | One canonical ledger owns payment rows, totals and row/bulk actions. Explicit loading/error/retry replaces initial settled flashes. Independent activity reads survive charge-read failures. Browser: local payment failure still displays both homework tasks, payment retry restores rows, and void cancellation leaves the ledger intact. Async tests cover partial failure and out-of-order activity responses. |
| 7 | Public menu uses a native modal dialog. Closed content is hidden; Escape and close restore focus to its opener. Browser: opening focuses Close; Escape closes; Shift+Tab does not enter the closed menu. |
| 8 | Each carousel has persistent pause/resume independent of transient hover/focus/grace. Browser: paused scroll position remains unchanged after focus moves to the menu and back. Source tests preserve reduced-motion precedence and manual navigation. |
| 9 | Parent next lesson and learning evidence precede repeated access and detailed finances. Multi-child overview leads with children; family finances are a disclosure. Browser: single-child board at 390px and desktop, multi-child navigation. Access response generation is invalidated on child selection; async regressions cover A-to-B, A-to-B-to-A and overlapping issuance. No production access was issued. |
| 10 | Homework-based progress is shown once; distinct skill mastery remains separate. Browser: populated 390px student homework, one submission summary and no parent-only note. |
| 11 | Safe internal return links preserve learner or filtered-library context, while a separate overview link remains. URL tests reject external/action routes and nested return chains. Browser: editor link back to catalog page 2 and report-to-changed-plan with learner return context. |
| 12 | Failed library refresh labels last-known data and offers retry. Browser: injected local 503, visible stale warning, successful retry, search and reset. |
| 13 | Homepage portal preview explicitly says its values are illustrative, not real learner data. Source regression and rendered label checked. No replacement people or numbers invented. |
| 14 | Booking footer describes the displayed outcome and conditional email action instead of promising human final approval. Booking honesty tests pass; no production booking submitted. |
| 15 | Game wording is limited to real play routes. Other errors use neutral/access copy and safe tutor/family/public recovery. Source regressions cover the routing contract; no role elevation added. |

Tutor overview now presents pending report actions, homework awaiting review, upcoming lessons and due-now payment follow-up before the roster. Follow-up excludes future, paid and void charges and uses integer agorot, matching the server's due-now boundary.

## Checks

- Baseline: 1,657 tests passed.
- Final application tree: `npm run build` passed; `npm run check:ci` passed with 22 warnings at the existing ceiling; `npm test` passed 1,688/1,688.
- `git diff --check` passed.
- Independent whole-branch review found two Important issues. Both were reproduced with tests of the actual async functions, then fixed RED-to-GREEN: partial activity/payment fetch failure and cross-child access-response races.
- The report-input floor was initially labelled Minor by review. It was regraded as an unfinished approved requirement and fixed with a failing regression first.
- No new dependencies, assets, schema, authentication policy or external service integration.
- All interactive writes used disposable local synthetic data with external credentials and generation disabled. The fixture server was stopped and its disposable database removed.

## Visual and design boundaries

The sampled layouts included desktop 1440px, phone 320px/390px, long Hebrew labels, empty/populated data, failure/retry and keyboard navigation. This was not every route/data/breakpoint permutation.

Brave applied an existing page-color extension during family/public checks; those screenshots support layout and interaction findings, not a claim about native rendered contrast. Chrome's earlier tutor screenshots used the native light theme. Brand tokens were not replaced.

Not exercised: physical phones, assistive-technology speech, representative 200% browser zoom, runtime reduced-motion emulation, a new self-paying-family browser fixture, exhaustive payment mutations, or completed native-game-confirm cancellation. Existing role/self-payer/domain tests remain green. No field performance or complete WCAG certification is claimed.

## Detector triage

The isolated worktree's deterministic scan reports 11 existing patterns: two bounce matches, four progress-width transitions, four state-accent borders and one documentation-comment image match. The root checkout already has a narrow booking-warning exception that the isolated baseline does not include; the additional count is not a newly introduced border.

Fixed: the 15 approved functional/hierarchy findings above. Suppressed in this implementation: none. Left standing: meaningful warning/error borders, existing bounded progress transitions, the inactive bounce hint, existing brief popup motion and the BrandMark documentation-comment false positive. None establishes a new major UX defect or measured jank. No broad file/rule ignores were added.

## Review rulings and residual costs

1. Report input sizes were regraded Important because the approved 16px floor was unfinished. Fixed; cost if wrong is limited to larger form controls.
2. Retain native dirty-game confirmation: no product failure was established by the browser transport stall. Cost: cancellation is source-verified rather than successfully browser-exercised.
3. Keep accessibility claims bounded to recorded checks. Cost: physical-device, zoom and assistive-technology behavior remain unverified.
4. Retain the existing empty-curriculum fallback: no ordinary existing-plan path with an empty server tree was established; no-plan creation is separate. Cost: unusual malformed data may still show a placeholder map.
5. Keep refresh-based cross-client payment consistency, not a new transactional/live-update architecture. Cost: another tutor's simultaneous changes require refresh.
6. Retain in-flight library refresh coalescing: existing polling/retry provides recovery and no stuck job state was demonstrated. Cost: a follow-up status may wait for the next poll.
7. Do not expand into unproven broader family-navigation races after fixing the demonstrated issuance race. Cost: other unusual concurrent transitions are not exhaustively established.
8. Leave authentication policy, generated teaching content and pricing correctness unchanged. Cost: this UX pass is not an audit of those domains.
9. Do not undertake cosmetic or architectural cleanup without a functional defect. Cost: pre-existing styling and technical debt remain.

Deferred Minor findings: none after regrading the unfinished input requirement. No second review was commissioned; review fixes were verified by failing regressions, the focused green tests and the complete green suite.
