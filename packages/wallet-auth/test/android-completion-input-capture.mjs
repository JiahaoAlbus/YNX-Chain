import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const [sourcePath,queryPath,mode]=process.argv.slice(2);
const source=fs.readFileSync(sourcePath,'utf8');
const marker='export async function acquireOriginalProductPairPendingCompletionReaderV4';
assert.equal(source.split(marker).length,2);
const capture=source.includes('// Detach caller bytes synchronously')?source.slice(source.indexOf('// Detach caller bytes synchronously'),source.indexOf('// Same protected pair-service resources and original independent Source/current.')):'';
// PUBLIC ports only: approval is observed at a test seam; the Store stops
// with a sentinel before candidate return. No positive admission or signing.
const fixture=`
import {types} from 'node:util';
import {createHash} from 'node:crypto';
import {decodePendingPairOriginalQueryDATA} from ${JSON.stringify(pathToFileURL(queryPath).href)};
const fail=c=>{throw Object.assign(Error(c),{code:c})};
const pairV4Digest=b=>createHash('sha256').update(b).digest('hex');
const verifyProductSessionApprovalV4Data=(_registry,_request,approval)=>events.approval=approval.marker;
const productPairSessionV4ActorDATA=()=> 'public-fixture-actor';
const inspectProductSessionDeviceRegistrationOriginalV4Data=()=>({record:{}});
export const events={acquires:0,reads:0};
export const stop=Error('PUBLIC_STOP_BEFORE_CANDIDATE');
let gate;
export const hold=()=>{let resolve;gate=new Promise(r=>resolve=r);return resolve;};
const parent={store:{assertCurrent(){},readPendingCompletionOriginalsDATA({queryOriginal,originalPairPost}){events.reads++;events.query=queryOriginal.toString();events.post=originalPairPost.toString();throw stop}},source:{async acquire(){events.acquires++;await gate;return{recheck(){},assertCurrent(){},retire(){},join(){},close(){}}}},retire(){},join(){},close(){}};
async function acquireOriginalPairServiceResources(){return {owner:parent,error:undefined}}
`;
const mod=await import('data:text/javascript;base64,'+Buffer.from(fixture+capture+marker+source.split(marker)[1]).toString('base64'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const operationId='1'.repeat(64),completionOperationId='2'.repeat(64);
const postFor=marker=>Buffer.from(JSON.stringify({operationId,request:{},registrationOriginal:'{}',approval:{account:'PUBLIC',marker}}));
const queryFor=post=>Buffer.from(JSON.stringify({operationId,originalRequestBodyDigest:sha(post),version:'1'}));
const fresh=()=>{const originalPairPost=postFor('A');return{profileBodyOriginal:'{}',queryOriginal:queryFor(originalPairPost),originalPairPost,completionOperationId}};
const read=async (input,beforeRelease)=>{
 const {owner}=await mod.acquireOriginalProductPairPendingCompletionReaderV4();
 const release=mod.hold();const pending=owner.readOriginalCompletionCandidateDATA(input);
 beforeRelease?.();release();const result=await pending;
 await owner.close().catch(error=>assert.equal(error,result.error));
 return result;
};
const input=fresh(),postA=input.originalPairPost.toString(),queryA=input.queryOriginal.toString();
const result=await read(input,()=>{const postB=postFor('B');postB.copy(input.originalPairPost);queryFor(postB).copy(input.queryOriginal)});
assert.equal(result.error,mod.stop);assert.equal(mod.events.approval,'A');
if(mode==='reproduce'){
 assert.notEqual(mod.events.post,postA);assert.notEqual(mod.events.query,queryA);
 console.log('RED REPRODUCED: approval A reaches Store with paired POST B and query B');process.exit(0);
}
assert.equal(mod.events.post,postA);assert.equal(mod.events.query,queryA);
console.log('same captured POST/query bytes across Source await');
const cases=[
 ['query digest mismatch',v=>{v.queryOriginal=queryFor(postFor('B'))},'PENDING_COMPLETION_ORIGINAL_QUERY_BINDING'],
 ['invalid UTF-8',v=>{v.originalPairPost[0]=0xff;v.queryOriginal=queryFor(v.originalPairPost)},'PENDING_COMPLETION_ORIGINAL_POST_INVALID'],
 ['SharedArrayBuffer',v=>{v.originalPairPost=Buffer.from(new SharedArrayBuffer(8))},'PENDING_COMPLETION_ORIGINAL_BUFFER_INVALID'],
 ['buffer proxy',v=>{v.originalPairPost=new Proxy(v.originalPairPost,{})},'PENDING_COMPLETION_ORIGINAL_BUFFER_REQUIRED'],
 ['bounded post',v=>{v.originalPairPost=Buffer.alloc(393217)},'PENDING_COMPLETION_ORIGINAL_BUFFER_INVALID'],
 ['distinct operation',v=>{v.completionOperationId=operationId},'PENDING_COMPLETION_DISTINCT_OPERATION_REQUIRED']
];
for(const [name,edit,code] of cases){
 const v=fresh();edit(v);
 const before=mod.events.acquires;
 const denied=await read(v);
 assert.equal(denied.errorPresent,true);assert.equal(denied.error?.code,code);assert.equal(mod.events.acquires,before);
 console.log(name+' refused before Source borrow');
}
for(const key of Object.keys(fresh())){
 let invoked=0;const v=fresh();Object.defineProperty(v,key,{get(){invoked++;throw Error('getter invoked')}});
 const before=mod.events.acquires,denied=await read(v);
 assert.equal(denied.error?.code,'PAIR_V4_SOURCE_SCHEMA');assert.equal(invoked,0);assert.equal(mod.events.acquires,before);
 console.log(key+' getter refused without invocation');
}
let traps=0;
const trap=()=>{traps++;throw Error('trap invoked')};
const proxy=new Proxy(fresh(),{get:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap,ownKeys:trap});
const beforeProxy=mod.events.acquires;
assert.equal((await read(proxy)).error?.code,'PAIR_V4_SOURCE_SCHEMA');
assert.equal(traps,0);assert.equal(mod.events.acquires,beforeProxy);
console.log('input Proxy refused without reflection traps');
const override=fresh();override.originalPairPost.toString=()=>assert.fail('caller method invoked');
assert.equal((await read(override)).error,mod.stop);
console.log('caller Buffer method not invoked');
