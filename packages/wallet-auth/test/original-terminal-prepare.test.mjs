import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {OriginalHostTerminalJournal} from '../src/original-host-terminal-journal.js';
// PUBLIC IO instrument only. Execute the actual owning JS journal, never a
// Native grant, protected installation, real terminal ACK or production key.
function fixture(){
 const files=new Map(),owner={},loan={};let writes=0;
 const native={openOriginalHostTerminalJournal:()=>loan,assertOriginalHostTerminalJournalReady:()=>undefined,listOriginalHostTerminalJournal:()=>[],readOriginalHostTerminalJournal:(_loan,key)=>files.get(key),writeOriginalHostTerminalJournal(_loan,key,raw){assert(!files.has(key));writes++;files.set(key,raw);},retireOriginalHostTerminalJournal(){},joinOriginalHostTerminalJournal(){},closeOriginalHostTerminalJournal(){}};
 const load=Module._load;Module._load=function(name){if(name.endsWith('/apps/wallet-desktop/native/original-auth-identity.node'))return native;return load.apply(this,arguments);};
 const journal=new OriginalHostTerminalJournal('/PUBLIC/terminal-prepare.json',owner);try{journal.open();}finally{Module._load=load;}
 const input={requestId:'req_PUBLIC_PREPARE_00001',operation:'beginYNX',phase:'effect',body:'{}',proofHeader:null},association={account:'PUBLIC_ACCOUNT',clientId:'public-client',productId:'developer',platform:'macos',applicationId:'PUBLIC_APP',deviceId:'PUBLIC_DEVICE'};
 const claim=journal.reserve(input,association,'a'.repeat(64));return{journal,claim,files,get writes(){return writes;}};
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
