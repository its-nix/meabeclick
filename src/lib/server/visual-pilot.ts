import {randomUUID,createHash} from 'node:crypto';
import corpus from './learning-pilot-corpus.json' with {type:'json'};
import {gradeDeckTask,visualLessonProblems,type DeckTask,type VisualLesson} from '../learning/deck/model.ts';
import {officialQuestion} from './lesson/official-questions.ts';

const sessions=new Map<string,{version:string;expires:number;tasks:Map<string,{attempts:number;hints:number;revealed:boolean}>;events:Map<string,Record<string,unknown>>}>();
const TTL=4*60*60*1000;
export function createPreviewSession(version:string,now=Date.now()):string{
 for(const [id,s]of sessions)if(s.expires<now)sessions.delete(id);
 while(sessions.size>=200)sessions.delete(sessions.keys().next().value!);
 const id=randomUUID();sessions.set(id,{version,expires:now+TTL,tasks:new Map(),events:new Map()});return id;
}
export function ensurePreviewSession(id:string|undefined,version:string,now=Date.now()):string{
 const s=id?sessions.get(id):null;return s&&s.version===version&&s.expires>=now?id!:createPreviewSession(version,now);
}
/** Ephemeral tutor preview only: no customer records, score writes or mastery claims. */
export function previewAction(id:string,version:string,task:DeckTask,action:string,input:unknown,eventId:string,now=Date.now()):Record<string,unknown>{
 const session=sessions.get(id);if(!session||session.expires<now||session.version!==version)throw Error('stale preview');
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(eventId))throw Error('invalid event');
 if(!['attempt','hint','solution'].includes(action))throw Error('invalid action');
 const eventKey=task.id+':'+eventId;
 if(session.events.has(eventKey))return session.events.get(eventKey)!;
 if(session.events.size>=512)throw Error('preview limit; reload');
 const state=session.tasks.get(task.id)??{attempts:0,hints:0,revealed:false};
 let result:Record<string,unknown>;
 if(action==='attempt'){
  if(task.grading==='tutor-review'&&(typeof input!=='string'||!input.trim()||input.length>2000))throw Error('invalid explanation');
  if(task.check?.kind==='region'&&(!Array.isArray(input)||input.length!==2||!input.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=4)||input[0]>=input[1]))throw Error('invalid region');
  if(task.check?.kind!=='region'&&task.grading!=='tutor-review'&&(!['string','number'].includes(typeof input)||String(input).length>80))throw Error('invalid answer');
  state.attempts++;
  const correct=gradeDeckTask(task,input);
  result={correct,independent:correct&&state.attempts===1&&state.hints===0&&!state.revealed&&task.support==='independent',message:task.grading==='tutor-review'?'ההסבר מיועד לבדיקה עם המורה.':correct?task.success:task.retry,attempts:state.attempts};
 }else{
  if(!state.attempts)throw Error('attempt required');
  if(action==='hint'){const at=Math.min(state.hints,task.hints.length-1);state.hints++;result={message:task.hints[at],assisted:true};}
  else{state.revealed=true;result={message:task.solution,assisted:true};}
 }
 session.tasks.set(task.id,state);session.events.set(eventKey,result);return result;
}
let checked:ReturnType<typeof getPilot>|undefined;
export function getPilot():{bundle:VisualLesson;version:string}|null{
 if(checked!==undefined)return checked;
 const data=corpus as unknown as {manifest:{status:string;bundleSha256?:string};bundle:VisualLesson|null};
 if(data.manifest.status!=='ready'||!data.bundle)return checked=null;
 const version=createHash('sha256').update(JSON.stringify(data.bundle,null,2)+'\n').digest('hex');
 if(version!==data.manifest.bundleSha256)throw Error('pilot checksum mismatch');
 const sourceAnswers=Object.fromEntries([...new Set(data.bundle.sourceSolutions.map(s=>s.questionId))].map(id=>[id,officialQuestion(id)?.answers??{}]));
 const problems=visualLessonProblems(data.bundle,{sourceAnswers});if(problems.length)throw Error('invalid pilot: '+problems.join('; '));
 return checked={bundle:data.bundle,version};
}
