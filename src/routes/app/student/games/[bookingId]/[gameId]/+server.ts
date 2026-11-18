import {error,redirect} from '@sveltejs/kit';
import {documentHeaders} from '$server/document-policy.ts';
import {renderVisualDeck} from '$server/visual-deck-render.ts';
import {sessionStudent} from '$server/native-learning/student-session.ts';
import {approvedGameBundle} from '$server/native-learning/games.ts';
import type {RequestHandler} from './$types';

/** The existing visual-deck game player, fed the approved copy for the signed-in student; grading happens on the server. */
export const GET:RequestHandler=({locals,params,url})=>{
 const student=sessionStudent(locals.family);
 if(!student)redirect(302,'/portal');
 const bookingId=Number(params.bookingId);
 if(!Number.isInteger(bookingId))error(404,'המשחק לא נמצא');
 const approved=approvedGameBundle(student.id,bookingId,params.gameId);
 if(!approved)error(404,'המשחק לא נמצא');
 const html=renderVisualDeck(approved.bundle,{view:'game',gameId:params.gameId,baseUrl:'/app/student/games',actionUrl:`/api/student-games/${bookingId}`,version:approved.version,activitiesOnly:true,studentPlayer:true});
 return new Response(html,{headers:{...documentHeaders(),'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}});
};
