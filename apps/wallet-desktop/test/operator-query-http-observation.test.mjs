import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
const source=fs.readFileSync(new URL('../src/original-policy-supplier/operator-query.mjs',import.meta.url),'utf8');
function actualReader(status,headers,body='{"PUBLIC":true}'){
 const start=source.indexOf('export function operatorReadResponseProblem(')>=0?source.indexOf('export function operatorReadResponseProblem('):source.indexOf('function readResponse('),end=source.indexOf('async function readJSON(',start);assert(start>=0&&end>start);let destroyed=0,method;
 const request=(url,options,consume)=>{method=options.method;assert.equal(options.rejectUnauthorized,true);assert.equal(typeof options.checkServerIdentity,'function');const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=status;res.headers=headers;res.destroy=()=>{destroyed++;};consume(res);if(!destroyed){res.emit('data',Buffer.from(body));res.emit('end');}});return req;};
 const context={request,NORMAL_OPERATOR:{origin:'https://rpc.ynxweb4.com',maxBytes:1024},setTimeout,clearTimeout,TextDecoder,Buffer,URL,checkServerIdentity(){},X509Certificate:class{},createHash(){throw Error('PUBLIC header test does not claim TLS verification');}};
 const read=vm.runInNewContext(`(()=>{${source.slice(start,end).replace(/^export /gm,'')};return readResponse;})()`,context);
 return{read:(p,allow=false)=>read(p,undefined,1000,allow),destroyed:()=>destroyed,method:()=>method};
}
const owner='0x'+'1'.repeat(40),hash='0x'+'2'.repeat(64),authorization='/accounts/'+owner+'/authorization';
test('actual normal GET refusal retains HTTP405 as public diagnostic cause rather than implying a Host Source refusal',async()=>{
 const f=actualReader(405,{'content-type':'text/plain; charset=utf-8'});let failure;try{await f.read(authorization)}catch(error){failure=error;}
 assert.equal(failure?.message,'AUTH_POLICY_SOURCE_NOT_SUPPLIED');assert.equal(failure?.operatorReadObservation?.reason,'http-status');assert.equal(failure.operatorReadObservation.httpStatus,405);assert.equal(failure.operatorReadObservation.routeKind,'account-authorization');assert.equal(failure.operatorReadObservation.method,'GET');assert.equal(failure.operatorReadObservation.contentType,'text/plain');assert.equal(f.method(),'GET');assert.equal(f.destroyed(),1);assert(Object.isFrozen(failure.operatorReadObservation));assert.equal(Object.keys(failure).includes('operatorReadObservation'),false);assert.equal(JSON.stringify(failure.operatorReadObservation).includes(owner),false);
});
test('normal header gate keeps status, JSON and no-store refusals distinct without weakening any check',async()=>{
 for(const[status,headers,reason]of[[503,{'content-type':'application/json'},'http-status'],[200,{'content-type':'text/plain','cache-control':'no-store'},'content-type'],[200,{'content-type':'application/json','cache-control':'max-age=10'},'missing-no-store']]){
  const f=actualReader(status,headers);await assert.rejects(f.read(authorization),e=>e.message==='AUTH_POLICY_SOURCE_NOT_SUPPLIED'&&e.operatorReadObservation.reason===reason&&e.operatorReadObservation.httpStatus===status);assert.equal(f.destroyed(),1);
 }
});
test('existing successful JSON reads and explicit404 transaction lookup absence remain exact raw DATA only',async()=>{
 for(const[path,status,headers,allow]of[['/status',200,{'content-type':'application/json'},false],['/blocks/0',200,{'content-type':'application/json'},false],[authorization,200,{'content-type':'application/json','cache-control':'no-store'},false],['/txs/'+hash,404,{'content-type':'application/json','cache-control':'no-store'},true]]){
  const f=actualReader(status,headers);const value=await f.read(path,allow);assert.equal(value.status,status);assert.equal(value.text,'{"PUBLIC":true}');assert.equal(f.destroyed(),0);assert.equal(f.method(),'GET');
 }
 const f=actualReader(404,{'content-type':'application/json','cache-control':'no-store'});await assert.rejects(f.read('/txs/'+hash),e=>e.operatorReadObservation.reason==='http-status');
});
