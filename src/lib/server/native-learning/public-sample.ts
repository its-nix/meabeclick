import {createHash,randomUUID} from 'node:crypto';
import sample from './public-sample.json' with {type:'json'};
import {visualGamesProblems,type VisualLesson} from '../../learning/deck/model.ts';
import {actionInStore,type PreviewStore} from '../visual-pilot.ts';

/**
 * The public landing-page sample: one seeded quiz game, no student data. It is
 * rendered by the same visual-deck player as real student games and graded on
 * the server (answers never reach the page). Sessions are anonymous, in memory,
 * capped, and record nothing.
 */
const problems=visualGamesProblems(sample.games,sample.objectives);
if(problems.length)throw Error('invalid public sample: '+problems.join('; '));
export const SAMPLE_GAME_ID=sample.games[0].id;
export const SAMPLE_VERSION=createHash('sha256').update(JSON.stringify(sample)).digest('hex');
/** Same game-only shell the student player uses. */
export const sampleBundle=():VisualLesson=>({version:1,ruleVersion:'',title:'שיעור לדוגמה: פרבולות',subtitle:'',durationMin:0,homeworkMinutes:0,objectives:sample.objectives,agenda:[],slides:[],tasks:[],homework:[],games:sample.games,sourceSolutions:[]} as unknown as VisualLesson);

const store:PreviewStore=new Map();
const TTL=60*60*1000,MAX=500;
export function startSampleSession(now=Date.now()):string{
 for(const [k,v] of store)if(v.expires<now)store.delete(k);
 while(store.size>=MAX)store.delete(store.keys().next().value!);
 const id=randomUUID();store.set(id,{version:SAMPLE_VERSION,expires:now+TTL,tasks:new Map(),events:new Map()});return id;
}
export function ensureSampleSession(id:string|undefined,now=Date.now()):string{
 const s=id?store.get(id):null;return s&&s.expires>=now?id!:startSampleSession(now);
}
export class SampleGameError extends Error{status:number;constructor(m:string,status:number){super(m);this.status=status;}}
export function sampleGameAction(sessionId:string,body:unknown,now=Date.now()):Record<string,unknown>{
 const d=body as {version?:unknown;taskId?:unknown;action?:unknown;input?:unknown;eventId?:unknown};
 if(!d||typeof d!=='object'||typeof d.taskId!=='string'||typeof d.action!=='string'||typeof d.eventId!=='string')throw new SampleGameError('בקשה לא תקינה',400);
 if(d.version!==SAMPLE_VERSION)throw new SampleGameError('הגרסה התחלפה. טענו את הדף מחדש.',409);
 const task=sample.games[0].rounds.find(r=>r.id===d.taskId) as unknown as Parameters<typeof actionInStore>[3]|undefined;
 if(!task)throw new SampleGameError('המשימה לא נמצאה',404);
 try{return actionInStore(store,sessionId,SAMPLE_VERSION,task,d.action,d.input,d.eventId,now);}
 catch(e){const m=e instanceof Error?e.message:'';throw new SampleGameError(/attempt required/.test(m)?'נסו קודם בעצמכם, ואז אפשר לבקש עזרה.':/stale|limit/.test(m)?'המשחק התחדש. טענו את הדף מחדש.':'בדקו את התשובה שהקלדתם.',/stale|limit|attempt/.test(m)?409:400);}
}
