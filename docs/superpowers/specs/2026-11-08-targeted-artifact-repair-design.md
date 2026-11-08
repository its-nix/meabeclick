# Targeted artifact repair — proposed design

Status: approved for implementation by Lior's subsequent “go on”, following the
recommendation for targeted repairs. The existing whole-bundle behavior remains
until the implementation is verified.

## Problem and intended behavior

The four remaining review cases exhausted their one repair. Structural failures
can consume the repair before critique; a full replacement can rewrite previously
passing content; a later assessment can expose another defect. The confirmed text
schema/runtime mismatch is being fixed independently. Adding more prompt rules is
not the proposed repair strategy.

Keep initial whole-bundle generation and independent assessment. When failures have
safe artifact locations, ask for only those artifacts and apply their replacements
mechanically. Previously passing artifacts remain byte-for-byte data-equivalent.
Then validate and assess the complete assembled bundle again, including coherence
and answer leakage across artifacts. An unchanged artifact is not exempt from that
final assessment; a newly discovered failure still rejects the bundle.

## Repair units and trust boundary

Units are slides, worked examples, homework items, learning scenes, individual bank
questions/rounds, typed primitive metadata fields and whole non-bank games. Public
metadata has its own assessment path so a title or bound repair preserves the bank. A container failure, such as an invalid
bank size, may require replacing that game as a whole. Build the unit catalog from
the candidate and the existing lesson schema; generated paths never define setters.

Resolve a failed nested field to its containing unit, requiring an exact path
boundary. Parent units subsume children. De-duplicate identical aggregate validation
messages when an existing specific issue already identifies the same failure.

The repair response is one object whose required properties are exactly the chosen
unit paths; each value uses that unit's strict existing schema. Reject omitted or additional units and invalid types. Parsed object keys define
unique replacement slots; no new raw-JSON duplicate-key parser is introduced. Apply values only through the
trusted catalog to a clone. No executable patch, arbitrary JSON-pointer traversal,
external writes, new dependency or generated code is introduced.

Do not re-run a whole-bundle normalizer that would rewrite passing units. Normalize
only a replaced whole game where needed, then validate the whole result. Historical
material and assigned content are not inputs to this repair flow.

## Scope and budget

Retain one repair round per bundle, the existing per-call timeout and engine-error
behavior. This proposal does not add unlimited retries, per-item retry loops or
parallel paid calls. A structural rejection that cannot be located safely falls
back to the existing one whole-bundle repair; do not guess a partial edit.

Passing units can be changed only when they are explicitly identified as failing
or affected dependencies. The critic must name every affected path for a cross-
artifact defect. If a dependency was missed, the final assessment can reject it;
there is no hidden extra repair. Unknown/global failures keep the full-repair path.

## Assessments and compatibility

Retain the existing report version, generation snapshot hashes and at most two
candidate assessments. Optionally record repair mode and requested unit paths on
the second assessment for private audit. Older reports remain readable. Malformed
repair responses, invalid critiques, engine faults and exhausted repairs fail closed.
Formatting-only exceptions are a separate pending product question; strict behavior
remains unchanged here. This work does not change the production model selection.

## Validation and review evidence

Tests must prove unchanged passing artifacts, exact handling of indices such as
2 versus 20, subsumed parent/child failures, rejection of foreign or missing
replacements, malformed initial candidates, scoped normalization, final coherence
rejection, private reports and engine-fault stop behavior. Keep real failed reports
for comparison. Re-run the four affected synthetic cases in a new sealed directory
only after implementation checks pass. A full corpus still requires all ten accepted
cases with per-case provenance and human teaching review remains outstanding.
