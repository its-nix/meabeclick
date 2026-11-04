import {test} from 'node:test';
import assert from 'node:assert/strict';
import {strictOutputSchema,omitOptionalNulls} from '../../src/lib/server/lesson/structured-output.ts';

test('strict conversion preserves the original contract and makes nested optional fields nullable',()=>{
  const source={type:'object',required:['rows'],properties:{rows:{type:'array',items:{type:'object',required:['value'],properties:{value:{type:'number'},hint:{type:'string'}}}},note:{type:'string'}}};
  const before=structuredClone(source),strict=strictOutputSchema(source);
  assert.deepEqual(source,before);
  assert.deepEqual(strict.required,['rows','note']);
  assert.deepEqual(strict.properties.note,{anyOf:[{type:'string'},{type:'null'}]});
  assert.deepEqual(strict.properties.rows.items.required,['value','hint']);
  assert.equal(strict.properties.rows.items.additionalProperties,false);
});

test('normalization preserves required nulls, zero, false and empty strings without mutating a response',()=>{
  const schema={type:'object',required:['check','rows'],properties:{check:{anyOf:[{type:'null'},{type:'object',required:['answer'],properties:{answer:{type:'number'},hint:{type:'string'}}}]},rows:{type:'array',items:{type:'object',required:['value'],properties:{value:{type:'number'},note:{type:'string'}}}},note:{type:'string'}}};
  const response={check:null,rows:[{value:0,note:null},{value:false,note:''}],note:null};
  const original=structuredClone(response);
  assert.deepEqual(omitOptionalNulls(response,schema),{check:null,rows:[{value:0},{value:false,note:''}]});
  assert.deepEqual(response,original);
  assert.deepEqual(omitOptionalNulls({check:{answer:0,hint:null},rows:[]},schema),{check:{answer:0},rows:[]});
});
