import{handle}from'../db.ts';
export interface PreparationBrief {
 version:1;subject:string|null;level:string|null;durationMin:number|null;
 topic:string|null;readiness:'unknown';missing:string[];
 observations:Array<{kind:string;topic:string;status:string|null;at:string}>;
}
/** A preparation snapshot is evidence, not a claim that a planned skill was taught. */
export function preparationBriefForBooking(input:{bookingId:number;studentId:number}):PreparationBrief {
 const db=handle();
 const booking=db.prepare(`SELECT b.duration,e.id enrollment_id,e.subject,e.level FROM bookings_v2 b
 LEFT JOIN enrollments e ON e.id=b.enrollment_id AND e.student_id=b.student_id
 WHERE b.id=? AND b.student_id=?`).get(input.bookingId,input.studentId);
 if(!booking)throw Error('native brief ownership mismatch');
 const missing:string[]=[];
 if(!booking.enrollment_id)missing.push('enrollment');
 if(!booking.subject)missing.push('subject');if(!booking.level)missing.push('level');
 if(![45,90,135].includes(Number(booking.duration)))missing.push('duration');
 // Bookings currently carry no lesson-topic or diagnostic-answer fields.
 missing.push('topic','readiness');
 const observations=booking.enrollment_id?db.prepare(`SELECT pn.title topic,pe.type,pe.status,pe.at
 FROM plan_events pe JOIN plans p ON p.id=pe.plan_id JOIN plan_nodes pn ON pn.id=pe.node_id AND pn.plan_id=p.id
 WHERE p.enrollment_id=? AND p.student_id=? AND pe.type IN ('status','covered') AND pn.visibility!='hidden'
 AND NOT EXISTS(SELECT 1 FROM plan_events correction WHERE correction.corrects=pe.id)
 ORDER BY pe.at DESC,pe.id DESC LIMIT 8`).all(booking.enrollment_id,input.studentId).map(row=>({kind:String(row.type),topic:String(row.topic).slice(0,160),status:row.status===null?null:String(row.status),at:String(row.at)})):[];
 return{version:1,subject:booking.subject as string|null,level:booking.level as string|null,durationMin:booking.duration as number|null,topic:null,readiness:'unknown',missing,observations};
}
