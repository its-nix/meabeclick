import {test} from 'node:test';import assert from 'node:assert/strict';
import {renderVisualDeck} from '../../src/lib/server/visual-deck-render.ts';
import * as S from '../../src/lib/server/native-learning/public-sample.ts';
const html=renderVisualDeck(S.sampleBundle(),{view:'game',gameId:S.SAMPLE_GAME_ID,baseUrl:'/sample-game',actionUrl:'/api/sample-game',version:S.SAMPLE_VERSION,activitiesOnly:true,publicSample:true});
test('game player ships feedback motion, a star summary and unchanged live region',()=>{
 for(const c of ['flash-ok','flash-no','shake','win-badge','in-next','in-prev','stroke-dashoffset','star-in','dot-pop'])assert.ok(html.includes(c),c);
 assert.match(html,/data-task-feedback role="status" aria-live="polite"/);
 assert.equal((html.match(/<div class="stars" aria-hidden="true">/g)||[]).length,1);assert.match(html,/data-count-first/);assert.match(html,/data-count-assist/);
 assert.match(html,/in-next\{from\{opacity:0;transform:translateX\(-28px\)/,'RTL: next enters from the left');
});
test('reduced motion removes all animation and confetti is gated on it',()=>{
 assert.match(html,/prefers-reduced-motion:reduce\)\{\*,\*::before,\*::after\{animation:none!important;transition:none!important/);
 assert.match(html,/if\(!motion\)return;const dpr/);assert.match(html,/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
 assert.doesNotMatch((html.match(/@keyframes [\w-]+\{(?:[^{}]*\{[^{}]*\})+\}/g)||[]).join(''),/(width|height|top|left|margin)\s*:/,'keyframes animate no layout properties');
});
