import {json} from '@sveltejs/kit';
import {authorizedCronRequest} from '$server/cron-auth.ts';
import {queueCentralSync,centralLearningSync,SYNC_ERRORS} from '$server/central-drive/sync.ts';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=({request})=>{
 if(!authorizedCronRequest(request.headers.get('x-cron-key')))return json({error:'unauthorized'},{status:401});
 // Work continues in the single app process; the timer never owns a long HTTP request.
 const state=queueCentralSync();return json({phase:state.phase,enabled:state.enabled,done:state.done,total:state.total,error:state.error??null});
};
/** One-time operator migration; ordinary tutor sessions cannot activate it. */
export const POST:RequestHandler=({request})=>{
 if(!authorizedCronRequest(request.headers.get('x-cron-key')))return json({error:'unauthorized'},{status:401});
 try{const s=centralLearningSync().archive();return json({phase:s.phase,done:s.done,total:s.total,error:s.error??null},{status:202});}
 catch(e){const code=e instanceof Error&&SYNC_ERRORS[e.message]?e.message:'google';return json({error:code,message:SYNC_ERRORS[code]},{status:503});}
};
