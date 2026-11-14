import {error} from '@sveltejs/kit';
import {requireAuth} from '$server/auth.ts';
import {documentHeaders} from '$server/document-policy.ts';
import {getPilot,ensurePreviewSession} from '$server/visual-pilot.ts';
import {renderVisualDeck} from '$server/visual-deck-render.ts';
import type {RequestHandler} from './$types';
/** Protected review runtime; no assignments, learner scores, or delivery. */
export const GET:RequestHandler=event=>{
 requireAuth(event);
 const pilot=getPilot();if(!pilot)error(503,'חומרי הבדיקה אינם זמינים');
 const raw=event.url.searchParams.get('view')??'game';
 if(!['game','homework'].includes(raw))error(404,'התצוגה לא נמצאה');
 const view=raw as 'game'|'homework',gameId=event.url.searchParams.get('game')??undefined;
 if(view==='game'&&!pilot.bundle.games.some(g=>g.id===gameId))error(404,'המשחק לא נמצא');
 const id=ensurePreviewSession(event.cookies.get('mea_visual_preview'),pilot.version);
 event.cookies.set('mea_visual_preview',id,{path:'/',httpOnly:true,secure:event.url.protocol==='https:',sameSite:'lax',maxAge:4*60*60});
 return new Response(renderVisualDeck(pilot.bundle,{view,gameId,baseUrl:'/app/native-review-activities',version:pilot.version,activitiesOnly:true}),{headers:{...documentHeaders(),'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
};
