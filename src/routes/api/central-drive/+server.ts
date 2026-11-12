import {json,error} from '@sveltejs/kit';
import {requireAuth} from '$server/auth.ts';
import {centralLearningSync,SYNC_ERRORS} from '$server/central-drive/sync.ts';
import type {RequestHandler} from './$types';

export const GET:RequestHandler=event=>{
 requireAuth(event);event.setHeaders({'Cache-Control':'private, no-store'});
 return json(centralLearningSync().view());
};
export const POST:RequestHandler=async event=>{
 requireAuth(event);
 if(event.request.headers.get('origin')!==event.url.origin)error(403,'origin');
 event.setHeaders({'Cache-Control':'private, no-store'});
 let action:unknown;try{action=(await event.request.json()).action;}catch{error(400,'action');}
 if(!['sync','pause','resume'].includes(String(action)))error(400,'action');
 try{
  const sync=centralLearningSync();return json(action==='sync'?sync.queue():await sync.setEnabled(action==='resume'));
 }catch(e){const reason=e instanceof Error&&SYNC_ERRORS[e.message]?e.message:'google';return json({message:SYNC_ERRORS[reason]},{status:503});}
};
