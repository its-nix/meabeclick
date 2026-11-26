# Content machine

## Daily calendar

The daily rollout uses the `Daily Calendar` and `Content` tabs. `Daily Calendar`
shows the rolling month of concepts and any Buffer gaps in the next seven days.
The worker prepares posts for Monday through Sunday after the recurring Sunday review.
An `unfilled` date still needs a concept. A `planned` date has an assigned
concept. A `queued` date has a release in the workflow. The separate Buffer
column shows `Verified` once the worker has matching receipts from every
connected channel, or `Gap` while coverage is incomplete.
When it uses up all ideas from a successful refill, it generates more on the next
poll. While idea stock is below one month, a productive refill is followed by
another after an hour if stock is still low. A failed or empty refill waits two
hours. Spare stock refills at most daily once the monthly floor is met.
It gives open dates in that review batch first choice of new concepts, then fills
the rest of the calendar in date order. It releases unused ideas reserved for dates
that have already missed their review window. If it runs out of unassigned
ideas, it can pull an unused idea from a later date to fill the upcoming batch.
Rendered and queued videos retain their dates.
`Content` shows each reviewable video's exact Drive link and one approval
checkbox across the connected channels. The `Review Log` shows how many videos
are ready for each week and has an owner field for actual review minutes.
Videos held by automated checks do not count toward that total. If a policy refresh
is held, the calendar can assign a different concept to that slot. A correction
that passes review stays in the original weekly batch and needs fresh approval.

New videos apply current matching feedback rules before review and record them in the frozen version. The worker adds original music after the isolated render when the guidance calls for it. The approval row then asks for a listening check.

Educational posts and invitations to participate use the same exact approval
and delivery checks. Booking, acquisition, and waitlist posts also check current
tutoring capacity and applicable booking details.

Only exact approvals can reach Buffer. Before each submission, the worker reads
current owner decisions and feedback and revalidates the exact release being sent.
It requires a matching saved
post and a fresh provider readback before marking a channel scheduled. It checks
the outcome after the due time. This allows terminal rows to move into Content
History while the ledger retains their exact approval and provider receipt.

The worker skips Buffer calls when it has no upcoming approval or due delivery
or saved submission to check. If Buffer created a post and initial readback
failed, the worker checks the saved post ID without creating it again. A missing
or mismatched create response holds scheduling for reconciliation. An exhausted
provider limit sets a retry time in
`state/buffer-read-cooldown.json`. During the cooldown it continues planning,
rendering and syncing review material. The daily calendar displays the missing
Buffer slots. An expired unchecked or unsent approval cannot schedule a new
date on its own.


Updated2026-11-16. The VPS Docker worker runs under `meabeclick`, independently of the website. Instagram and the connected Facebook Page are verified through Buffer. Review is content-centric: one visible row and approval per exact video, with per-channel delivery records kept behind the scenes. Paid advertising and purchases are not enabled.

## Your part

Open `MeaBeclick / Marketing / Content library / Review → Content`. Review each video, caption and time. For videos with audio, tick **Listened ✓**. Tick **Approve ✓** once per video to authorize its exact version for scheduling. The worker automatically discovers the connected Instagram professional accounts and Facebook Pages in the existing Buffer organization. New versions start unchecked. Daily posts use 19:30 Israel time.

Write changes naturally in the feedback column. No classification, chat thread, worker questions or clarification inbox is required. The worker interprets ordinary ambiguity conservatively, fixes supported requests and records unresolved cases as Held. It never manufactures approval.

## What happens to feedback

A deterministic process reads the Sheet every900seconds after the prior tick finishes. New or edited feedback creates a durable job tied to the exact video and comment digest. Unchanged comments do not invoke an agent. A fresh check also runs immediately before each channel submission. Feedback holds all unsubmitted copies of the same video, including an approved sibling channel.

The worker interprets the comment, applies supported source/caption changes, renders an immutable child, verifies technical properties and asks two independent encoded-output critics to review it. At most two correction rounds are allowed. Clear reusable preferences are saved with video-only, format or global scope. One extra text-only review of newly completed feedback considers recurring preferences across clips. Its input history is fingerprinted; unchanged history costs no new scope-agent call.

