# Tutor workflow feedback

## Tutor game access — local candidate, 2026-11-07

Todoist `6hwqV7hXX2cqqfxH`; synthetic fixture: `tests/unit/tutor-game-preview.test.mjs`.
Games opened from the tutor's lesson feed previously carried student score
credentials and returned to the student board. Legacy stored links also kept
their retired game paths. The tutor feed and catalog now issue authenticated,
private previews without student identity, best scores, skill progress or result
signatures. Published assignment previews read their immutable snapshot; the
editor's draft preview remains separate. Return links retain the selected
student workspace or lesson picker; missing games recover within tutor pages.
Student-signed links, stored material and results are preserved.

Focused route tests reproduce the legacy/current link failure and check tutor
auth, rejected score writes, published/draft isolation and catalog context.
`tests/browser/tutor-game-preview.mjs` checks completed gameplay and queued-result
isolation on a synthetic mobile page. Combined verification passed: Linux/Node
22 build and warning gate, all 1,753 tests, and the mobile gameplay browser
regression. No customer material was replaced or deployed.
