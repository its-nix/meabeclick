import {resolveFamilyAccess} from '../family.ts';
import type {FamilyIdentity} from '../family-auth.ts';

/** The signed-in student, from the session only. A parent account session is not a student: results are the child's evidence and are never recorded from an adult's session.
 * The one exception is a self-learner account (the adult is the learner) that owns exactly one student; any other account session resolves to nobody. */
export function sessionStudent(family:FamilyIdentity|null|undefined):{id:number;code:string;name:string}|null {
 if(!family)return null;
 const access=resolveFamilyAccess(family);
 const student=access?.student??(access?.isSelf&&access.students.length===1?access.students[0]:null);
 return student?{id:student.id,code:student.code,name:student.name}:null;
}
