import {nativeWorkspace} from '$server/learning-archive.ts';
import {error,redirect} from '@sveltejs/kit';
import {requireAuth} from '$server/auth.ts';
import {documentHeaders} from '$server/document-policy.ts';
import {getPilot,ensurePreviewSession} from '$server/visual-pilot.ts';
import {renderVisualDeck} from '$server/visual-deck-render.ts';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=event=>{
 requireAuth(event);if(nativeWorkspace())redirect(303,'/app/library');const pilot=getPilot();if(!pilot)error(503,'הפיילוט עדיין בהכנה');
 const raw=event.url.searchParams.get('view')??'lesson';if(!['lesson','presenter','homework','game'].includes(raw))error(404,'התצוגה לא נמצאה');
 const view=raw as 'lesson'|'presenter'|'homework'|'game',gameId=event.url.searchParams.get('game')??undefined;
 if(view==='game'&&!pilot.bundle.games.some(g=>g.id===gameId))error(404,'המשחק לא נמצא');
 const id=ensurePreviewSession(event.cookies.get('mea_visual_preview'),pilot.version);
 event.cookies.set('mea_visual_preview',id,{path:'/',httpOnly:true,secure:event.url.protocol==='https:',sameSite:'lax',maxAge:4*60*60});
 return new Response(renderVisualDeck(pilot.bundle,{view,gameId,version:pilot.version}),{headers:{...documentHeaders(),'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
};
