# Sitewide usability fixes

## Approved scope

Implement findings 1-15 in `anti-slop/audit-001-2026-11-02.md`. The user approved all findings and selected an operational overview for the tutor dashboard on 2026-11-02. This document clarifies that direction; the audit contains the evidence and individual acceptance requirements.

## Tutor operational overview

The default dashboard answers what needs attention and what happens next, rather than leading with six equal counters. Show actionable pending reports, calendar write/read problems, upcoming lessons and payment follow-up using existing server-confirmed data. Unknown or loading information is not zero, settled or successful. Each actionable item leads to its learner or existing workflow. The student roster remains directly accessible. Do not invent financial totals, new deadlines or preparation-readiness scores.

Within a learner, keep the five existing destinations, make them all discoverable on phones, use the available working width and provide one canonical payment ledger. Retain manual payment recording and existing server authorization. Access issuance stays an explicit, scoped confirmation workflow. Parent-facing notes remain private from students.

## Interaction decisions

- Keep Hebrew RTL, Heebo, existing blue/neutral tokens and native familiar controls. No brand redesign, new dependency, new asset or dark-mode project.
- Meet the product's 16px form-input floor and 44px action targets in affected workflows. Preserve keyboard access, visible focus and native names.
- Library: preparation needs first, filters outside the wide table, catalog pages of 25 rows. Preserve filter/page context in the URL and preserve full-topic bulk preparation semantics.
- Editor: persistent save/publish state and actions, collapsible editing sections, and explicit confirmation before replacing a dirty local game draft. Saving must not publish.
- Visible learning map: expose all, recommended, needs-review, blocked and changed filters using existing domain facts. Report completion opens the visible changed filter.
- Navigation: preserve only safe internal tutor return destinations, including library filters and learner context. Keep a separate route to the global overview.
- Family pages: next lesson and learning evidence precede repeat access administration and detailed finances. Show a single homework submission summary; keep distinct skill mastery when present.
- Public pages: closed menus cannot receive focus; opening, Escape and focus return work. Carousel pause persists until explicitly resumed. Demo values are explicitly illustrative. Booking instructions match the implemented outcome. Error recovery describes the relevant task, not every route as a game.
- Failed saves retain recoverable user text. Failed refreshes retain labelled last-known data and expose retry. No successful-state flash before data loads.

## Boundaries and verification

Use the existing Node unit/characterization tests, Svelte checks and production build. Add regression coverage for each finding, including failure and dirty-draft paths. Inspect the built desktop and 320px/390px layouts, keyboard navigation and representative empty/populated/error states using disposable synthetic data. Do not create production bookings, issue production access, publish, generate lessons, change payments or submit reports to verify this work. Do not commit real names, contact details, balances, tokens or credentials.

Builder-owned choices: exact Hebrew control copy, restrained spacing, native disclosure layout and implementation details within the existing architecture. No additional product approval is needed for these choices.
