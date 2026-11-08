import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialCoverage } from '../../src/lib/report-coverage.ts';

const material = { slug:'synthetic-one', materialId:1, version:2, hash:'hash', title:'שברים', sceneIds:['intro','practice'], topics:[{id:'compare',title:'השוואת שברים',sceneIds:['intro'],skillKeys:['fractions.compare']}] };

test('one material is preselected with no covered topics or comments', () => {
  const state = initialCoverage([material], null);
  assert.equal(state.selection, 'material:synthetic-one');
  assert.deepEqual(state.topics, [{...material.topics[0],covered:false,comment:null}]);
});

test('a correction preserves the filed snapshot and choices even after material replacement', () => {
  const latest = {revision:3,source:'material',snapshot:material,topics:[{...material.topics[0],covered:true,comment:'נדרש עוד תרגול'}]};
  const state = initialCoverage([{...material,version:9,topics:[]}], latest);
  assert.equal(state.selection, 'filed');
  assert.equal(state.material.version, 2);
  assert.deepEqual(state.topics, latest.topics);
  state.topics[0].sceneIds.push('practice');
  assert.deepEqual(latest.topics[0].sceneIds, ['intro'], 'editing must not mutate loader data');
});

test('multiple materials require a deliberate source choice; no material allows explicit empty manual coverage', () => {
  assert.equal(initialCoverage([material,{...material,slug:'other'}],null).selection,'');
  assert.deepEqual(initialCoverage([],null),{selection:'manual',material:null,topics:[]});
  const manual={revision:2,source:'manual',snapshot:null,topics:[{id:'manual-1',title:'חזרה',sceneIds:[],skillKeys:[],covered:false,comment:null}]};
  assert.deepEqual(initialCoverage([material],manual),{selection:'manual',material:null,topics:manual.topics});
});

test('the report loader exposes explicit materials and the latest revision only for reportable lessons', async () => {
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.server.ts',import.meta.url),'utf8');
  const reportable=source.slice(source.indexOf('reportable: true'));
  assert.match(reportable,/reportMaterials: eligibleReportMaterials\(booking.id\)/);
  assert.match(reportable,/topicReport: latestTopicReport\(booking.id\)/);
});

test('coverage confirmation, legacy unknown mode and revision guards are part of the form', async () => {
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.svelte',import.meta.url),'utf8');
  assert.match(source,/expectedRevision:/);
  assert.match(source,/coverageConfirmed/);
  assert.match(source,/כיסוי לא ידוע/);
  assert.match(source,/הבנה.*לא חובה/);
  assert.match(source,/maxlength="2000"/);
  assert.match(source,/coverage:.*legacy/s);
});

test('manifest titles are submitted unchanged; only tutor-authored titles are trimmed', async () => {
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.svelte',import.meta.url),'utf8');
  assert.doesNotMatch(source,/title: topic\.title\.trim\(\)/,'an exact material manifest must preserve its original title');
});

test('tutor correction history exposes the source and the full prior checklist', async () => {
  const {readFileSync}=await import('node:fs');
  const server=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.server.ts',import.meta.url),'utf8');
  const page=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.svelte',import.meta.url),'utf8');
  assert.match(server,/topicHistory: topicReportHistory\(booking.id\)/);
  assert.match(page,/data\.topicHistory/);
  assert.match(page,/היסטוריית דיווח/);
  assert.match(page,/topic\.covered \? 'נלמד' : 'לא נלמד'/);
});

test('scene links open the exact filed material version', async () => {
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.svelte',import.meta.url),'utf8');
  assert.match(source,/\/app\/report\/\$\{data.booking.id\}\/material\?materialId=\$\{coverage.material.materialId\}/);
  assert.doesNotMatch(source,/קישורי השלבים פותחים את המצגת הנוכחית/);
});

test('the revision guard covers legacy filings as well as explicit topic filings', async () => {
  const {readFileSync}=await import('node:fs');
  const source=readFileSync(new URL('../../src/routes/app/report/[booking]/+page.svelte',import.meta.url),'utf8');
  assert.match(source,/expectedRevision: data\.reportable \? data\.report\?\.filing_revision \?\? 0 : 0/);
});
