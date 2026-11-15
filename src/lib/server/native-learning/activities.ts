import{createHash}from'node:crypto';
import sample from './review-sample.json' with{type:'json'};
import{visualLessonProblems}from'../../learning/deck/model.ts';
import{officialQuestion}from'../lesson/official-questions.ts';
import{getNativeLessonJob}from'./jobs.ts';
import type{AuthoredLesson}from'./authoring.ts';
/** Only completed tutor drafts can serve their own saved activities. Never fall back to the pilot. */
export function nativeBookingActivities(bookingId:number):AuthoredLesson|null{
 if(!Number.isSafeInteger(bookingId)||bookingId<1)return null;
 const job=getNativeLessonJob(bookingId);
 if(job?.state!=='review')return null;
 return (job.snapshot as typeof job.snapshot&{authored?:AuthoredLesson}).authored??null;
}

let checkedSample=false;
/** A real generated synthetic candidate enables owner review without fake customer bookings. */
export function nativeActivitySource(id:string):AuthoredLesson|null{
 if(id!=='sample')return /^[1-9]\d*$/.test(id)?nativeBookingActivities(Number(id)):null;
 const source=sample as unknown as AuthoredLesson&{syntheticOnly:boolean};
 if(!checkedSample){
  const q=officialQuestion('moe-2025a-35372-3')!;
  if(source.syntheticOnly!==true||createHash('sha256').update(JSON.stringify(source.bundle)).digest('hex')!==source.version||visualLessonProblems(source.bundle,{sourceAnswers:{[q.id]:q.answers!}}).length)throw Error('invalid native review sample');
  checkedSample=true;
 }
 return source;
}
