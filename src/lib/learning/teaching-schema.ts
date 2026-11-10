import {TEACHING_RULE_VERSION} from './teaching-rules.ts';
const text={type:'string'},number={type:'number'},texts={type:'array',items:text};
const object=(properties:Record<string,unknown>)=>({type:'object',required:Object.keys(properties),properties});
const list=(properties:Record<string,unknown>)=>({type:'array',items:object(properties)});
const enumeration=(...values:string[])=>({type:'string',enum:values});
export const TEACHING_SCHEMA=object({version:{type:'integer',enum:[2]},ruleVersion:{type:'string',enum:[TEACHING_RULE_VERSION]},durationMin:number,homeworkMinutes:number,
 objectives:list({id:text,title:text,evidence:text}),agenda:list({id:text,title:text,minutes:{type:'integer'},objectiveId:text,kind:enumeration('scene','game','homework','discussion'),ref:text}),
 practice:list({asset:enumeration('scene','game','homework'),ref:text,objectiveId:text,problemId:text,misconception:text,support:enumeration('guided','independent'),grading:enumeration('checked','tutor-review')}),
 branches:list({id:text,title:text,replaces:text,refs:texts}),sources:list({questionId:text,kind:enumeration('official','adapted'),asset:enumeration('scene','homework'),ref:text})});
