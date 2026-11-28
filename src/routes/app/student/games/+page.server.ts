import {redirect} from '@sveltejs/kit';
import {resolveFamilyAccess} from '$server/family.ts';
import {sessionStudent} from '$server/native-learning/student-session.ts';
import {approvedGameLessonsForStudent} from '$server/native-learning/games.ts';
import type {PageServerLoad} from './$types';

/** Approved games only, answers stripped by the same boundary as the lesson player. */
export const load:PageServerLoad=({locals,setHeaders})=>{
 const student=sessionStudent(locals.family);
 if(!student)redirect(302,'/portal');
 const access=locals.family?resolveFamilyAccess(locals.family):null;
 setHeaders({'Cache-Control':'private, no-store'});
 return {code:student.code,isSelf:Boolean(access?.isSelf),name:student.name,lessons:approvedGameLessonsForStudent(student.id).map(l=>({bookingId:l.bookingId,games:l.games.map(g=>({id:g.id,title:g.title,intro:g.intro,kind:g.kind,rounds:g.rounds.length}))}))};
};
