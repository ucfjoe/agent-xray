import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeSources} from '../core/dependencies.js';
test('parser finds real imports and symbols, not strings or comments',()=>{
 const result=analyzeSources([{path:'a.ts',content:'// import fake from "bad"\nimport {b} from "./b";\nexport function login() { return b; }'},{path:'b.ts',content:'export const b = 1;'}]);
 assert.equal(result.dependencies.length,1);assert.equal(result.dependencies[0].to,'b.ts');
 assert.ok(result.symbols.some(s=>s.name==='login'&&s.line===3));
});
test('unsupported languages and unresolved imports stay explicit',()=>{
 const r=analyzeSources([{path:'a.py',content:'hello'},{path:'a.ts',content:'import x from "external";'}]);
 assert.equal(r.diagnostics.length,1);assert.equal(r.dependencies[0].external,true);
});
