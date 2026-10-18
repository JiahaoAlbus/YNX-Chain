import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalJSON} from '../src/canonical.js';
const original=JSON.parse(readFileSync(new URL('../testdata/private-terminal-custody-r30.json',import.meta.url),'utf8'));
const data={input:JSON.parse(original.inputRaw),association:JSON.parse(original.associationRaw),before:JSON.parse(original.enteredRaw).stateBeforeDigest};
import {OriginalHostTerminalJournal} from '../src/original-host-terminal-journal.js';
// PUBLIC IO instrument only. Execute the actual owning JS journal, never a
// Native grant, protected installation, real terminal ACK or production key.
function fixture(record=null,seed=null){
 const files=new Map(seed??[]),owner={},loan={};let writes=0;
 const native={openOriginalHostTerminalJournal:()=>loan,assertOriginalHostTerminalJournalReady:()=>undefined,listOriginalHostTerminalJournal:()=>[...files.keys()],readOriginalHostTerminalJournal:(_loan,key)=>files.get(key),writeOriginalHostTerminalJournal(_loan,key,raw){assert(!files.has(key));writes++;files.set(key,raw);},retireOriginalHostTerminalJournal(){},joinOriginalHostTerminalJournal(){},closeOriginalHostTerminalJournal(){}};
 const load=Module._load;Module._load=function(name){if(name.endsWith('/apps/wallet-desktop/native/original-auth-identity.node'))return native;return load.apply(this,arguments);};
 const journal=new OriginalHostTerminalJournal('/PUBLIC/terminal-prepare.json',owner);try{journal.open();}finally{Module._load=load;}
 const input=record?.input??{requestId:'req_PUBLIC_PREPARE_00001',operation:'beginYNX',phase:'effect',body:'{}',proofHeader:null},association=record?.association??{account:'PUBLIC_ACCOUNT',clientId:'public-client',productId:'developer',platform:'macos',applicationId:'PUBLIC_APP',deviceId:'PUBLIC_DEVICE'};
 const claim=seed?null:journal.reserve(input,association,record?.before??'a'.repeat(64));return{journal,claim,files,get writes(){return writes;}};
}
test('owning journal prepares exact terminal before persistence without writing or acknowledging it',()=>{
 const f=fixture(),response={status:503,headers:{},body:'PUBLIC_NOT_A_GRANT'};
 assert.equal(f.journal.prepare(f.claim,response,'b'.repeat(64)),undefined);assert.equal(f.writes,1);assert.equal(f.files.size,1);assert.throws(()=>f.journal.assertTerminal(f.claim,response));
});
test('prepared terminal commits only the identical response and state digest',()=>{
 for(const mismatch of ['response','state']){
  const f=fixture(),response={status:503,headers:{},body:'PUBLIC_NOT_A_GRANT'};f.journal.prepare(f.claim,response,'b'.repeat(64));
  assert.throws(()=>f.journal.commit(f.claim,mismatch==='response'?{...response,body:'PUBLIC_CHANGED'}:response,(mismatch==='state'?'c':'b').repeat(64)));assert.equal(f.writes,1);assert.equal(f.journal.status().unknown,true);
 }
 const f=fixture(),response={status:503,headers:{},body:'PUBLIC_NOT_A_GRANT'};f.journal.prepare(f.claim,response,'b'.repeat(64));f.journal.commit(f.claim,response,'b'.repeat(64));f.journal.assertTerminal(f.claim,response);assert.equal(f.writes,2);assert.equal(f.files.size,2);f.journal.close();
});

test('owning journal consumes exact frozen R30a codec and retains the whole original response',()=>{
 const f=fixture(data),response=JSON.parse(original.responseRaw),after=JSON.parse(original.stateRaw).snapshotDigest;f.journal.prepare(f.claim,response,after);assert.equal(f.writes,1);f.journal.commit(f.claim,response,after);f.journal.assertTerminal(f.claim,response);
 const terminal=[...f.files].find(([name])=>name.endsWith('.terminal'))[1];assert.equal(JSON.parse(terminal).v,3);assert(Buffer.byteLength(terminal)<=8192);assert.equal(JSON.parse(terminal).e,createHash('sha256').update(original.enteredRaw).digest('hex'));assert.equal(JSON.parse(terminal).x,original.responseRaw);
 f.journal.close();const cold=fixture(null,f.files);assert.equal(cold.files.size,2);assert.equal(cold.writes,0);cold.journal.close();
});
test('R30 whole response overflow refuses in prepare before terminal write or any caller persistence',()=>{
 const f=fixture(data),response=JSON.parse(original.responseRaw),payload=JSON.parse(response.body);payload.result.PUBLIC_OVERFLOW='x'.repeat(8192);response.body=canonicalJSON(payload);
 assert.throws(()=>f.journal.prepare(f.claim,response,JSON.parse(original.stateRaw).snapshotDigest),e=>e.code==='TERMINAL_CUSTODY_CAPACITY');assert.equal(f.writes,1);assert.equal(f.files.size,1);assert.equal(f.journal.status().unknown,true);assert.equal(JSON.parse(response.body).result.PUBLIC_OVERFLOW.length,8192);
});

test('actual normal 52-byte Host output passes owning journal prepare and immutable readback at 7836 bytes',()=>{
 const normal=JSON.parse(readFileSync(new URL('../testdata/private-terminal-custody-r30a-normal-id.json',import.meta.url),'utf8')),record={input:JSON.parse(normal.inputRaw),association:JSON.parse(normal.associationRaw),before:JSON.parse(normal.enteredRaw).stateBeforeDigest},response=JSON.parse(normal.responseRaw),f=fixture(record);
 assert.equal(record.input.requestId.length,52);assert.equal(Buffer.byteLength(normal.responseRaw),7329);f.journal.prepare(f.claim,response,normal.stateAfterDigest);assert.equal(f.writes,1);f.journal.commit(f.claim,response,normal.stateAfterDigest);f.journal.assertTerminal(f.claim,response);
 const raw=[...f.files].find(([name])=>name.endsWith('.terminal'))[1];assert.equal(Buffer.byteLength(raw),7836);assert.equal(JSON.parse(raw).x,normal.responseRaw);assert.equal(JSON.parse(raw).e,createHash('sha256').update(normal.enteredRaw).digest('hex'));f.journal.close();
 const cold=fixture(null,f.files);assert.equal(cold.writes,0);assert.equal(cold.files.size,2);cold.journal.close();
});
test('v2 historical linked records remain readable without rewriting or promoting them to current authority',()=>{
 const entered=JSON.parse(original.enteredRaw),key=createHash('sha256').update(canonicalJSON({requestId:entered.requestId,operation:entered.operation,phase:entered.phase})).digest('hex'),files=new Map([[key+'.entered',original.enteredRaw],[key+'.terminal',original.terminalV2Raw]]),cold=fixture(null,files);assert.equal(cold.files.size,2);assert.equal(cold.writes,0);assert.equal(cold.files.get(key+'.terminal'),original.terminalV2Raw);cold.journal.close();
});
