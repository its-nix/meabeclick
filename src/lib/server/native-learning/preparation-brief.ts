import{handle}from'../db.ts';
export interface PreparationBrief {
 version:1;subject:string|null;level:string|null;durationMin:number|null;
 topic:string|null;request?:string;priorKnowledge?:string;readiness:'unknown'|'tutor-reported';missing:string[];
 practice?:Array<{topic:string;gameId:string;roundId:string;outcome:string;attempts:number;at:string}>;
 previousAssignedSourceIds?:string[];
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
 AND (pe.type!='covered' OR pe.corrects IS NULL)
 AND NOT EXISTS(SELECT 1 FROM plan_events correction WHERE correction.corrects=pe.id)
 ORDER BY pe.at DESC,pe.id DESC LIMIT 8`).all(booking.enrollment_id,input.studentId).map(row=>({kind:String(row.type),topic:String(row.topic).slice(0,160),status:row.status===null?null:String(row.status),at:String(row.at)})):[];
 const practice=db.prepare(`SELECT COALESCE(pn.title,r.game_id) topic,r.game_id,r.round_id,r.outcome,r.attempts,r.at FROM native_results r LEFT JOIN plan_nodes pn ON pn.id=r.skill_node_id WHERE r.student_id=? ORDER BY r.at DESC,r.id DESC LIMIT 4`).all(input.studentId).map(r=>({topic:String(r.topic).slice(0,160),gameId:String(r.game_id),roundId:String(r.round_id),outcome:String(r.outcome),attempts:Number(r.attempts),at:String(r.at)}));
 const previousAssignedSourceIds=new Set<string>();
 if(booking.enrollment_id){
  const materials=db.prepare(`SELECT m.content FROM learning_assignments a JOIN lessons l ON l.slug=a.lesson_slug JOIN lesson_materials m ON m.lesson_slug IN (a.lesson_slug,a.practice_material_slug) WHERE a.student_id=? AND l.subject=? AND a.practice_state='assigned' AND (a.booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings_v2 b WHERE b.id=a.booking_id AND b.student_id=a.student_id AND b.enrollment_id=? AND b.status='confirmed')) AND m.kind='plan' AND m.published_at IS NOT NULL AND m.version=(SELECT MAX(v.version) FROM lesson_materials v WHERE v.lesson_slug=m.lesson_slug AND v.kind='plan' AND v.published_at IS NOT NULL) ORDER BY m.created_at DESC LIMIT 8`).all(input.studentId,booking.subject,booking.enrollment_id);
  for(const row of materials)try{const p=JSON.parse(String(row.content));for(const id of p.sourceQuestionIds??p.teaching?.sources?.map((s:{questionId:string})=>s.questionId)??[])if(typeof id==='string'&&/^[a-zA-Z0-9-]{1,100}$/.test(id))previousAssignedSourceIds.add(id);}catch{/* Historical malformed material is not evidence of source use. */}
 }
 return{practice,previousAssignedSourceIds:[...previousAssignedSourceIds].slice(0,20),version:1,subject:booking.subject as string|null,level:booking.level as string|null,durationMin:booking.duration as number|null,topic:null,readiness:'unknown',missing,observations};
}
