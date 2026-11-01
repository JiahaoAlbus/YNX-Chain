import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {ProductSessionGatewayNodeHost} from '../src/product-session-gateway-node-host.js';
import {CanonicalWalletGatewayNodeHost} from '../src/gateway-node-host.js';
import {GatewayAdmissionController} from '../src/gateway-admission.js';

// Exercise the actual v2 daemon listener on an ephemeral loopback port. No
// Source, Native, keys, existing state, external service or approval is used.
async function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'ynx-principal-daemon-'));
 const registry=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url)));
 const options=name=>({statePath:join(dir,name),now:()=>new Date(),tokenFactory:()=> 'PUBLIC-route-token'});
 const host=new ProductSessionGatewayNodeHost(registry('product-session-registry.json'),options('product'));
 const legacyHost=new CanonicalWalletGatewayNodeHost(registry('central-registry.json'),{statePath:join(dir,'legacy'),now:()=>new Date(),emitEvent:()=>{}});
 const server=host.createOriginalWalletServiceRuntimeDaemonServer({legacyHost,central:null,admission:new GatewayAdmissionController({maxConcurrent:1}),emitEvent:()=>{}});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 return {host,async call(path,body,method='POST'){
  const response=await fetch('http://127.0.0.1:'+server.address().port+path,{method,headers:{'content-type':'application/json','x-request-id':'req_PUBLIC_daemon_route'},...(method==='GET'?{}:{body:JSON.stringify(body)})});
  return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
 },async close(){server.closeAllConnections();await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));rmSync(dir,{recursive:true,force:true});}};
}
const route='/v1/developer/original-http-principal';
const original=operation=>({operation,requestId:'req_PUBLIC_original_call',method:'POST',path:'/api/developer/projects',body:'{}',proofHeader:'PUBLIC_INVALID_PROOF'});

test('normal v2 daemon reaches original principal validation instead of legacy routing',async()=>{
 const f=await fixture();try{
  const before=JSON.stringify(f.host.snapshot());
  for(const [path,method,body] of [[route,'POST',{...original('authenticate'),operation:'replace'}],[route+'?extra=1','POST',original('authenticate')],[route,'GET',null]]){
   const r=await f.call(path,body,method);assert.equal(r.status,400);assert.equal(r.body.error.code,'ORIGINAL_HTTP_REQUEST_INVALID');assert.equal(r.cache,'no-store');
  }
  assert.equal(JSON.stringify(f.host.snapshot()),before);
 }finally{await f.close();}
});
test('normal principal authenticate and recheck fail closed without Source and preserve state',async()=>{
 const f=await fixture();try{
  const before=JSON.stringify(f.host.snapshot());
  for(const operation of ['authenticate','recheck']){
   const r=await f.call(route,original(operation));assert.equal(r.status,500);assert.equal(r.body.error.code,'INTERNAL');assert.equal(r.cache,'no-store');assert.equal(JSON.stringify(f.host.snapshot()),before);
  }
 }finally{await f.close();}
});
test('principal daemon route is exact and keeps original Source-current absence',async()=>{
 const f=await fixture();try{
  const r=await f.call(route+'/adjacent',original('authenticate'));assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_ORIGIN');
  const current=await f.call('/v1/auth-identity/source-current',null,'GET');assert.equal(current.status,503);assert.equal(current.body.error,'AUTH_SOURCE_CURRENT_SERVICE_NOT_CONFIGURED');
 }finally{await f.close();}
});
