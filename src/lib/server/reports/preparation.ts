import { sanitizeField } from '../lesson/prompt.ts';
import { getStudentByCode, enrollmentsForStudent } from '../entities.ts';
import { latestPreparationCoverage, type TopicReportRevision } from './topics.ts';

/** This JSON belongs inside the caller's randomized data fence. */
export function preparationCoverageData(report:TopicReportRevision|null|undefined):string {
 if(!report)return '';
 return JSON.stringify({revision:report.revision,source:report.source,material:report.snapshot?{slug:report.snapshot.slug,hash:report.snapshot.hash}:null,topics:report.topics.map(t=>({id:sanitizeField(t.id,120),title:sanitizeField(t.title),skillKeys:t.skillKeys.map(k=>sanitizeField(k,120)),covered:t.covered,comment:sanitizeField(t.comment,2000)}))});
}
export function preparationCoverageFor(studentCode:string|null,subject:string):TopicReportRevision|null {
 const student=studentCode?getStudentByCode(studentCode):null;
 const enrollment=student?enrollmentsForStudent(student.id).find(e=>e.subject===subject):null;
 return enrollment?latestPreparationCoverage(enrollment.id):null;
}
