import {actionInStore,type PreviewStore} from '../visual-pilot.ts';
import {approvedGameBundle} from './games.ts';
import {recordNativeResult} from './results.ts';

/** Server-held attempt state per approved student, game copy and task. The browser holds no counters and no answers. */
const store:PreviewStore=new Map();
const TTL=4*60*60*1000;
const sessionKey=(studentId:number,bookingId:number)=>`student-${studentId}-booking-${bookingId}`;
function ensure(studentId:number,bookingId:number,version:string,now:number){
 const key=sessionKey(studentId,bookingId),s=store.get(key);
 if(!s||s.version!==version||s.expires<now){for(const [k,v] of store)if(v.expires<now)store.delete(k);store.set(key,{version,expires:now+TTL,tasks:new Map(),events:new Map()});}
 return key;
}
export class StudentGameError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status;}}

/** Grades one action against the approved copy and records the outcome. The student and booking come from the
 * server's session resolution, never from `body`; the skill is derived inside recordNativeResult. */
export function studentGameAction(identity:{studentId:number;bookingId:number},body:unknown,now=Date.now()):Record<string,unknown> {
 const data=body as {version?:unknown;taskId?:unknown;action?:unknown;input?:unknown;eventId?:unknown};
 if(!data||typeof data!=='object'||typeof data.taskId!=='string'||typeof data.action!=='string'||typeof data.eventId!=='string')throw new StudentGameError('בקשה לא תקינה',400);
 const approved=approvedGameBundle(identity.studentId,identity.bookingId);
 if(!approved)throw new StudentGameError('המשחק אינו זמין',404);
 if(data.version!==approved.version)throw new StudentGameError('הגרסה התחלפה. פתחו מחדש את המשחק.',409);
 const game=approved.bundle.games.find(g=>g.rounds.some(r=>r.id===data.taskId)),task=game?.rounds.find(r=>r.id===data.taskId);
 if(!game||!task)throw new StudentGameError('המשימה לא נמצאה',404);
 const key=ensure(identity.studentId,identity.bookingId,approved.version,now),session=store.get(key)!;
 const repeated=session.events.has(`${task.id}:${data.eventId}`);
 let result:Record<string,unknown>;
 try{result=actionInStore(store,key,approved.version,task,data.action,data.input,data.eventId,now);}
 catch(e){const m=e instanceof Error?e.message:'';throw new StudentGameError(/attempt required/.test(m)?'נסו קודם בעצמכם, ואז אפשר לבקש עזרה.':/stale|limit/.test(m)?'המשחק התחדש. טענו את הדף מחדש.':'בדקו את התשובה והגבולות שהקלדתם.',/stale|limit|attempt/.test(m)?409:400);}
 if(data.action==='attempt'&&!repeated){
  const state=session.tasks.get(task.id)!;
  const outcome=result.correct===true?(state.hints>0||state.revealed?'assisted':'correct'):'incorrect';
  recordNativeResult({studentId:identity.studentId,bookingId:identity.bookingId,gameId:game.id,roundId:task.id,outcome,attempts:state.attempts,seconds:null});
 }
 return result;
}
