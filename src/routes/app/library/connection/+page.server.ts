import {fail,redirect,error} from '@sveltejs/kit';
import {requireAuth,COOKIE_NAME} from '$server/auth.ts';
import {learningGoogleConfig,learningService,learningFiles,LEARNING_FLOW_COOKIE,LEARNING_GOOGLE_ERRORS} from '$server/learning-google.ts';
import type {Actions,PageServerLoad} from './$types';

export const load:PageServerLoad=event=>{
 requireAuth(event);
 event.setHeaders({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'});
 const reason=event.url.searchParams.get('connectionError')??'';
 let config:ReturnType<typeof learningGoogleConfig>;
 try{config=learningGoogleConfig();}catch{return {configured:false,account:null,files:[],status:null,message:LEARNING_GOOGLE_ERRORS.setup};}
 let status:ReturnType<ReturnType<typeof learningService>['status']>|null=null,message=LEARNING_GOOGLE_ERRORS[reason]??null;
 try{status=learningService().status();}catch{message=LEARNING_GOOGLE_ERRORS.storage;}
 return {configured:true,account:config.workspace.ownerEmail,files:learningFiles(config.workspace).map(f=>({id:f.id,name:f.name})),status,message};
};

export const actions:Actions={
 connect:async event=>{
  requireAuth(event);
  if(event.request.headers.get('origin')!==event.url.origin)error(403,'origin');
  let started:ReturnType<ReturnType<typeof learningService>['start']>;
  try{started=learningService().start(event.cookies.get(COOKIE_NAME)??'');}
  catch(e){const reason=e instanceof Error&&e.message==='busy'?'busy':'setup';return fail(reason==='busy'?429:503,{message:LEARNING_GOOGLE_ERRORS[reason]});}
  event.cookies.set(LEARNING_FLOW_COOKIE,started.browser,{path:'/auth/google',httpOnly:true,sameSite:'lax',secure:event.url.protocol==='https:',maxAge:600});
  redirect(303,started.url);
 },
 verify:async event=>{
  requireAuth(event);
  if(event.request.headers.get('origin')!==event.url.origin)error(403,'origin');
  try{await learningService().verify();}
  catch(e){return fail(503,{message:LEARNING_GOOGLE_ERRORS[e instanceof Error?e.message:'']??LEARNING_GOOGLE_ERRORS.google});}
  redirect(303,'/app/library/connection');
 },
};
