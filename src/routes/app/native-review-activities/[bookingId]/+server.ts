import{error}from'@sveltejs/kit';
import{requireAuth}from'$server/auth.ts';
import{documentHeaders}from'$server/document-policy.ts';
import{ensurePreviewSession}from'$server/visual-pilot.ts';
import{renderVisualDeck}from'$server/visual-deck-render.ts';
import{nativeBookingActivities}from'$server/native-learning/activities.ts';
import type{RequestHandler}from'./$types';
export const GET:RequestHandler=event=>{
 requireAuth(event);const id=Number(event.params.bookingId),source=nativeBookingActivities(id);
 if(!source)error(404,'חומרי השיעור אינם זמינים');
 const view=event.url.searchParams.get('view')??'game',gameId=event.url.searchParams.get('game')??undefined;
 if(!['game','homework'].includes(view)||view==='game'&&!source.bundle.games.some(g=>g.id===gameId))error(404,'הפעילות לא נמצאה');
 const session=ensurePreviewSession(event.cookies.get('mea_visual_preview'),source.version);
 event.cookies.set('mea_visual_preview',session,{path:'/',httpOnly:true,secure:event.url.protocol==='https:',sameSite:'lax',maxAge:14400});
 return new Response(renderVisualDeck(source.bundle,{view:view as 'game'|'homework',gameId,baseUrl:`/app/native-review-activities/${id}`,actionUrl:`/api/native-activities/${id}`,version:source.version,activitiesOnly:true}),{headers:{...documentHeaders(),'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
};
