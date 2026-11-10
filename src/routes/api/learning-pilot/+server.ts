import {json} from '@sveltejs/kit';
import {apiAuthDenied} from '$server/auth.ts';
import {getPilot,previewAction} from '$server/visual-pilot.ts';
import type {RequestHandler} from './$types';
export const POST:RequestHandler=async event=>{
 const denied=apiAuthDenied(event);if(denied)return denied;
 const headers={'Cache-Control':'private, no-store'};
 const pilot=getPilot();if(!pilot)return json({error:'הפיילוט עדיין בהכנה'},{status:503,headers});
 let data;try{const raw=await event.request.text();if(raw.length>12000)throw Error();data=JSON.parse(raw);}catch{return json({error:'בקשה לא תקינה'},{status:400,headers});}
 if(!data||typeof data!=='object'||data.version!==pilot.version)return json({error:'הגרסה התחלפה. פתחו מחדש את התרגול.'},{status:409,headers});
 const task=[...pilot.bundle.tasks,...pilot.bundle.homework,...pilot.bundle.games.flatMap(g=>g.rounds)].find(t=>t.id===data.taskId);
 if(!task)return json({error:'המשימה לא נמצאה'},{status:404,headers});
 try{return json(previewAction(event.cookies.get('mea_visual_preview')??'',pilot.version,task,data.action,data.input,data.eventId),{headers});}
 catch(e){const message=e instanceof Error?e.message:'';return json({error:/attempt/.test(message)?'נסו קודם בעצמכם, ואז אפשר לבקש עזרה.':/stale|limit/.test(message)?'תצוגת הבדיקה התחדשה. טענו את הדף מחדש.':'בדקו את התשובה והגבולות שהקלדתם.'},{status:/stale|limit|attempt/.test(message)?409:400,headers});}
};
