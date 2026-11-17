import {documentHeaders} from '$server/document-policy.ts';
import {renderVisualDeck} from '$server/visual-deck-render.ts';
import {sampleBundle,ensureSampleSession,SAMPLE_GAME_ID,SAMPLE_VERSION} from '$server/native-learning/public-sample.ts';
import type {RequestHandler} from './$types';

/** Public sample quiz for the landing page: seeded content only, no login, no student data. */
export const GET:RequestHandler=({cookies,url})=>{
 const id=ensureSampleSession(cookies.get('mea_sample_game'));
 cookies.set('mea_sample_game',id,{path:'/',httpOnly:true,secure:url.protocol==='https:',sameSite:'lax',maxAge:60*60});
 const html=renderVisualDeck(sampleBundle(),{view:'game',gameId:SAMPLE_GAME_ID,baseUrl:'/sample-game',actionUrl:'/api/sample-game',version:SAMPLE_VERSION,activitiesOnly:true});
 return new Response(html,{headers:{...documentHeaders(),'Cache-Control':'private, no-store'}});
};
