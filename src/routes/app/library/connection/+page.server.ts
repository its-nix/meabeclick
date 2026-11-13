import {fail,redirect,error} from '@sveltejs/kit';
import {requireAuth,COOKIE_NAME} from '$server/auth.ts';
import {learningGoogleConfig,learningService,learningFiles,LEARNING_FLOW_COOKIE,LEARNING_GOOGLE_ERRORS} from '$server/learning-google.ts';
import {centralLearningSync} from '$server/central-drive/sync.ts';
import type {Actions,PageServerLoad} from './$types';

export const load:PageServerLoad=event=>{
 requireAuth(event);
 // no-referrer makes native same-origin POSTs send Origin:null in Chromium.
 event.setHeaders({'Cache-Control':'private, no-store','Referrer-Policy':'same-origin'});
 const reason=event.url.searchParams.get('connectionError')??'';
 let config:ReturnType<typeof learningGoogleConfig>;
 try{config=learningGoogleConfig();}catch{return {configured:false,account:null,files:[],status:null,sync:centralLearningSync().view(),apiSetupUrl:null,message:LEARNING_GOOGLE_ERRORS.setup};}
 let status:ReturnType<ReturnType<typeof learningService>['status']>|null=null,message=LEARNING_GOOGLE_ERRORS[reason]??null;
 try{status=learningService().status();}catch{message=LEARNING_GOOGLE_ERRORS.storage;}
 const project=config.clientId.match(/^(\d+)-/)?.[1];
 const apiSetupUrl=reason==='api_setup'&&project?`https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${project}`:null;
 return {configured:true,account:config.workspace.ownerEmail,files:learningFiles(config.workspace).filter(f=>f.id===config.workspace.learningFolderId).map(f=>({id:f.id,name:f.name})),status,sync:centralLearningSync().view(),apiSetupUrl,message};
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
