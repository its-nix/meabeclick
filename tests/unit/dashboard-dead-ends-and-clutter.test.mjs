import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
test('the student games list has an icon back control to the student home',()=>{
 const s=read('src/routes/app/student/games/+page.svelte');
 assert.match(s,/<a class="back" href="\/app\/student" aria-label="חזרה לדף שלי"/);
 assert.match(s,/border-radius: var\(--radius-pill\)/);
});
test('dashboards no longer show a last-updated line or feed it',()=>{
 const s=read('src/routes/app/student/+page.svelte');
 assert.ok(!s.includes('עודכן לאחרונה'));assert.ok(!/DATA\.updated|updated\?:/.test(s));
 assert.ok(!/updated:\s*israelToday/.test(read('src/lib/server/enroll.ts')));
});
test('the tutor library page drops the "fresh library" explainer block',()=>{
 const s=read('src/lib/components/DriveWorkspace.svelte');
 assert.ok(!s.includes('מתחילים ספרייה חדשה'));assert.ok(!s.includes('fresh-start'));
});
