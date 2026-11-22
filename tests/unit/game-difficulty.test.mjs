import test from 'node:test';
import assert from 'node:assert/strict';
import {visualDeckFixture} from '../visual-deck-fixture.mjs';

test('a practice game needs ten to twelve rounds with a difficulty of 1-3 that actually varies', async () => {
  const {visualLessonProblems, visualGamesProblems} = await import('../../src/lib/learning/deck/model.ts');
  const ok = visualDeckFixture();
  assert.deepEqual(visualLessonProblems(ok), []);
  const short = visualDeckFixture();
  short.games[0].rounds = short.games[0].rounds.slice(0, 9);
  assert.ok(visualLessonProblems(short).some(x => x.includes('עשר שאלות')));
  const long = visualDeckFixture();
  for (const n of [11, 12, 13]) long.games[0].rounds.push({...structuredClone(long.games[0].rounds[0]), id: 'region-' + n});
  assert.ok(visualLessonProblems(long).length, 'more than twelve rounds is refused');
  const none = visualDeckFixture();
  delete none.games[0].rounds[3].difficulty;
  assert.ok(visualLessonProblems(none).some(x => x.includes('רמת קושי')));
  const out = visualDeckFixture();
  out.games[0].rounds[3].difficulty = 4;
  assert.ok(visualLessonProblems(out).some(x => x.includes('רמת קושי')));
  const flat = visualDeckFixture();
  for (const r of flat.games[0].rounds) r.difficulty = 2;
  assert.ok(visualLessonProblems(flat).some(x => x.includes('להשתנות')));
  const down = visualDeckFixture();
  down.games[0].rounds[0].difficulty = 3;
  assert.ok(visualLessonProblems(down).some(x => x.includes('לעלות')), 'authored rounds must ascend');
  const foreign =visualDeckFixture();
  foreign.games[0].rounds[5].objectiveId = 'other-skill';
  assert.ok(visualLessonProblems(foreign).length, 'difficulty never moves outside the lesson objectives');
  assert.ok(visualGamesProblems([{...ok.games[0], rounds: ok.games[0].rounds.slice(0, 5)}], ok.objectives).length);
});

test('the player serves rounds easiest first and keeps historical order when no level exists', async () => {
  const {renderVisualDeck} = await import('../../src/lib/server/visual-deck-render.ts');
  const b = visualDeckFixture();
  const g = b.games[0];
  g.rounds[0].difficulty = 3;
  g.rounds[9].difficulty = 1;
  const html = renderVisualDeck(b, {view: 'game', gameId: g.id, baseUrl: '/x'});
  const order = [...html.matchAll(/class="game-round" data-round="\d+"[^>]*><article[^>]*data-task="([^"]+)"/g)].map(m => m[1]);
  assert.equal(order.length, 10);
  const level=Object.fromEntries(g.rounds.map(r => [r.id, r.difficulty]));
  assert.deepEqual(order.map(id => level[id]), order.map(id => level[id]).sort(), 'rounds ascend in difficulty');
  assert.notEqual(order[0], g.rounds[0].id, 'the level-3 round moved back');
  const old = visualDeckFixture();
  for (const r of old.games[0].rounds) delete r.difficulty;
  const o = [...renderVisualDeck(old, {view: 'game', gameId: old.games[0].id, baseUrl: '/x'}).matchAll(/data-task="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(o, old.games[0].rounds.map(r => r.id));
});
