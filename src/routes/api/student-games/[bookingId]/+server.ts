import {json} from '@sveltejs/kit';
import {sessionStudent} from '$server/native-learning/student-session.ts';
import {studentGameAction,StudentGameError} from '$server/native-learning/student-games.ts';
import type {RequestHandler} from './$types';

/** Student and booking come from the session and the URL path checked against the student's approved copy; the body carries only the answer. */
export const POST:RequestHandler=async({locals,params,request})=>{
 const headers={'Cache-Control':'private, no-store'};
 const student=sessionStudent(locals.family);
 if(!student)return json({error:'נדרשת התחברות'},{status:401,headers});
 const bookingId=Number(params.bookingId);
 if(!Number.isInteger(bookingId))return json({error:'המשחק לא נמצא'},{status:404,headers});
 let body:unknown;try{const raw=await request.text();if(raw.length>12000)throw Error();body=JSON.parse(raw);}catch{return json({error:'בקשה לא תקינה'},{status:400,headers});}
 try{return json(studentGameAction({studentId:student.id,bookingId},body),{headers});}
 catch(e){if(e instanceof StudentGameError)return json({error:e.message},{status:e.status,headers});throw e;}
};
