import{getNativeLessonJob}from'./jobs.ts';
import type{AuthoredLesson}from'./authoring.ts';
/** Only completed tutor drafts can serve their own saved activities. Never fall back to the pilot. */
export function nativeBookingActivities(bookingId:number):AuthoredLesson|null{
 if(!Number.isSafeInteger(bookingId)||bookingId<1)return null;
 const job=getNativeLessonJob(bookingId);
 if(job?.state!=='review')return null;
 return (job.snapshot as typeof job.snapshot&{authored?:AuthoredLesson}).authored??null;
}
