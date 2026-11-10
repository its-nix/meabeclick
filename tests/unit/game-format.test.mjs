import{test}from'node:test';import assert from'node:assert/strict';
test('a defining graph formula renders correctly with or without prose delimiters',async()=>{
 const{formulaLabel,mathText}=await import('../../src/lib/learning/math.ts');assert.equal(typeof formulaLabel,'function');
 for(const raw of ['g(x)=-\\frac{1}{2}(x+1)^2+2','y=x+2','\\(y=x^2\\)'])assert.match(mathText(formulaLabel(raw)),/class="katex"/);
 assert.equal(formulaLabel('הגרף הנתון'),'הגרף הנתון');
});
