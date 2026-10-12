import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [port,cookies]=process.argv.slice(2);
if(!/^\d{2,5}$/.test(port||'')||Number(port)>65535||!cookies)throw Error('Isolated localhost runtime port and verifier cookie jar required');
const cookie=(await readFile(cookies,'utf8')).split('\n').filter(line=>line&&!line.startsWith('#')||line.startsWith('#HttpOnly_')).map(line=>line.replace(/^#HttpOnly_/,'').split('\t')).filter(row=>row.length===7&&row[0]==='127.0.0.1').map(row=>`${row[5]}=${row[6]}`).join('; ');
assert.ok(cookie,'Runtime verifier cookie is missing');
const samples=[
 {language:'typescript',activePath:'main.ts',source:'function add(left: number, right: number) { return left + right; }\nconst total = ad\n',position:{line:1,character:16},label:'add'},
 {language:'javascript',activePath:'main.js',source:'function add(left, right) { return left + right; }\nconst total = ad\n',position:{line:1,character:16},label:'add'},
 {language:'python',activePath:'main.py',source:"def greet(name: str) -> str:\n    return f'Hello {name}'\n\ngre\n",position:{line:3,character:3},label:'greet'},
 {language:'solidity',activePath:'Counter.sol',source:'// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract Counter {\n  uint256 public value;\n  function set(uint256 next) external { value = next; }\n}',position:{line:4,character:2}},
];
for(const sample of samples){
 const response=await fetch(`http://127.0.0.1:${port}/runtime/language/${sample.language}`,{method:'POST',headers:{'content-type':'application/json',cookie},body:JSON.stringify({protocolVersion:'ynx-code/v1',projectId:`package-language-${sample.language}`,files:{[sample.activePath]:sample.source},activePath:sample.activePath,operation:'completion',position:sample.position}),signal:AbortSignal.timeout(45000)});
 const value=await response.json();
 const code=/^[a-z0-9_]{1,80}$/.test(value?.code||'')?value.code:'request_failed';
 assert.equal(response.status,200,`${sample.language} runtime request failed (${code})`);
 assert.equal(value.language,sample.language);assert.equal(value.sandbox?.network,false);
 const items=Array.isArray(value.result)?value.result:value.result?.items||[];assert.ok(items.length>0,`${sample.language} produced no completions`);
 if(sample.label)assert.ok(items.some(item=>String(item.label)===sample.label),`${sample.language} missing actual project symbol`);
 console.log(`Bundled ${sample.language} language service completed a real isolated completion request (${items.length} items, network=false).`);
}
