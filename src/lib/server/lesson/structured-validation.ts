/** Runtime trust boundary shared by strict and stdout-only lesson engines. */
import type { OutputSchema } from './structured-output.ts';
import type { QualityIssue } from './quality.ts';
export function structuredProblems(value: unknown, schema: OutputSchema, path = ''): QualityIssue[] {
  const fail = (message:string): QualityIssue[] => [{path:path || 'lesson',code:'structure',message}];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.anyOf) {
    const failures=schema.anyOf.map(branch=>structuredProblems(value,branch,path));
    if (failures.some(issues=>!issues.length)) return [];
    const sameType=schema.anyOf.flatMap((branch,i)=>!branch.type || branch.type===actual || (branch.type==='integer' && actual==='number') ? [failures[i]] : []);
    return sameType.length===1 ? sameType[0] : fail('Value does not match an allowed schema shape');
  }
  if (schema.type && (schema.type === 'integer' ? typeof value !== 'number' || !Number.isInteger(value) : actual !== schema.type)) return fail(`Expected ${schema.type}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return fail('Value must be one of the allowed values');
  if (typeof value === 'string') {
    if (typeof schema.minLength==='number' && value.length<schema.minLength) return fail(`Text has ${value.length} characters; minimum is ${schema.minLength}`);
    if (typeof schema.maxLength==='number' && value.length>schema.maxLength) return fail(`Text has ${value.length} characters; maximum is ${schema.maxLength}`);
    if (typeof schema.pattern==='string' && !new RegExp(schema.pattern).test(value)) return fail(`Text must match the required pattern ${schema.pattern}`);
  }
  if (typeof value === 'number' && ((typeof schema.minimum === 'number' && value < schema.minimum) || (typeof schema.maximum === 'number' && value > schema.maximum))) return fail('Number is outside the allowed range');
  const issues: QualityIssue[] = [];
  if (Array.isArray(value)) {
    if ((typeof schema.minItems === 'number' && value.length < schema.minItems) || (typeof schema.maxItems === 'number' && value.length > schema.maxItems)) issues.push(...fail('Item count is outside the allowed range'));
    if (schema.items) value.forEach((item,i)=>issues.push(...structuredProblems(item,schema.items!,`${path}[${i}]`)));
  } else if (value && typeof value === 'object' && schema.properties) {
    const object = value as Record<string,unknown>;
    for (const key of schema.required ?? []) if (!Object.hasOwn(object,key)) issues.push({path:path ? `${path}.${key}` : key,code:'structure',message:'Required artifact field is missing'});
    for (const [key,child] of Object.entries(object)) {
      const childPath = path ? `${path}.${key}` : key;
      if (Object.hasOwn(schema.properties,key)) issues.push(...structuredProblems(child,schema.properties[key],childPath));
      else if (schema.additionalProperties === false) issues.push({path:childPath,code:'structure',message:'Unsupported artifact field'});
    }
  }
  return issues;
}
