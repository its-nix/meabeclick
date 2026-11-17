import {resolveFamilyAccess} from '../family.ts';
import type {FamilyIdentity} from '../family-auth.ts';

/** The signed-in student, from the session only. A parent/account session is not a student: results are the child's evidence and are never recorded from an adult's session. */
export function sessionStudent(family:FamilyIdentity|null|undefined):{id:number;code:string;name:string}|null {
 if(!family)return null;
 const access=resolveFamilyAccess(family);
 return access?.student?{id:access.student.id,code:access.student.code,name:access.student.name}:null;
}
