import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
const canonical=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))])):x);
const sha=x=>createHash('sha256').update(x).digest('hex');
const input={requestId:'req_PUBLIC_REQUEST_001',operation:'handleReturn',phase:'effect',body:canonical({reference:'ynxpsr1_'+'A'.repeat(43),request:{version:'2'},completion:{challenge:{PUBLIC:true},deviceSignature:'PUBLIC'}}),proofHeader:null,carrierVersion:'YNX-PRODUCT-SESSION-PRIVATE/v4',referenceAction:'complete'},raw=canonical(input);
const association={account:'PUBLIC',clientId:'PUBLIC',productId:'developer',platform:'macos',applicationId:'PUBLIC',deviceId:'PUBLIC'},before='a'.repeat(64);
const entered=canonical({version:1,kind:'entered',requestDigest:sha(raw),associationDigest:sha(canonical(association)),operation:input.operation,phase:input.phase,requestId:input.requestId,stateBeforeDigest:before});
const makeChallenge=()=>({version:'YNX-AUTH-PERSISTENT-ENTERED/v1',requestId:input.requestId,originalRequestRaw:raw,binding:{requestDigest:sha(raw),enteredDigest:sha(entered),hostStateDigest:'b'.repeat(64)},witnessNonce:Buffer.alloc(32,1).toString('base64url'),dataOnly:true,nativeAdmission:false});
function fixture(options={}){
 const loan={},child={},events=[];let f,firstCurrent=0;
 const native={openOriginalHostTerminalJournal:()=>loan,assertOriginalHostTerminalJournalReady(o){assert.equal(o,loan);},listOriginalHostTerminalJournal:()=>[],readOriginalHostTerminalJournal(o,name){assert.equal(o,loan);events.push('journal.read');return options.enteredRaw??entered;},writeOriginalHostTerminalJournal(){events.push('journal.write');},retireOriginalHostTerminalJournal(){events.push('journal.retire');},joinOriginalHostTerminalJournal(){events.push('journal.join');},closeOriginalHostTerminalJournal(){events.push('journal.close');},captureOriginalPersistentFirstEnter(o,r){assert.equal(o,loan);assert.equal(r,raw);events.push('child.capture');options.onCapture?.(f);if(options.captureThrow)throw options.cause;return child;},assertOriginalPersistentFirstEnterReady(o){assert.equal(o,child);firstCurrent++;if(options.readyThrow||options.late&&firstCurrent>=options.late)throw options.cause;},copyOriginalPersistentFirstEnterChallenge(o){assert.equal(o,child);events.push('child.challenge');return options.challenge?options.challenge():makeChallenge();},acceptOriginalPersistentFirstEnterWitness(o,w){assert.equal(o,child);events.push('child.accept');options.onAccept?.(f);if(options.acceptThrow)throw options.cause;assert.equal(w,canonical({PUBLIC:'signed-but-not-real'}));}};
 for(const step of ['retire','join','close'])native[{retire:'retireOriginalPersistentFirstEnter',join:'joinOriginalPersistentFirstEnter',close:'closeOriginalPersistentFirstEnter'}[step]]=o=>{assert.equal(o,child);events.push('child.'+step);if(options.cleanupAt===step)throw options.cleanupCause;};
 if(options.missing)delete native[options.missing];
 let source=readFileSync(new URL('../src/original-host-terminal-journal.js',import.meta.url),'utf8').replace(/^import .*;$/mg,'').replace('export class OriginalHostTerminalJournal','class OriginalHostTerminalJournal').replaceAll('import.meta.url','PUBLIC_URL');
 const context=vm.createContext({Object,Buffer,URL,types,createHash,fileURLToPath,createRequire:()=>()=>native,PUBLIC_URL:new URL('../src/original-host-terminal-journal.js',import.meta.url).href,WalletAuthError:class extends Error{constructor(code,message){super(message);this.code=code;}},canonicalJSON:canonical,exactFields(value,fields){assert.deepEqual(Object.keys(value).sort(),Array.from(fields).sort());},originalPrivateCarrierBudget:()=>({envelope:65536}),prepareOriginalPrivateTerminalV3(){throw Error('unused PUBLIC seam');}});
 vm.runInContext(source+'\nthis.Journal=OriginalHostTerminalJournal;',context);f={journal:new context.Journal('/PUBLIC/HostState',{}),events};f.journal.open();return f;
}
// Actual production class, PUBLIC Native lifecycle seam; no real witness/grant.
test('R48 exact writer loan child accepts once and reserve reads existing entered without second write',()=>{
 const f=fixture(),c=f.journal.capturePersistentFirstEnter(raw);const d=c.copyChallenge();assert.equal(d.originalRequestRaw,raw);assert.equal(d.nativeAdmission,false);c.acceptWitness(canonical({PUBLIC:'signed-but-not-real'}));assert.equal(c.status().accepted,true);
 const claim=f.journal.reserve(input,association,before);assert(claim);assert.equal(f.events.filter(e=>e==='journal.write').length,0);assert.equal(f.events.filter(e=>e==='journal.read').length,1);assert.throws(()=>c.acceptWitness(canonical({PUBLIC:'signed-but-not-real'})));assert.equal(f.events.filter(e=>e==='child.accept').length,1);
 f.journal.close();const close=f.events.indexOf('child.close');assert(close<f.events.indexOf('journal.retire'));assert(close<f.events.indexOf('journal.close'));
});
for(const cause of [false,undefined])test('R48 partial ready '+String(cause)+' retains original cause and cleanup exactly once',()=>{
 const f=fixture({readyThrow:true,cause});assert.throws(()=>f.journal.capturePersistentFirstEnter(raw),e=>e===cause);const c=f.journal.getPersistentFirstEnterCleanup(raw);assert(c);assert.equal(c.status().firstCause,cause);f.journal.close();f.journal.close();assert.deepEqual(f.events,['child.capture','child.retire','child.join','child.close','journal.retire','journal.join','journal.close']);assert.throws(()=>f.journal.capturePersistentFirstEnter(raw),e=>e===cause);
});
test('R48 capture throw leaves unknown child custody and cannot close parent or recapture',()=>{
 const f=fixture({captureThrow:true,cause:undefined});assert.throws(()=>f.journal.capturePersistentFirstEnter(raw),e=>e===undefined);assert.throws(()=>f.journal.close(),{code:'FIRST_ENTER_CAPTURE_UNKNOWN'});assert.equal(f.events.includes('journal.close'),false);assert.equal(f.journal.status().cleanupComplete,false);assert.throws(()=>f.journal.close());assert.equal(f.events.filter(e=>e==='child.capture').length,1);
});
test('R48 missing ABI fails closed, no fallback',()=>{
 const f=fixture({missing:'acceptOriginalPersistentFirstEnterWitness'});assert.throws(()=>f.journal.capturePersistentFirstEnter(raw),{code:'FIRST_ENTER_IMPLEMENTATION_NOT_SUPPLIED'});assert.equal(f.events.includes('child.capture'),false);f.journal.close();
});
test('R48 retire fences cached challenge and accept without Native reentry',()=>{
 const f=fixture(),c=f.journal.capturePersistentFirstEnter(raw);c.copyChallenge();c.retire();assert.throws(()=>c.copyChallenge(),{code:'FIRST_ENTER_RETIRED'});assert.throws(()=>c.acceptWitness(canonical({PUBLIC:true})));assert.equal(f.events.includes('child.accept'),false);f.journal.close();
});
test('R48 accept late current failure remains unknown and no second accept or legacy write',()=>{
 const f=fixture({late:5,cause:false}),c=f.journal.capturePersistentFirstEnter(raw);c.copyChallenge();assert.throws(()=>c.acceptWitness(canonical({PUBLIC:'signed-but-not-real'})),e=>e===false);assert.equal(c.status().accepted,false);assert.throws(()=>c.acceptWitness(canonical({PUBLIC:'signed-but-not-real'})),e=>e===false);assert.throws(()=>f.journal.reserve(input,association,before));assert.equal(f.events.includes('journal.write'),false);f.journal.close();
});
test('R48 exact entered digest and original association/stateBefore checked before claim',()=>{
 const f=fixture({enteredRaw:entered+' '}),c=f.journal.capturePersistentFirstEnter(raw);c.copyChallenge();c.acceptWitness(canonical({PUBLIC:'signed-but-not-real'}));assert.throws(()=>f.journal.reserve(input,association,before));assert.equal(f.events.includes('journal.write'),false);f.journal.close();
});
test('R48 strict challenge rejects proxies/accessors/symbols/extra/flags/binding and preserves partial cleanup',()=>{
 let touched=false;
 const variants=[()=>({...makeChallenge(),extra:true}),()=>({...makeChallenge(),nativeAdmission:true}),()=>({...makeChallenge(),originalRequestRaw:raw+' '}),()=>({...makeChallenge(),binding:{...makeChallenge().binding,requestDigest:'f'.repeat(64)}}),()=>new Proxy(makeChallenge(),{get(){touched=true;throw Error('PUBLIC');}}),()=>{const c=makeChallenge();Object.defineProperty(c,'requestId',{get(){touched=true;throw Error('PUBLIC');},enumerable:true});return c;},()=>({...makeChallenge(),[Symbol('extra')]:true})];
 for(const challenge of variants){const f=fixture({challenge}),c=f.journal.capturePersistentFirstEnter(raw);assert.throws(()=>c.copyChallenge(),{code:'FIRST_ENTER_DATA_INVALID'});f.journal.close();}assert.equal(touched,false);
});
test('R48 child cleanup failure prevents parent close and retains separate original primitive',()=>{
 const f=fixture({readyThrow:true,cause:false,cleanupAt:'close',cleanupCause:undefined});assert.throws(()=>f.journal.capturePersistentFirstEnter(raw),e=>e===false);assert.throws(()=>f.journal.close(),e=>e===undefined);assert.equal(f.journal.status().firstCause,false);assert.equal(f.journal.status().cleanupCause,undefined);assert.equal(f.journal.status().cleanupComplete,false);assert.equal(f.events.includes('journal.close'),false);assert.throws(()=>f.journal.close(),e=>e===undefined);assert.equal(f.events.filter(e=>e==='child.close').length,1);
});
test('R48 synchronous cancellation during partial capture retains returned owner and drains child before parent',()=>{
 let first;const f=fixture({onCapture(f){assert.throws(()=>f.journal.close(),error=>{first=error;return error.code==='FIRST_ENTER_JOIN_PENDING';});assert.equal(f.events.includes('journal.close'),false);}});
 assert.throws(()=>f.journal.capturePersistentFirstEnter(raw));assert.throws(()=>f.journal.close(),error=>error===first);assert.equal(f.events.filter(e=>e==='child.close').length,1);assert.equal(f.events.filter(e=>e==='journal.close').length,1);assert(f.events.indexOf('child.close')<f.events.indexOf('journal.close'));assert.equal(f.journal.status().cleanupComplete,false);assert.throws(()=>f.journal.close(),error=>error===first);assert.equal(f.events.filter(e=>e==='child.close').length,1);
});
test('R48 synchronous cancellation during accept never closes child or parent while active',()=>{
 let cleanup;const f=fixture({onAccept(f){assert.throws(()=>f.journal.close(),error=>{cleanup=error;return error.code==='FIRST_ENTER_JOIN_PENDING';});assert.equal(f.events.includes('child.close'),false);assert.equal(f.events.includes('journal.close'),false);}}),c=f.journal.capturePersistentFirstEnter(raw);c.copyChallenge();assert.throws(()=>c.acceptWitness(canonical({PUBLIC:'signed-but-not-real'})));assert.equal(c.status().accepted,false);assert.throws(()=>f.journal.close(),error=>error===cleanup);assert.equal(f.events.filter(e=>e==='child.accept').length,1);assert.equal(f.events.filter(e=>e==='child.close').length,1);assert.equal(f.events.filter(e=>e==='journal.close').length,1);
});
test('R48 direct parent retire during capture preflight drains child fully before all parent Native steps',()=>{
 let cleanup;const f=fixture({onCapture(f){assert.throws(()=>f.journal.retire(),error=>{cleanup=error;return error.code==='FIRST_ENTER_JOIN_PENDING';});assert.equal(f.events.includes('journal.retire'),false);assert.throws(()=>f.journal.join(),{code:'HOST_TERMINAL_JOIN_PENDING'});assert.equal(f.events.includes('journal.join'),false);}});
 assert.throws(()=>f.journal.capturePersistentFirstEnter(raw));assert.throws(()=>f.journal.close(),error=>error===cleanup);assert.deepEqual(f.events,['child.capture','child.retire','child.join','child.close','journal.retire','journal.join','journal.close']);
});
test('R48 direct parent retire closes existing child before Native parent retirement',()=>{
 const f=fixture();f.journal.capturePersistentFirstEnter(raw);f.journal.retire();assert.deepEqual(f.events,['child.capture','child.retire','child.join','child.close','journal.retire']);f.journal.close();assert.deepEqual(f.events,['child.capture','child.retire','child.join','child.close','journal.retire','journal.join','journal.close']);
});
