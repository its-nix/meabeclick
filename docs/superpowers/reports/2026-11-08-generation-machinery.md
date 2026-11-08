# Artifact generation execution record

Implementation: `codex/generation-machinery`, commit `98fdb48`.
This branch starts from main independently of the earlier tutor-workflow fixes.
It has not been deployed, merged or imported into the reusable content library.

## Recurring feedback and resulting behavior

| Theme | Previous limitation | Shared change |
| --- | --- | --- |
| Concept-appropriate explanations | Fractions, triangles and tangents often fell back to formulas alone | Bounded numeric fraction bars, right triangles and quadratic tangents use the same renderer in interactive lessons, print and prepared video |
| Correct, coherent teaching | Shape validation could accept wrong keys or explanations | Fresh output receives structural checks and an independent structured critique of every slide, example, homework item, game question and learning scene |
| Actionable repair | A retry lacked the exact failed candidate and artifact failures | One repair receives both; malformed critique or engine faults stop the attempt |
| Teacher visibility | No durable assessment associated with a generated snapshot | Private append-only reports and a tutor-only endpoint distinguish the assessed draft/publication from later edits; synthetic review has an assessment view |
| Independent practice | Hiding a solved formula visually could leave it in serialized frames/templates | New numeric question stimuli replace worked formula/caption in the public projection; earned feedback returns the explanation |
| Question quantity and progression | Small static banks, no difficulty evidence | Fresh question banks require at least ten unique items with stable IDs and three levels; finite sessions use ten questions and adapt within assigned skills |
| Timed activity | A ten-answer requirement would conflict with the timer | Speed drill retains its timer, uses a bank of at least ten and can end after fewer answers |
| Reliable mathematics and text | Small lengths could round to zero; derived decimal slopes could show floating noise; split UTF-8 output could corrupt Hebrew | Precision-aware numeric rendering, exact decimal slope calculation, valid scientific TeX and streaming UTF-8 decoding |
| Real interactions | A generated prompt could promise unavailable sliders | Generator and critic now receive explicit renderer capabilities; exploration copy matches sliders, authored playback or observation |

The old teal/parchment requirements are superseded. All rendering uses the
existing shared blue/slate brand. Historical lessons and games remain readable;
new question-bank requirements apply to fresh generation. Teacher notes remain
private. No practice event automatically changes the learning plan.

## Verification

- Linux, Node 22.20.0: **1,783 tests passed**, no failures. Production build passed.
- Type/warning gate: passed with 22 existing baseline warnings.
- Browser: all six adaptive templates, saved signed evidence, hint/error
  adaptation, ten-question finite completion and timed completion; preview
  play generated zero result writes.
- Browser: all three numeric visual types at 390/1440 pixels, print and prepared
  video; raw payload/template privacy, earned feedback and small-value labels.
- Existing learning playback: 320/390/768/1440 pixels, no browser errors.
- Historical review: 120 scene viewports and 28 games, no customer records or
  results written. Existing ten-case corpus remains unchanged.
- Tutor assessment API: unauthenticated and pupil requests denied; draft and
  publication hashes become stale independently after tutor edits.
- Independent review findings were corrected and rechecked: solution leakage,
  small-number labels, decimal slope cancellation and scientific TeX.
- RTL detector: touched UI files have no remaining findings.

The tested generation-source fingerprint is
`4aa1c3d55ca9451da77dfaab5f15b86cb51989002b50d8c79e2a1f5eb8f5d281`.
The Linux-tested snapshot and current generation sources match.

## Real generated evidence

Representative generation is in progress using `gpt-5.6-sol`, high effort,
Codex CLI 0.167.0 and the source fingerprint above. Outputs are synthetic and
stored outside Git. The baseline remains `pilot-2026-11-06`. A source-sealed fractions canary passed all 52 artifact checks and independent arithmetic review. That review also identified teacher-directed text in the intentionally public legacy slide-note field. Fresh generation and critique guidance now make its student-facing role explicit; no historical public note is hidden or deleted. A fresh ten-case batch uses the updated fingerprint.

An earlier diagnostic fractions run caught a real mismatch between its promised
interaction and the available controls. It also demonstrated exact pedagogical
failure feedback followed by a passing repaired candidate. Because sources
changed during that run, the provenance seal failed and packaging refused it.
That directory is diagnostic evidence only; its seal must not be overridden.

Generation and critique do not constitute human teaching approval or count
toward the production-generation reliability streak. Record completed batch,
quality results and remaining teaching review here before claiming rollout
readiness.

## Subsequent task boundaries

The end-of-lesson coverage checklist and contextual editor additions are still
pending. Coverage must remain separate from understanding: an untaught topic
does not mean a pupil struggled with it. Explicit empty coverage must also
differ from historical unknown coverage, so teaching no topics cannot release
all planned homework through the legacy empty-list fallback. Uploading photographed homework is a
separate workflow, not completed by these generator improvements. The earlier
five tutor-workflow fixes remain in their own worktree.
