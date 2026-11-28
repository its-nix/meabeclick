// Only the external author and Google services are simulated. The booking,
// draft register, approval sync and student HTTP session share the test DB.
import assert from 'node:assert/strict';
import { provider, config } from './central-drive-fixture.mjs';
import { visualDeckFixture } from './visual-deck-fixture.mjs';

export async function simulatedReview({ bookingId, studentId, dbPath }) {
  process.env.DB_PATH = dbPath;
  const {
    enqueueNativeLesson, publishNativeReviewBundle, nativeDraftRecords,
    writeNativeGamesFile, syncNativeGameApprovals, workspaceHeader, workspaceTables, workspaceSiteColumns,
  } = await import('../build/server/lesson-release.js');
  const job = enqueueNativeLesson({ bookingId, studentId });
  const bundle = visualDeckFixture();
  const google = provider();
  const workspace = { workspaceId: 'workspace12345', reviewId: 'review12345' };
  for (const [id, parent] of [[workspace.workspaceId, config.learningFolderId], [workspace.reviewId, workspace.workspaceId]]) {
    google.files.set(id, { id, mimeType: 'application/vnd.google-apps.folder', parents: [parent],
      owners: [{ emailAddress: config.ownerEmail }], permissions: [{ type: 'user' }] });
  }
  const receipt = await publishNativeReviewBundle({
    key: 'staging-lesson', bundle, activityBaseUrl: 'https://staging.meabeclick.com/app/native-review-activities',
  }, { access: google.access, workspace, fetch: google.fetch });
  assert.equal(receipt.slides.mimeType, 'application/vnd.google-apps.presentation');
  assert.equal(receipt.homework.mimeType, 'application/vnd.google-apps.document');
  const fileId = 'syntheticGamesFile';
  let text;
  const games = await writeNativeGamesFile({
    async blob(artifact) {
      text = (await artifact.read()).toString();
      return { file: { id: fileId, mimeType: artifact.mimeType } };
    },
  }, receipt.reviewFolderId, bundle, bookingId);
  const records = nativeDraftRecords(job, receipt, 'Synthetic student', undefined, games);
  const material = records.Materials.find(row => row.kind === 'game' && row.audience === 'student');
  const assignment = records.Assignments.find(row => row.material_id === material.material_id);
  const columns = { ...workspaceTables, Materials: [...workspaceTables.Materials, ...workspaceSiteColumns.Materials] };
  const sheet = {
    async read() {
      const grids = Object.fromEntries(Object.entries(columns).map(([table, cols]) => [
        table, [cols.map(workspaceHeader), ...records[table].map(row => cols.map(col => row[col.key] ?? ''))],
      ]));
      return { revision: 'synthetic-review', grids };
    },
    async update(cells) {
      for (const { table, row, column, value } of cells) {
        assert.equal(columns[table][column].key, 'site_status');
        records[table][row - 1].site_status = value;
      }
    },
  };
  const drive = { async read(id) { assert.equal(id, fileId); return { revisionId: '1', text }; } };
  async function sync() {
    const result = await syncNativeGameApprovals({ sheet, drive });
    assert.equal(result.error, undefined);
    assert.deepEqual(result.problems, []);
    return result;
  }
  assert.equal((await sync()).approved, 0);
  return {
    version: games.sha256,
    async approve() {
      Object.assign(material, { review_status: 'approved', publication_status: 'published', release_id: 'synthetic-release' });
      assignment.status = 'assigned';
      assert.equal((await sync()).approved, 1);
      assert.equal(material.site_status, 'approved');
    },
    async withdraw() {
      assignment.status = 'cancelled';
      assert.deepEqual((await sync()).withdrawn, [material.material_id]);
    },
  };
}
