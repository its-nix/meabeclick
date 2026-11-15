import {json} from '@sveltejs/kit';
import {apiAuthDenied} from '$server/auth.ts';
import {readJson} from '$server/http.ts';
import {nativeWorkspace} from '$server/learning-archive.ts';
import {listFeedbackArtifacts,listFeedbackReviews,acceptedFeedbackRules} from '$server/learning-feedback/store.ts';
import {learningFeedbackWorker,bootstrapFeedbackSample} from '$server/learning-feedback/worker.ts';
import type {RequestHandler} from './$types';
const headers={'Cache-Control':'private, no-store'};
export const GET:RequestHandler=event=>{
 const denied=apiAuthDenied(event);if(denied)return denied;
 const workspace=nativeWorkspace();return json({enabled:process.env.LEARNING_FEEDBACK_ENABLED==='true',indexUrl:workspace?`https://docs.google.com/spreadsheets/d/${workspace.indexId}/edit`:null,artifacts:listFeedbackArtifacts(),reviews:listFeedbackReviews().map(r=>({id:r.id,fileId:r.fileId,state:r.state,errorCode:r.errorCode,summary:r.proposal?.summary??null})),policy:acceptedFeedbackRules()},{headers});
};
export const POST:RequestHandler=async event=>{
 const denied=apiAuthDenied(event);if(denied)return denied;
 const input=await readJson(event.request);if(input instanceof Response)return input;
 if(!input||typeof input!=='object'||!['tick','bootstrap-sample'].includes((input as any).action))return json({error:'פעולה לא תקינה'},{status:400,headers});
 try{
  const sample=(input as any).action==='bootstrap-sample'?await bootstrapFeedbackSample():null;
  learningFeedbackWorker().queue();return json({queued:true,...(sample?{sample}: {})},{status:202,headers});
 }catch{return json({error:'מרחב ההוראה אינו זמין. יש לבדוק את חיבור Google והרשאות הקבצים.'},{status:409,headers});}
};
