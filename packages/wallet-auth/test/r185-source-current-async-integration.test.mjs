// PUBLIC isolated module/snippet seams only. No admitted service or secret key.
import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {loadOriginalAuthSourceCurrentService} from '../src/original-auth-identity-source-current.js';
import {loadReleaseSelectedOriginalSourceV2} from '../src/original-auth-source-current-v2.js';
const url=new URL('../src/original-auth-identity-source-current.js',import.meta.url),source=readFileSync(url,'utf8'),daemon=readFileSync(new URL('../scripts/ynx-wallet-gatewayd.mjs',import.meta.url),'utf8');
const absolute=(text,base)=>text.replaceAll('import.meta.url',JSON.stringify(base.href)).replace(/from\s*(['"])(\.[^'"]+)\1/g,(_m,q,path)=>`from ${q}${new URL(path,base).href}${q}`);
const moduleURL=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
// Private branding ONLY in this isolated PUBLIC test copy; no product export.
const selected=await import(moduleURL(absolute(source,url)+'\nexport const PUBLICselect=value=>{services.add(value);return value;};'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const currentURL='/v1/auth-identity/source-current?nonce=PUBLIC&profile=PUBLIC';
const response=()=>({writes:[],body:undefined,writeHead(status,headers){assert.equal(typeof status,'number');this.writes.push([status,headers]);},end(body){assert.equal(typeof body,'string');this.body=body;}});
test('PUBLIC normal empty release remains unavailable; fixed native runtime refuses before reads',async()=>{
 assert.equal(await loadOriginalAuthSourceCurrentService(),null);let reads=0;await assert.rejects(loadReleaseSelectedOriginalSourceV2({},()=>{reads++;}),{code:'AUTH_SOURCE_V2_NATIVE_RUNTIME_NOT_SUPPLIED'});assert.equal(reads,0);
});
test('PUBLIC actual branded handler awaits current body; rejection and falsy causes never become 200',async()=>{
 let release;const owner=selected.PUBLICselect({current(){return new Promise(resolve=>{release=resolve;});}});const pending=selected.handleOriginalAuthSourceCurrent(owner,'GET',currentURL,100);let settled=false;void pending.then(()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);release('PUBLIC original');assert.equal((await pending).body,'PUBLIC original');
 for(const cause of [undefined,null,false,0,'']){const owner=selected.PUBLICselect({async current(){throw cause;}});let caught=false;try{await selected.handleOriginalAuthSourceCurrent(owner,'GET',currentURL,100);}catch(e){caught=true;assert.equal(e,cause);}assert.equal(caught,true);}
});
test('PUBLIC actual v2 loader branch awaits and registers the same partial without hiding original falsy error',async()=>{
 const marker='export async function loadOriginalAuthSourceCurrentService(){',start=source.indexOf(marker)+marker.length,end=source.indexOf('\nexport async function handleOriginalAuthSourceCurrent',start),body=source.slice(start,end).trim().slice(0,-1);
 const run=new AsyncFunction('admittedSourceServices','loadReleaseSelectedOriginalSourceV2','publicFile','services','sourceServiceDebt','fail',body),services=new WeakSet(),debt=new Set(),partial=Object.freeze({PUBLIC:'same partial'}),result=Object.freeze({partial,error:false});let release,reads=0;
 const pending=run(Object.freeze([{version:2}]),()=>new Promise(resolve=>{release=resolve;}),()=>{reads++;},services,debt,code=>{throw Error(code);});assert.equal(debt.size,0);release(result);assert.equal(await pending,result);assert.equal(services.has(partial),true);assert.equal(debt.has(partial),true);assert.equal(reads,0);
});
test('PUBLIC actual ProductSession host route waits before emitting status/body and rejects failed async result',async()=>{
 const hostURL=new URL('../src/product-session-gateway-node-host.js',import.meta.url);let hostSource=readFileSync(hostURL,'utf8');hostSource=hostSource.replace("'./original-auth-identity-source-current.js'",JSON.stringify(moduleURL(absolute(source,url)+'\nexport const PUBLICselect=value=>{services.add(value);return value;};')));const {ProductSessionGatewayNodeHost}=await import(moduleURL(absolute(hostSource,hostURL)));const dir=mkdtempSync(join(tmpdir(),'ynx-PUBLIC-r185-host-'));
 try{let release;const owner=selected.PUBLICselect({current(){return new Promise(resolve=>{release=resolve;});}}),registry=JSON.parse(readFileSync(new URL('../product-session-registry.json',import.meta.url),'utf8')),host=new ProductSessionGatewayNodeHost(registry,{statePath:join(dir,'state'),now:()=>new Date(100),tokenFactory:()=> 'PUBLIC-token',authIdentitySourceCurrent:owner}),res=response();const pending=host.handler()({method:'GET',url:currentURL,headers:{}},res);await Promise.resolve();assert.equal(res.writes.length,0);release('PUBLIC host DATA');await pending;assert.equal(res.writes[0][0],200);assert.equal(res.body,'PUBLIC host DATA');owner.current=async()=>{throw false;};const rejected=response();await host.handler()({method:'GET',url:currentURL,headers:{}},rejected);assert.notEqual(rejected.writes[0][0],200);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('PUBLIC original daemon GET snippet awaits response and propagates original rejection',async()=>{
 const start=daemon.indexOf("    if(!originalAuthSourceCurrent){response.writeHead(503"),end=daemon.indexOf('\n  }',start),run=new AsyncFunction('originalAuthSourceCurrent','openOriginalAuthSourceCurrentRequest','request','response',daemon.slice(start,end));
 // Ordering-only PUBLIC owner adapter. The real request custody/completion and
 // cancellation boundaries are exercised by the R226 actual socket tests.
 const owner=current=>()=>{let result;return{bindOriginalHTTP(){},async run(){result=await current();},writeOriginalResponse(request,response){response.writeHead(result.status,result.headers);response.end(result.body);},retire(){},join(){},close(){}};};
 let release;const res=response(),pending=run({},owner(()=>new Promise(resolve=>{release=resolve;})),{method:'GET',url:currentURL},res);assert.equal(res.writes.length,0);release({status:200,headers:{},body:'PUBLIC daemon DATA'});await pending;assert.equal(res.body,'PUBLIC daemon DATA');for(const cause of [undefined,false,0]){const res=response();let caught=false;try{await run({},owner(async()=>{throw cause;}),{method:'GET',url:currentURL},res);}catch(e){caught=true;assert.equal(e,cause);}assert.equal(caught,true);assert.equal(res.writes.length,0);}
});
test('PUBLIC original startup snippet awaits loader and retains same partial/first falsy error and cleanup UNKNOWN',async()=>{
 const start=daemon.indexOf('const originalAuthSourceStartup=await '),end=daemon.indexOf('const originalProductHostOptions=',start),run=new AsyncFunction('loadOriginalAuthSourceCurrentService',daemon.slice(start,end)+'return originalAuthSourceCurrent;');let release;const pending=run(()=>new Promise(resolve=>{release=resolve;}));const counts=[];const partial={retire(){counts.push('retire');},join(){counts.push('join');},close(){counts.push('close');throw 0;}};release({partial,error:false});await assert.rejects(pending,e=>e.cause===false&&e.partial===partial&&e.cleanupCausePresent===true&&e.cleanupCause===0);assert.deepEqual(counts,['retire','join','close']);
});
