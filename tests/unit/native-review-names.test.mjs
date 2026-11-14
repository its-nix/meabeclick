import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativeReviewNames} from '../../src/lib/server/native-learning/names.ts';

test('phone-friendly review names sort by Israel creation time and distinguish animation',()=>{
 const names=nativeReviewNames('מהציונים לעקומה: היכרות עם התפלגות נורמלית',true,new Date('2026-11-14T17:26:33Z'));
 assert.equal(names.folder,'2026-11-14 192633 · התפלגות נורמלית · אנימציות');
 assert.equal(names.slides,'01 מצגת · התפלגות נורמלית · אנימציות');
 assert.equal(names.homework,'02 שיעורי בית · התפלגות נורמלית');
 const next=nativeReviewNames('אלגברה',false,new Date('2026-11-14T22:01:00Z'));
 assert.equal(next.folder,'2026-11-15 000100 · אלגברה · טיוטה');
 assert.ok(names.folder<next.folder);
});

test('long and empty titles stay bounded and bidi controls cannot hide the prefix',()=>{
 const at=new Date('2026-07-01T00:00:00Z');
 const names=nativeReviewNames('\u202e'+ '😀'.repeat(80)+'\n',false,at);
 assert.equal(names.folder,`2026-07-01 030000 · ${'😀'.repeat(24)} · טיוטה`);
 assert.match(nativeReviewNames('  ',false,at).folder,/ · שיעור · טיוטה$/);
});
