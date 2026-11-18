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
 assert.ok(html.includes('פיילוט חזותי · לבדיקה · ללא ציונים'));assert.ok(html.includes('?view=homework'));assert.ok(html.includes('תצוגת בדיקה'));
});