The current learned preferences cover centering, light original background music and removing the business-name sign-off from written captions. Visual product branding remains. Rules retain their source feedback, scope and supersession history. Generation and critics receive the applicable snapshot. Changed relevant rules invalidate old readiness and cause autonomous refresh jobs for pending videos; provenance-only duplicates do not create endless repairs.

## Where you see results

- **Status**: Pending, Fixing, Syncing, Fixed or Held. After approval it can show Approved, Scheduled or Needs reconciliation.
- **Platform results**: each destination’s scheduling state, what changed, and the feedback result. Partial scheduling stays visible until all destinations are confirmed. The hidden Releases tab retains account-bound delivery IDs and receipts.
- **Learnings** tab: reusable rules and scope.
- `Workflow / Rules.md`: the same persistent creative guidance. Its authoritative data also lives in the dedicated repository KB directory `mea-beclick-kb/content-machine-learning/` on the VPS; this directory alone is writable in the worker.

Fixed requires verified output, exact current-feedback checks, stable Drive update/readback, fresh review rows and persisted guidance. Scheduled means Buffer accepted that exact channel schedule; it is not a claim of measured campaign performance or later publication retrieval.

## Video identity, revisions and approval

`Posts / date / concept / Video.mp4` uses one stable Drive file per work item. Updated draft bytes become pinned binary revisions. The canonical file IDs remain stable; the backend binds owner approval to the actual revision, media, caption and time. Internal delivery approvals additionally bind each channel/account. A changed revision cannot inherit approval, even if its bytes match.

Original feedback and checkbox cells are retained in retired hidden rows and a native History copy; replacements are appended rather than overwriting owner input. Partial/uncertain replacements hold preparation and publishing until reconciled. To revert, the agent withdraws unsubmitted review references, promotes verified frozen older bytes into a new head, reruns verification and creates unchecked review. Submitted items require provider reconciliation first. Restore never restores approval. Never delete an uncertain write intent to force a retry.

## Verification and sound

Evidence includes every original frame in motion sheets, native-resolution5fps pairs and original endpoints. These are ordered still sequences, not continuous playback. Reports bind actual bytes, public brief/rules, policy, evidence hashes and separate reviewer sessions. Earlier calibration rejected known shadow/dot and count/highlight defects. Passing models can still miss defects; owner editorial approval remains final.

Music is reproducible original procedural instrumental audio. Its source, regenerated PCM, encoded AAC identity, loudness/peak limits and full decode are checked. No machine-listening claim is made. Human listening remains required. Arbitrary audio/narration without the supported evidence path remains blocked.

After exact approval, only approved media becomes available at a stable public HTTPS URL. The worker persists a single submission intent, calls Buffer and verifies/stores the receipt. It can recover a saved create response through a fresh read of the same post. The Sheet is updated with confirmed scheduling status. Buffer performs publication.

## Operation and limits

The worker uses a read-only image, private persistent SQLite/evidence/intent state, bounded CPU/memory, isolated reviewer authorization, and no host Docker socket or site database access. Active ticks refresh a heartbeat every30seconds. Read private `health.json` for actual blockers; container health alone does not prove posting readiness.

Core modules: `feedback.py`, `feedback_workflow.py`, `feedback_repair.py`, `feedback_learning.py`, `creative_verification.py`, `preparation.py`, `factory.py`, `google_sync.py`, `content_review.py`, `drive_assets.py`, `drive_versions.py`, `buffer_scheduler.py`. Build only with `vps/build-context.py`. Unsupported edits or uncertain operations hold rather than silently weaken verification. The first owner-approved Facebook submissions are confirmed in Buffer. New templates, arbitrary audio and automatic publication/metric retrieval remain separate acceptance work; no full marketing-learning roadmap completion is implied.

Content review controls are deterministic. Completed historical feedback is mapped without replaying old comments; new comments fan out to all copies and use the existing bounded repair/learning loop. The worker re-reads the content decision before each submission. Unchecking stops remaining deliveries; it does not cancel a post already accepted by Buffer. A missing previously registered review row holds scheduling instead of recreating approval. Posting limits count distinct content, not platform copies.
