import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
function fixture(options={}){
 const {failAt,cause,readyFailure=false,captureFailure=false}=options,cleanupCause=Object.hasOwn(options,'cleanupCause')?options.cleanupCause:'PUBLIC_CLEANUP';
 const loan={},events=[];let captures=0;
 const native={openOriginalHostTerminalJournal(){captures++;if(captureFailure)throw cause;return loan;},assertOriginalHostTerminalJournalReady(o){assert.equal(o,loan);if(readyFailure)throw cause;},listOriginalHostTerminalJournal:()=>options.readFailure?['a'.repeat(64)+'.entered','a'.repeat(64)+'.terminal']:[],readOriginalHostTerminalJournal(){throw cause;},writeOriginalHostTerminalJournal(){options.onWrite?.();}};
 for(const [key,name] of [['retire','retireOriginalHostTerminalJournal'],['join','joinOriginalHostTerminalJournal'],['close','closeOriginalHostTerminalJournal']])native[name]=o=>{assert.equal(o,loan);events.push(key);if(options.failures&&Object.hasOwn(options.failures,key))throw options.failures[key];if(key===failAt)throw cleanupCause;if(options.incomplete===key)return false;};
 const source=readFileSync(new URL('../src/original-host-terminal-journal.js',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replace('export class OriginalHostTerminalJournal','class OriginalHostTerminalJournal').replaceAll('import.meta.url','PUBLIC_URL');
 const context=vm.createContext({Buffer,URL,createHash,fileURLToPath,createRequire:()=>()=>native,PUBLIC_URL:new URL('../src/original-host-terminal-journal.js',import.meta.url).href,WalletAuthError:class extends Error{constructor(code,message){super(message);this.code=code;}},canonicalJSON:JSON.stringify,exactFields(value,fields){assert.deepEqual(Object.keys(value).sort(),Array.from(fields).sort());},originalPrivateCarrierBudget:()=>({envelope:65536}),prepareOriginalPrivateTerminalV3(){throw Error('unused PUBLIC seam');}});
 vm.runInContext(source+'\nthis.Journal=OriginalHostTerminalJournal;',context);
 return {journal:new context.Journal('/PUBLIC/HostState',{}),events,captures:()=>captures};
}
// PUBLIC lexical Native seam only: actual production class lifecycle, no grants.
for(const failAt of ['retire','join','close'])test('cleanup '+failAt+' failure is latched separately and each Native method selected once',()=>{
 const f=fixture({failAt,cleanupCause:false});f.journal.open();assert.throws(()=>f.journal.close(),e=>e===false);assert.equal(f.journal.status().cleanupCausePresent,true);assert.equal(f.journal.status().cleanupCause,false);assert.equal(f.journal.status().cleanupComplete,false);assert.equal(f.journal.status().unknown,true);assert.deepEqual(f.events,['retire','join','close']);assert.throws(()=>f.journal.close(),e=>e===false);assert.deepEqual(f.events,['retire','join','close']);
});
test('partial readiness first cause remains distinct from undefined cleanup failure',()=>{
 const f=fixture({readyFailure:true,cause:false,failAt:'retire',cleanupCause:undefined});assert.throws(()=>f.journal.open(),e=>e===false);assert.throws(()=>f.journal.close(),e=>e===undefined);const status=f.journal.status();assert.equal(status.firstCausePresent,true);assert.equal(status.firstCause,false);assert.equal(status.cleanupCausePresent,true);assert.equal(status.cleanupCause,undefined);assert.equal(status.cleanupComplete,false);assert.deepEqual(f.events,['retire','join','close']);
});
test('capture throw retains unknown resources and first cause without second open',()=>{
 const f=fixture({captureFailure:true,cause:undefined});assert.throws(()=>f.journal.open(),e=>e===undefined);assert.throws(()=>f.journal.close(),{code:'HOST_TERMINAL_CLOSE_UNKNOWN'});assert.equal(f.journal.status().firstCause,undefined);assert.equal(f.journal.status().cleanupCausePresent,true);assert.equal(f.journal.status().cleanupComplete,false);assert.equal(f.journal.status().unknown,true);assert.throws(()=>f.journal.open());assert.throws(()=>f.journal.close(),{code:'HOST_TERMINAL_CLOSE_UNKNOWN'});assert.equal(f.captures(),1);assert.deepEqual(f.events,[]);
});
test('manual retirement failure cannot be replayed by close',()=>{
 const f=fixture({failAt:'retire',cleanupCause:'PUBLIC_RETIRE'});f.journal.open();assert.throws(()=>f.journal.retire(),e=>e==='PUBLIC_RETIRE');assert.throws(()=>f.journal.close(),e=>e==='PUBLIC_RETIRE');assert.deepEqual(f.events,['retire','join','close']);assert.throws(()=>f.journal.retire(),e=>e==='PUBLIC_RETIRE');assert.deepEqual(f.events,['retire','join','close']);
});
test('successful close idempotent and unopened close owns no Native resources',()=>{
 const f=fixture();f.journal.open();f.journal.close();f.journal.close();f.journal.retire();f.journal.join();assert.deepEqual(f.events,['retire','join','close']);assert.equal(f.journal.status().cleanupComplete,true);assert.equal(f.journal.status().cleanupCausePresent,false);assert.throws(()=>f.journal.open());
 const g=fixture();g.journal.close();g.journal.close();assert.equal(g.journal.status().cleanupComplete,true);assert.deepEqual(g.events,[]);assert.equal(g.captures(),0);
});
test('actual journal read rejection retains first cause separately from all cleanup failures',()=>{
 const f=fixture({readFailure:true,cause:'PUBLIC_READ',failures:{retire:undefined,join:false,close:'PUBLIC_CLOSE'}});assert.throws(()=>f.journal.open(),e=>e==='PUBLIC_READ');assert.throws(()=>f.journal.close(),e=>e===undefined);const s=f.journal.status();assert.equal(s.firstCause,'PUBLIC_READ');assert.equal(s.cleanupCausePresent,true);assert.equal(s.cleanupCause,undefined);assert.equal(s.cleanupComplete,false);assert.deepEqual(f.events,['retire','join','close']);assert.throws(()=>f.journal.close(),e=>e===undefined);assert.deepEqual(f.events,['retire','join','close']);
});
for(const incomplete of ['retire','join','close'])test('non-undefined '+incomplete+' result preserves cleanup debt despite later close',()=>{
 const f=fixture({incomplete});f.journal.open();assert.throws(()=>f.journal.close());assert.equal(f.journal.status().cleanupComplete,false);assert.equal(f.journal.status().cleanupCausePresent,true);assert.equal(f.journal.status().unknown,true);assert.deepEqual(f.events,['retire','join','close']);assert.throws(()=>f.journal.close());assert.deepEqual(f.events,['retire','join','close']);
});
test('synchronous close reentry during active reserve never closes live Native dirfd or replays work',()=>{
 let f,writes=0,cleanupError;
 f=fixture({onWrite(){writes++;assert.throws(()=>f.journal.close(),error=>{cleanupError=error;return error.code==='HOST_TERMINAL_JOIN_PENDING';});assert.deepEqual(f.events,['retire']);assert.equal(f.journal.status().cleanupComplete,false);}});
 f.journal.open();const input={requestId:'req_PUBLIC_REQUEST_001',operation:'restore',phase:'time',body:null,proofHeader:null},association={account:'PUBLIC',clientId:'PUBLIC',productId:'developer',platform:'macos',applicationId:'PUBLIC',deviceId:'PUBLIC'};
 assert.throws(()=>f.journal.reserve(input,association,'a'.repeat(64)),{code:'HOST_TERMINAL_UNRESOLVED'});
 assert.equal(f.journal.status().firstCause,cleanupError);assert.equal(f.journal.status().cleanupCause,cleanupError);assert.equal(f.journal.status().unknown,true);assert.equal(f.journal.status().cleanupComplete,false);
 assert.throws(()=>f.journal.reserve(input,association,'a'.repeat(64)),{code:'HOST_TERMINAL_UNRESOLVED'});assert.equal(writes,1);
 assert.throws(()=>f.journal.close(),error=>error===cleanupError);assert.throws(()=>f.journal.join(),error=>error===cleanupError);f.journal.retire();assert.deepEqual(f.events,['retire']);
});
