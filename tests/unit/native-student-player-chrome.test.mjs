import {test} from 'node:test';
import assert from 'node:assert/strict';
const {renderVisualDeck}=await import('../../src/lib/server/visual-deck-render.ts');
const {visualDeckFixture}=await import('../visual-deck-fixture.mjs');
const render=o=>renderVisualDeck(visualDeckFixture(),{view:'game',gameId:'axis-game',baseUrl:'/app/student/games',actionUrl:'/api/student-games/1',version:'v',activitiesOnly:true,...o});
test('the student game page has its own minimal chrome and no tutor-review wording or links',()=>{
 const html=render({studentPlayer:true}),bar=html.slice(html.indexOf('<header class="topbar">'),html.indexOf('</header>',html.indexOf('<header class="topbar">')));
 assert.match(bar,/href="\/app\/student\/games"/);
 for(const bad of ['/app/library','פיילוט חזותי','לבדיקה','ללא ציונים','?view=homework','?view=game','?view=presenter','חומרי השיעור']){assert.ok(!html.includes(bad),`student page must not contain ${bad}`);}
 assert.ok(!html.includes('תצוגת בדיקה'));
});
test('the tutor review deck keeps its review chrome',()=>{
 const html=render({activitiesOnly:true});
 assert.ok(html.includes('פיילוט חזותי · לבדיקה · ללא ציונים'));assert.ok(html.includes('?view=homework'));assert.ok(!html.includes('תצוגת בדיקה · התרגול אינו רושם'),'the redundant banner is gone');
});
test('game player copy is trimmed to what a player needs, in every chrome',()=>{
 for(const o of [{studentPlayer:true},{},{publicSample:true}]){
  const html=render(o),visible=html.slice(html.indexOf('<body'),html.indexOf('<script type="application/json"'));
  for(const gone of ['תצוגת בדיקה','התרגול אינו רושם','השלמת המשחק','נרשם כעזרה','משימה משחקית','התשובות נשמרות כתרגול','review-disclaimer'])assert.ok(!visible.includes(gone),`${JSON.stringify(o)} must not contain ${gone}`);
 }
});
test('game rounds have icon buttons for previous, next, hint, solution and check, with Hebrew aria-labels',()=>{
 const html=render({studentPlayer:true});
 for(const [attr,label] of [['data-prev-round','לשאלה הקודמת'],['data-next-round','לשאלה הבאה'],['data-task-action="hint"','רמז'],['data-task-action="solution"','הצגת הפתרון'],['data-task-action="attempt"','בדיקת התשובה']])assert.match(html,new RegExp(`<button[^>]*aria-label="${label}"[^>]*${attr}`),label);
 assert.ok(html.includes('data-prev-round disabled'),'no previous on the first question');
 assert.ok(!/data-task-action="hint">[^<]*[א-ת]/.test(html),'hint is an icon, not text');
 assert.match(html,/aria-label="סיום"[^>]*data-next-round/,'the last question finishes instead of advancing');
 assert.match(html,/class="game-dots"[^>]*aria-label="שאלה 1 מתוך \d+"/);
});
test('the student player back link is an icon with an accessible name',()=>{
 const html=render({studentPlayer:true});assert.match(html,/<a class="icon-btn top-back" href="\/app\/student\/games" aria-label="חזרה למשחקים"/);assert.ok(!html.includes('חזרה למשחקים ←'));
});
