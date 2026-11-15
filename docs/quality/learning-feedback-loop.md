# Feedback and independent review

Leave comments directly on registered private Google Slides or homework Docs.
Select the relevant text/object and describe what is confusing or what should
change. A slide number or exact quote helps when Google's comment anchor is
unavailable. The teaching index also accepts file-level comments about the process;
these can propose future guidance but never change student records.

In the existing teaching Sheet, open **Learning Reviews**. Its file titles link to
the corresponding artefact. The adjacent **Learning Feedback** tab gathers the
original comments, proposed wording and independent verification findings.

1. Finish a batch of comments, then select **מוכן לסוכן** in that file's action cell.
2. The worker proposes corrections. A fresh agent using the same model reviews
   the proposal without the creator's conversation, reasoning or self-rating.
3. Review the proposed old/new wording. Select **אישור · בדיקה N.A** to accept that
   exact review attempt. An offline selection for an older version cannot approve
   a newer proposal. Choose the token-specific request-changes action to reject it;
   add the missing feedback and submit Ready again.
4. Accepted text changes preserve native file IDs and presenter notes. The worker
   captures actual revised Google Slides thumbnails or a Docs-exported PDF and
   starts another fresh review. Threads resolve only after successful verification.
   If the file or comments changed during review, approval is blocked. A failed
   final check retains its findings and leaves the private file awaiting repair.
5. A suggested instruction for future generation needs its own explicit approval
   after the individual review has been accepted. Accepting a deck alone never
   changes future lessons. Approved instructions appear as separate policy rows,
   each with its own token-specific revoke action and retained audit history.

The collector runs every five minutes when LEARNING_FEEDBACK_ENABLED=true. It
polls at most 50 artefacts per cycle in rotation, processes a bounded serial batch,
and pauses new proposals after shared authentication/quota failure. Google API
errors and engine failures remain visible; they do not become approvals.
Notification retries use a durable outbox and stable thread markers. They never
regenerate a lesson or downgrade a verified file when a reply fails. New human
replies keep a thread open even if an older verification notification arrives late.

## Scope and safety

Current automatic edits are wording-only, with exact expected text, fixed API
operations, native revision guards and unchanged numeric/mathematical tokens.
Diagram, layout, executable game and code changes remain explicit generator-change
requests. Storing a suggestion does not mean an unsupported change was implemented.
The reviewer skill explains how an agent picks up these requests, changes the
shared mechanism, tests it and goes through the normal PR/deployment workflow.

Review previews for initial generation capture actual native drawing calls before
Google conversion and real student-player states at desktop and mobile sizes. Feedback verification captures current native Google output.
Both are static evidence; neither claims live animation playback was watched.
Deterministic mathematical/source checks remain mandatory. A model's approval is
additional evidence, not proof of learning quality. All student delivery remains
owner-review gated. No results, mastery, payment or assignment release is written.

A generated booking draft receives at most one automatic creator repair. Review
reports bind the exact candidate, model, review policy, renderer and image evidence.
Unpublished approvals are renewed after renderer/review-policy changes. A sealed
publication retry reuses its exact old files and matching original approval.

## Connection and operations

Use the existing personal Drive connection with restricted drive.file access. It
can access files created by the site; files imported through another OAuth client
are not implicitly granted to the site. The one-time private sample bootstrap
creates a site-managed review candidate without a fake student booking. Verify the
replacement before archiving a previous candidate; preserve existing comments.

Enable Drive, Sheets, Slides and Docs APIs in the website's Cloud project. Runtime
needs the installed Codex CLI and Poppler for bounded Docs PDF previews. Provider
credentials are unchanged; a separate Claude/Grok subscription is not required.

Tutor-only GET /api/learning-feedback exposes status; POST supports tick and the
idempotent bootstrap-sample action. It does not accept a client-supplied validation
or approval. Human control happens through token-bound Sheet actions. Operational
leases/audit are in SQLite; review content and controls remain in personal Drive.

The canonical skill is skills/meabeclick-learning-reviewer/SKILL.md. Runtime policy
is src/lib/learning/deck/review-rules.ts; installing a skill does not schedule jobs.
