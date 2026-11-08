import type {LessonPlan} from './prep.ts';
import type {QualityIssue} from './quality.ts';
import type {LearningScene} from '../../learning/model.ts';
import {strictOutputSchema,omitOptionalNulls,type OutputSchema} from './structured-output.ts';
import {structuredProblems} from './structured-validation.ts';
import {QUESTION_BANK_KEYS} from './game-generation.ts';

export interface ArtifactRepair {
  paths:string[];
  schema:OutputSchema;
  apply(reply:unknown):LessonPlan;
}
const object=(value:unknown):value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
const contains=(parent:string,path:string) => path===parent || path.startsWith(parent+'.') || path.startsWith(parent+'[');
type Unit={schema:OutputSchema;set:(plan:LessonPlan,value:unknown)=>void};

/** Generated paths select existing catalog entries, never arbitrary object setters. */
export function artifactRepair(candidate:unknown,issues:QualityIssue[],schema:OutputSchema):ArtifactRepair|null {
  if (!object(candidate) || !issues.length) return null;
  const units=new Map<string,Unit>();
  const lengths=new Map<string,number>();
  for (const key of ['slides','examples','homework'] as const) {
    const list=candidate[key],itemSchema=schema.properties?.[key]?.items;
    if (Array.isArray(list) && itemSchema) { lengths.set(key,list.length);list.forEach((_,i)=>units.set(`${key}[${i}]`,{
      schema:itemSchema,set:(plan,value)=>{(plan[key] as unknown[])[i]=value;},
    })); }
  }
  const learning=candidate.learning;
  const sceneSchema=schema.properties?.learning?.properties?.scenes?.items;
  if (object(learning) && Array.isArray(learning.scenes) && sceneSchema) {
    lengths.set('learning.scenes',learning.scenes.length);
    learning.scenes.forEach((_,i)=>units.set(`learning.scenes[${i}]`,{
      schema:sceneSchema,set:(plan,value)=>{plan.learning!.scenes[i]=value as LearningScene;},
    }));
  }
  if (object(candidate.games)) for (const [key,gameSchema] of Object.entries(schema.properties?.games?.properties ?? {})) {
    const game=candidate.games[key];
    if (game==null) continue;
    units.set(`games.${key}`,{schema:gameSchema,set:(plan,value)=>{(plan.games as Record<string,unknown>)[key]=value;}});
    const bankKey=QUESTION_BANK_KEYS[key],bank=object(game) ? game[bankKey] : null;
    const itemSchema=gameSchema.properties?.[bankKey]?.items;
    if (Array.isArray(bank) && itemSchema) { lengths.set(`games.${key}.${bankKey}`,bank.length);bank.forEach((_,i)=>units.set(`games.${key}.${bankKey}[${i}]`,{
      schema:itemSchema,set:(plan,value)=>{
        const body=(plan.games as Record<string,unknown>)[key] as Record<string,unknown>;
        (body[bankKey] as unknown[])[i]=value;
      },
    })); }
  }
  const selected:string[]=[];
  for (const issue of issues) {
    let issuePath=issue.path;
    for (const [prefix,length] of lengths) {
      const dotted=issuePath.startsWith(prefix+'.') ? issuePath.slice(prefix.length+1).match(/^(\d+)(?=\.|$)/) : null;
      if (dotted) issuePath=prefix+`[${Number(dotted[1])}]`+issuePath.slice(prefix.length+1+dotted[1].length);
      if (!issuePath.startsWith(prefix+'[')) continue;
      const index=issuePath.slice(prefix.length).match(/^\[(\d+)\](?=\.|\[|$)/);
      if (!index || Number(index[1])>=length) return null;
    }
    const match=[...units.keys()].filter(path=>contains(path,issuePath)).sort((a,b)=>b.length-a.length)[0];
    if (!match) return null;
    if (!selected.includes(match)) selected.push(match);
  }
  const paths=selected.filter(path=>!selected.some(parent=>parent!==path && contains(parent,path)));
  const response:OutputSchema={type:'object',additionalProperties:false,required:paths,
    properties:Object.fromEntries(paths.map(path=>[path,units.get(path)!.schema]))};
  const strict=strictOutputSchema(response);
  return {paths,schema:strict,apply(reply) {
    const problems=structuredProblems(reply,strict);
    if (problems.length) throw new Error(problems.map(issue=>`${issue.path}: ${issue.message}`).join('; '));
    const values=omitOptionalNulls(reply,response) as Record<string,unknown>;
    const result=structuredClone(candidate) as unknown as LessonPlan;
    for (const path of paths) units.get(path)!.set(result,values[path]);
    return result;
  }};
}
