# Archive the old library and start a native Google workspace

The owner explicitly approved archiving the old generated material and starting
fresh, rather than converting the rejected lessons into the new active library.
All educational originals must reach the connected personal account before any
entry is retired. Student progress, teaching observations, bookings, assignments
and historical lesson URLs remain valid. No public sharing or messages are added.

## Cutover

Use the existing global connection and serialized snapshot worker. A completed
snapshot must include every source key, SHA-256, size, source format and verified
Drive file ID in the native index. The archive operation takes a fresh inventory,
reuses/verifies every uploaded object, writes a dated native archive register and
only then atomically records which lesson slugs were retired. A partial upload,
changed source, pause, permission failure or interrupted run cannot retire data.
Retries are idempotent. Keep source bytes for historical readers and recovery;
removing an entry from the active catalog is not deleting a customer's history.

The archive is a dated folder under the selected Learning area. The current
Website sync subtree remains an ongoing recovery mirror, including editable
student profiles and observed progress. Archive snapshots are separate from the
automatically refreshed index. Existing human folders/templates are untouched.
New active folders use app-created descendants of the selected root, compatible
with drive.file without acquiring broad access to the user's other files.

After cutover, library masters in the retired set cannot be reused, selected,
imported or prepared through the old workflow. General tutor lesson lists omit
the retired material. Historical per-student records, direct readers, teacher
edits, homework and game submissions remain available. The old review galleries
redirect tutors to the workspace, while their originals remain in the archive.

## Native workspace

The website library becomes a small branded hub linking the native library,
student records, templates, review and archive. Google Slides is the presentation
format; Google Docs is the teaching-document format; Google Sheets tracks the
relationships. Interactive exercises keep their existing runtime and evidence
capture. Private presenter notes and solutions are staff-only material. Draft
native files are not automatically published or shared with students.

This change must be honest about authoring readiness. Existing legacy HTML must
not be relabelled as native Slides or regenerated immediately after retirement.
The rejected corpus is an archive, not teaching approval. Future native authoring
must use the brand, mathematical conventions and review gates already agreed;
it is not satisfied by uploading HTML under a Slides filename.

## Verification

Exercise a failed archive, changed inventory, repeated archive, new content after
cutover, rejected legacy reuse/preparation, retained historical readers and
unchanged progress. Verify native MIME types, personal ownership, parents,
staff-only permissions and complete archive readback on real Google. Build,
typecheck, focused integration/browser checks and the supported Linux Node 22
suite must pass before release. Keep a bounded independent review and rollback
record. Production activation follows a successful real backfill, never a mock.
