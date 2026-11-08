# Artifact generation execution record

Implementation: `codex/generation-machinery`, initial commit `98fdb48`, refined
source commit `ef5c1d0`. [Draft PR 104](https://github.com/its-nix/meabeclick/pull/104)
contains the machinery changes. The earlier tutor-workflow fixes are isolated
in [draft PR 105](https://github.com/its-nix/meabeclick/pull/105).
Neither branch is merged or deployed. No reusable library import or customer
material replacement is included.

## Recurring feedback and resulting behavior

| Theme | Previous limitation | Shared change |
| --- | --- | --- |
| Concept-appropriate explanations | Fractions, triangles and tangents often fell back to formulas alone | Bounded numeric fraction bars, right triangles and quadratic tangents share the web, print and prepared-video renderer |
| Correct, coherent teaching | Shape validation could accept wrong keys or explanations | Fresh output receives structural checks and a separate critique of each slide, example, homework item, game question and learning scene |
| Actionable repair | A retry lacked the exact rejected candidate and failures | One repair receives both; malformed critique and engine faults stop the attempt |
| Teacher visibility | No durable generation assessment | Private append-only reports and a tutor-only endpoint distinguish assessed content from later edits; synthetic review has an assessment page |
| Independent practice | Visually hiding solutions could leave them in serialized frames/templates | Question stimuli replace worked formula/caption in the public projection; earned feedback returns the explanation |
| Question quantity/progression | Small static banks without difficulty evidence | Fresh banks require at least ten unique items with stable IDs and three levels; finite sessions use ten questions and adapt within assigned skills |
| Timed activity | A ten-answer requirement conflicts with a timer | Speed drill retains its timer and a bank of at least ten; it may end after fewer answers |
| Reliable mathematics/text | Small labels rounded to zero, decimal cancellation showed noise, split UTF-8 could corrupt Hebrew | Precision-aware labels, exact decimal tangent slope arithmetic, valid scientific TeX and streaming UTF-8 decoding |
| Available interactions | Generated prompts could promise nonexistent controls | One metadata source drives rendered controls and structured generation/critique guidance, including ranges and restrictions |
| Validity versus efficiency | Game keys could call valid but inefficient/irrelevant work an error | Generator and critic explicitly check logical validity and the first genuinely invalid transition |
| Stable feedback | Position references became wrong after rotating/shuffling choices | Producer and critic share guidance to explain the claim/expression rather than its option position; fixed solution-step references remain valid |
| Bounded critique | A two-minute critic could timeout and the batch would keep scheduling | Critique honors a lower configured limit up to five minutes; passing explanations stay concise; timeouts stop new batch calls |
| Comparable graphs | Each GraphMatch curve used a different vertical scale | Main and all options share coordinates and numeric ticks, preserving slopes, offsets and constants |
| Visible reference graphs | Generated target could copy the displayed reference | Fresh banks reject copied targets and indistinguishable plotted choices; generation states the actual centered sampling grid |
| Scoped teaching | Definitions could precede examples and challenges could introduce untaught parameters | Shared example–why–rule sequence, assigned-skill boundaries and preservation of passing artifacts during repair |
| Long-bank normalization | Rotation assumed short banks and produced undefined options near question 14 | Normalized rotation offset preserves every choice, key and metadata field through forty-item banks |

The old teal/parchment requirements are superseded; the existing shared
blue/slate brand remains authoritative. Historical lessons and games remain
readable. New bank requirements apply to fresh generation. Practice never
changes the learning plan automatically. Presenter notes remain private.
The legacy slide-note field is intentionally public; generation and critique
now state its learner-facing role explicitly. Fresh valid learning experiences
use the interactive renderer, which already keeps presenter notes separate.

## Verification

- Linux, Node 22.20.0: **1,804 tests passed**, no failures; production build passed.
- Type/warning gate passed with 22 existing baseline warnings.
- Browser: all six adaptive templates, signed evidence, hint/error adaptation,
  ten-question finite sessions and timed completion; zero preview result writes.
- Browser: three new numeric visual types at 390/1440 pixels, print and prepared
  video; raw payload/template privacy, earned feedback and small-value labels.
- Existing learning playback at 320/390/768/1440 pixels, no browser errors.
- Six independently accepted real candidates: 76 mobile/desktop scene views,
  presenter notes, homework and assessment pages; no runtime/math errors or
  horizontal overflow. Fraction and triangle screenshots inspected directly.
  This is partial evidence, not an assembled ten-case candidate.
- Historical review: 120 scene viewports, 28 games and ten quality-report pages;
  no customer records/results written. The historical corpus is unchanged.
- Tutor assessment API denies unauthenticated/pupil access and independently
  detects changed drafts and publications without rewriting earlier evidence.
- Independent scoped code review has no outstanding findings.
- RTL detector: touched UI files have no remaining findings.
- Both PRs merge cleanly after separating their feedback notes. A temporary
  combined checkout passed its build, seven preview/remount regressions,
  all adaptive browser templates and tutor-preview completion/recovery, with
  zero preview result writes. The temporary merge was then aborted.

The tested refined source fingerprint is
`39b831d3c307c94ff88e63e500cf7d045e3b004daa741c99f05b510fb80b9fff`.
The Linux-tested snapshot and current generation sources match. GitHub CI
passed both PRs, including generation head `ef5c1d0`; deployment is skipped
for these pull-request runs.

GraphMatch's browser regression failed before the fix on identical proportional
polylines and passed afterward. The two actual generated linear-game rounds
were replayed at 390/1440 pixels: four distinct options each, shared zero axes,
no errors and no result writes. Long-bank regressions first reproduced six
rotation failures, then verified complete permutations, correct key bindings,
metadata preservation and unchanged already-varied banks at sizes 15 and 40.

## Real generated evidence

All calls use synthetic briefs and Codex CLI 0.167.0. Earlier batches use
`gpt-5.6-sol`, high effort; the separate final four-case trial uses
`gpt-6.1-sol`, medium effort. This evaluation does not change production model
configuration. Each batch preserves its own source, model and effort metadata.
Outputs live outside Git. They are not production-generation streak evidence.
The previous corpus remains `pilot-2026-11-06`; no generated key is hand-edited.

The sealed ten-topic run `meabeclick-generation-role-20261108-aVGYaz` uses source
`4aa1c3d55ca9451da77dfaab5f15b86cb51989002b50d8c79e2a1f5eb8f5d281`.
It completed with six automated passes and four fail-closed rejections:

| Topic | Automated result | Independent disposition |
| --- | --- | --- |
| Fractions | Passed after repair | Arithmetic, public note roles and fraction playback pass |
| Negatives | Rejected after repair | Missing cancellation case/visual consistency; critic also proposed an unsupported multi-value number-line frame |
| Equations | Passed | Reject: valid but inefficient subtraction is incorrectly labelled false |
| Percentages | Passed after repair | No blocker; unused takeaway should distinguish quantities rather than claim their values always differ |
| Pythagoras | Passed | No blocker; fresh numbers would strengthen an inverse missing-leg challenge that reuses a demonstrated triple |
| Linear graphs | Passed after repair | Reject: displayed reference equals correct choice; later common-scale fix alone does not remove this answer leak |
| Quadratic transformations | Rejected after repair | Missing minimum argument and an untaught parameter in the challenge |
| Linear/quadratic graphs | Rejected after repair | Long-bank normalizer consumed first repair; later question exposed its worked answer |
| Factorisation | Rejected after repair | Question-only stimulus combined with multiple worked frames |
| Derivatives | Passed | Reject: correct height computation is marked as the error instead of the later claim that height is slope |

These findings produced shared fixes: the critic now reuses the canonical
learning contract, valid-but-inefficient steps are distinguished from errors,
question-only stimulus constraints are explicit, graph coordinates are shared,
and long-bank answer rotation is corrected. The earlier missing statement at
round 14 was a normalizer defect, not missing model output.

The sealed six-case run `meabeclick-generation-repaired-20261108-bc0SlT`
uses source `3b9cf8a0b551a95fef08ff73cd087b86bc574bba8675894c606c521a651fd817`.
Independent review accepts negatives, equations and factorisation, including
all game keys and assigned scope. Quadratic transformations exhausted repair;
derivatives hit the producer's five-minute deadline before critique. Combined
graphs passed the automated gate but independent review rejected an unavailable
`a` slider and a Graph Match target copied from its reference. These prompted
the shared control metadata and fresh graph guard; the candidates are not edited.

Six candidates are accepted as review evidence: fractions, percentages and
Pythagoras from the first run; negatives, equations and factorisation from the
six-case replacement run. Their exact plans and assessments passed checksum
and current structural validation, then the 76-scene-view partial browser check.

The separate `gpt-6.1-sol`/medium trial
`meabeclick-generation-final-trial-20261108-JD2SKW` uses source
`39b831d3c307c94ff88e63e500cf7d045e3b004daa741c99f05b510fb80b9fff`.
Linear graphs exhausted repair after a malformed question stimulus was removed
and the assessment found a visible answer formula. Quadratic transformations
exhausted repair: answer-revealing matching hints were reported first, then a
visible explanation of parameter names was still missing. Combined graphs
exhausted repair on math-delimiter formatting after its structural repair; the
assessment marked the mathematics correct. These are automated-gate results,
not independent acceptance or independent confirmation of rejected artifacts.
Derivatives also exhausted repair: correct difference-quotient arithmetic was
paired with a fixed tangent graphic that did not depict the promised moving
secants. All four selected cases ended as `bad-output`, with zero READY plans
and zero independent content acceptances. The run-completion source seal was
verified at 09:11:30 UTC; failed-report checksums match the manifest. No model
process remains active.

A complete ten-case candidate cannot be assembled from these results.
Packaging must not fall back to older automated passes that independent review
rejected. The original pilot remains unchanged; no generated key or candidate
is hand-edited to obtain a pass. Original runs and rejected reports remain
available for comparison. Targeted runs changed source and sometimes model,
so their outcomes are not a controlled before/after quality or latency benchmark.

The first refined run exposed a two-minute critique timeout after a semantic repair. Its in-flight calls were stopped deliberately; those cancellations are not production engine failures. The failure report also identified position-dependent feedback invalidated by statement rotation. The shared feedback contract and critique-budget/scheduling fixes above were verified before starting a new six-case run.

An earlier diagnostic fractions run demonstrated precise failure feedback and
repair, but source changes during that run correctly caused its provenance
seal to fail. That failed seal must not be overridden or used as release
proof. Another sealed fractions canary informed the public slide-note role
clarification before the ten-topic run.

The current strict gate still blocks formatting-only violations. A product
question about tutor-only drafts with formatting warnings is pending; no such
exception has been implemented.

Human teaching approval remains pending for every new example. Automated or
independent model review does not replace the tutor's teaching judgment.

## Subsequent task boundaries

The lesson-report coverage checklist and contextual editor additions remain
pending. Coverage must stay separate from understanding: untaught does not mean
struggled. Explicit empty coverage must also differ from historical unknown
coverage, so teaching no topics cannot release all planned homework through a
legacy empty-list fallback. Expired holds and fallback releases also require
that distinction. Homework-photo submission is a separate workflow.

Read-only editor investigation found that the legacy lesson editor appends
blank slides/examples/questions, whereas the general game editor clones its
first collection item. Contextual additions need a new, relevant draft based
on the current unsaved lesson/game, with existing content and publication
preserved until the teacher reviews and saves. That proposal workflow has
not been implemented in this branch.


## Implementation continuation: text trust boundary

A new regression demonstrated that empty, whitespace-only or overlong frame/stimulus
text could satisfy the generator schema but fail the renderer. The schema and
runtime now share existing formula/caption length limits; fresh schemas and local
validation also require non-whitespace content. Nullable-union diagnostics identify
the exact failing field, with actual and allowed lengths, rather than hiding it in
a generic object-shape error. An independent bounded code review has no remaining
findings. Historical renderer acceptance and stored content are unchanged.

Latest tested source fingerprint:
`eb6e37c4d56ccf254c5f8c247caaa2061e3bdf609342260e0588fb6ae8c074a4`.
The Linux snapshot matches the worktree source. Node 22.20.0: **1,807/1,807 tests**,
production build and warning gate pass (22 baseline warnings). Initial harness
failures were traced to a non-executable tmpfs and an old tracked test log in the
reused sanitized checkout; test executables and logs were isolated correctly before
the complete passing run. Failed harness logs are retained outside the checkout.

No real-generation acceptance is claimed for this correction. The prior four-case
trial remains rejected and sealed under its own source. No models are running.

Two design choices have been raised with Lior: mechanically targeted artifact repair
within the existing one-round budget, and reporting at teachable-topic versus whole-
plan-skill granularity. The strict formatting policy remains unchanged. Proposed
repair design: `docs/superpowers/specs/2026-11-08-targeted-artifact-repair-design.md`.
Reporting is isolated on `codex/presentation-report`; its design accounts for partial
skill practice, immutable sources, explicit zero coverage, report corrections and
stale async completion. Neither proposed feature has been implemented yet.
