import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,Object.keys(v).sort());
const legacy=()=>({requestId:'req_PUBLIC_TERMINAL_0001',operation:'beginYNX',phase:'effect',body:'{}',proofHeader:null});
const pq=()=>({...legacy(),carrierVersion:'YNX-PRODUCT-SESSION-PRIVATE/v3',body:'{"approval":{"accountAuthorization":{"algorithmVersion":"YNX-BATCH/v0.1"},"version":"3","walletProof":"PUBLIC_SHAPE_ONLY_NOT_A_SIGNATURE"},"request":{"version":"2"}}'});
const association={account:'PUBLIC_ACCOUNT',clientId:'public-client',productId:'public-product',platform:'macos',applicationId:'public.application',deviceId:'public-device'};
const target=new URL('../src/original-host-terminal-journal.js',import.meta.url).pathname;
const {OriginalHostTerminalJournal}=await import(pathToFileURL(target));
function fixture(){
 const files=new Map(),calls={write:0,close:0};const owner={},loan={};let alive=false;
 // Explicit PUBLIC Native standin only. Real JS class executes unchanged;
 // this cannot recognize/qualify real Source/Native ownership or durable IO.
 const native={openOriginalHostTerminalJournal(got){assert.equal(got,owner);alive=true;return loan;},assertOriginalHostTerminalJournalReady(got){assert.equal(got,loan);assert(alive);},listOriginalHostTerminalJournal(){return [...files.keys()];},readOriginalHostTerminalJournal(got,key){assert.equal(got,loan);return files.get(key)??null;},writeOriginalHostTerminalJournal(got,key,raw){assert.equal(got,loan);assert(!files.has(key));calls.write++;files.set(key,raw);},retireOriginalHostTerminalJournal(){},joinOriginalHostTerminalJournal(){},closeOriginalHostTerminalJournal(){calls.close++;alive=false;}};
 const saved=Module._load;Module._load=function(request,parent,isMain){if(request.endsWith('/apps/wallet-desktop/native/original-auth-identity.node'))return native;return saved.apply(this,arguments);};
 const journal=new OriginalHostTerminalJournal('/PUBLIC/isolated-state.json',owner);try{journal.open();}finally{Module._load=saved;}
 return {journal,files,calls};
}
test('real terminal JS class accepts only purpose-specific six-field carrier and hashes complete marker',()=>{
 const {journal,files}=fixture(),input=pq(),claim=journal.reserve(input,association,'a'.repeat(64));
 const entered=JSON.parse([...files.values()][0]);assert.equal(entered.requestDigest,sha(canonical(input)));const {carrierVersion,...dropped}=input;assert.notEqual(entered.requestDigest,sha(canonical(dropped)));
 const response={status:503,headers:{},body:'PUBLIC_NOT_A_GRANT'};journal.commit(claim,response,'b'.repeat(64));journal.assertTerminal(claim,response);assert.equal(files.size,2);assert([...files.values()].every(raw=>Buffer.byteLength(raw)<=8192));journal.close();
});
test('legacy complete input digest remains unchanged',()=>{const {journal,files}=fixture(),input=legacy();journal.reserve(input,association,'a'.repeat(64));assert.equal(JSON.parse([...files.values()][0]).requestDigest,sha(canonical(input)));journal.close();});
test('unknown marker, wrong phase and wrong operation fail before any journal write',()=>{
 for(const edit of [v=>v.carrierVersion='other',v=>v.phase='time',v=>v.operation='restore']){const {journal,calls}=fixture(),v=pq();edit(v);assert.throws(()=>journal.reserve(v,association,'a'.repeat(64)));assert.equal(calls.write,0);journal.close();}
});
