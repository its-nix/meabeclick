import {actionInStore,type PreviewStore} from '../visual-pilot.ts';
import {approvedGameBundle,approvedGameForRound} from './games.ts';
import {ATTEMPT_CAP,nativeRoundState,recordNativeAssist,recordNativeResult} from './results.ts';

/** Event dedupe only. Attempts, hints and revealed solutions are never held here: they are read from native_results on every action, so a restart or a four-hour wait cannot reset them. */
let store:PreviewStore=new Map();
const TTL=4*60*60*1000,MAX_EVENTS=400;
const sessionKey=(studentId:number,bookingId:number,version:string)=>`student-${studentId}-booking-${bookingId}-${version.slice(0,16)}`;
function ensure(studentId:number,bookingId:number,version:string,now:number){
 const key=sessionKey(studentId,bookingId,version),s=store.get(key);
 if(!s||s.version!==version||s.expires<now||s.events.size>=MAX_EVENTS){for(const [k,v] of store)if(v.expires<now)store.delete(k);store.set(key,{version,expires:now+TTL,tasks:new Map(),events:new Map()});}
 return key;
}
/** Test seam: forgets the in-memory event cache, as a process restart does. */
export function resetStudentGameSessions(){store=new Map();}
export class StudentGameError extends Error {status:number;constructor(message:string,status:number){super(message);this.status=status;}}

/** Grades one action against the approved copy and records the outcome. The student and booking come from the
 * server's session resolution, never from `body`; the skill is derived inside recordNativeResult.
 * Evidence rule: the first correct attempt without help is independent; once a round has a decided result nothing more is recorded for it, so a later wrong retry cannot downgrade it. */
export function studentGameAction(identity:{studentId:number;bookingId:number},body:unknown,now=Date.now()):Record<string,unknown> {
 const data=body as {version?:unknown;taskId?:unknown;action?:unknown;input?:unknown;eventId?:unknown};
 if(!data||typeof data!=='object'||typeof data.taskId!=='string'||typeof data.action!=='string'||typeof data.eventId!=='string')throw new StudentGameError('בקשה לא תקינה',400);
 const found=approvedGameForRound(identity.studentId,identity.bookingId,data.taskId);
 if(!found)throw new StudentGameError(approvedGameBundle(identity.studentId,identity.bookingId)?'המשימה לא נמצאה':'המשחק אינו זמין',404);
 if(data.version!==found.version)throw new StudentGameError('הגרסה התחלפה. פתחו מחדש את המשחק.',409);
 const game=found.game,task=game.rounds.find(r=>r.id===data.taskId)!;
 const key=ensure(identity.studentId,identity.bookingId,found.version,now),session=store.get(key)!;
 const repeated=session.events.has(`${task.id}:${data.eventId}`);
 const before=nativeRoundState(identity.studentId,identity.bookingId,game.id,task.id);
 if(!repeated&&data.action==='attempt'&&!before.decided&&before.attempts>=ATTEMPT_CAP)throw new StudentGameError('הגעתם למספר הניסיונות המרבי בשאלה הזו.',409);
 session.tasks.set(task.id,{attempts:before.attempts,hints:before.hints,revealed:before.revealed});
 let result:Record<string,unknown>;
 try{result=actionInStore(store,key,found.version,task,data.action,data.input,data.eventId,now);}
 catch(e){const m=e instanceof Error?e.message:'';throw new StudentGameError(/attempt required/.test(m)?'נסו קודם בעצמכם, ואז אפשר לבקש עזרה.':/stale|limit/.test(m)?'המשחק התחדש. טענו את הדף מחדש.':'בדקו את התשובה והגבולות שהקלדתם.',/stale|limit|attempt/.test(m)?409:400);}
 if(repeated)return result;
 const ids={studentId:identity.studentId,bookingId:identity.bookingId,gameId:game.id,roundId:task.id};
 if(data.action==='attempt'){
  if(before.decided)return result;
  const outcome=result.correct===true?(before.hints>0||before.revealed?'assisted':'correct'):'incorrect';
  recordNativeResult({...ids,outcome,attempts:before.attempts+1,seconds:null});
 }else recordNativeAssist({...ids,kind:data.action==='hint'?'hint':'solution'});
 return result;
}
