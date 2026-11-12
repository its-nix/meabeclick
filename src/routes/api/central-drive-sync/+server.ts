import {json} from '@sveltejs/kit';
import {authorizedCronRequest} from '$server/cron-auth.ts';
import {queueCentralSync} from '$server/central-drive/sync.ts';
import type {RequestHandler} from './$types';
export const GET:RequestHandler=({request})=>{
 if(!authorizedCronRequest(request.headers.get('x-cron-key')))return json({error:'unauthorized'},{status:401});
 // Work continues in the single app process; the timer never owns a long HTTP request.
 const state=queueCentralSync();return json({phase:state.phase,enabled:state.enabled,done:state.done,total:state.total,error:state.error??null});
};
