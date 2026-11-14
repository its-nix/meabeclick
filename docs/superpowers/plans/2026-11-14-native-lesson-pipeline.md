# Native lesson pipeline implementation plan

Spec: ../specs/2026-11-14-native-lesson-pipeline-design.md

1. Implement durable student/booking-scoped jobs and booking enqueue hook; test replay,
   cancellation, restart and failure isolation. Expose tutor preparation state.
2. Implement reusable native bundle exporter/publisher using the existing visual
   composition model and personal OAuth client, preserving notes/answer separation.
   Test native MIME, linked IDs, idempotent retry and human-edit preservation.
3. Integrate draft worker with jobs and linked Sheets records. Unsupported contexts
   need tutor preparation; never silently fall back to legacy HTML generation.
4. Produce a synthetic normal-distribution bundle in Drive Review and inspect every
   slide/document, mathematics, RTL and source treatment against Nikol's references.
5. Independent bounded review, full supported CI, browser checks, safe deployment.
   Keep student delivery gated on actual owner teaching approval.
