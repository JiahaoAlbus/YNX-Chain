import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// PUBLIC Native/math seams, not Source, Root, approval or key custody. Execute
// the supplier's exact lifecycle kernel with the real IDE private bridge.
const kernelPath=process.env.YNX_IDE_PEER_KERNEL_SOURCE||(process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT?join(process.env.YNX_DEVELOPER_CANONICAL_SDK_ROOT,'src/original-identity-peer-runtime.js'):undefined);
const entry='file:///Applications/YNX%20Developer.app/Contents/Resources/server.mjs';
async function fixture(run){
  const root=await mkdtemp(join(tmpdir(),'ynx-private-peer-'));
  try{
    const desktop=join(root,'apps/developer/desktop'),sdk=join(root,'packages/wallet-auth');
    await mkdir(desktop,{recursive:true});await mkdir(join(sdk,'src'),{recursive:true});await mkdir(join(sdk,'native'));
    await copyFile(fileURLToPath(new URL('./wallet-identity-v2-caller.mjs',import.meta.url)),join(desktop,'wallet-identity-v2-caller.mjs'));
    const kernel=await readFile(kernelPath);assert.equal(kernel.length,7234);assert.equal(createHash('sha256').update(kernel).digest('hex'),'edf39c3ddcfe3ac7ce675804da2b3dcbc179b03982d5bb115859002232c7d244');
    await writeFile(join(sdk,'src/original-identity-peer-runtime.js'),kernel);
    await writeFile(join(sdk,'package.json'),'{"type":"module"}');
    await writeFile(join(sdk,'src/canonical.js'),'export const canonicalJSON=JSON.stringify;');
    await writeFile(join(sdk,'native/original-auth-identity-v2-contract.mjs'),`
      export const AUTH_IDENTITY_PURPOSES={receive:'AUTH-IDENTITY-RECEIVE',recover:'AUTH-IDENTITY-RECOVER',keyCall:'AUTH-PROTECTED-KEY-CALL'};
      export const parseOriginalAuthIdentityRequest=JSON.parse;
      export function encodeOriginalAuthIdentityRequest(){return new Uint8Array([69]);}
    `);
    await writeFile(join(sdk,'src/original-ide-admission-parent-delivery.js'),`
      export const events=[],control={};let borrowed=false,closed=false;
      const request=()=>JSON.stringify({requestId:'PUBLIC_REQUEST',purpose:control.purpose||'AUTH-IDENTITY-RECEIVE',expiresAtMs:999999});
      const parent={assertReady(){events.push('parent.ready');},current(){events.push('parent.current');},copyRequestOriginal:request,
        completeProof(){events.push('parent.proof');},result(){events.push('parent.result');return 'PUBLIC_RESULT';},invoke(){events.push('parent.invoke');return 'PUBLIC_INVOKE';},
        retire(){events.push('parent.retire');},join(){events.push('parent.join');if(borrowed&&!closed)throw Error('PUBLIC_CHILD_STILL_BORROWED');},close(){events.push('parent.close');},status(){return {ready:false,unknown:true};}};
      const peer={current(){events.push('peer.current');if(control.failCurrent)throw control.currentCause;},
        sendRequest(...args){events.push(['peer.send',args.length,...args]);return control.sendPending||Promise.resolve();},
        receiveReturn(){events.push('peer.receive');return control.returnPending||Promise.resolve({decision:'approve',requestId:'PUBLIC_REQUEST',purpose:control.purpose||'AUTH-IDENTITY-RECEIVE',proof:new Uint8Array([1])});},
        retire(){events.push('peer.retire');if(control.failRetire)throw control.retireCause;},
        join(){events.push('peer.join');},close(){events.push('peer.close');closed=true;if(control.failClose)throw control.closeCause;}};
      const binding={receiveOriginalIDEIdentity(){events.push('parent.construct');return parent;},recoverOriginalIDEIdentity(){events.push('parent.construct');return parent;},acquireOriginalIDEProtectedKeyCall(){events.push('parent.construct');return parent;}};
      export function acquireOriginalIDENativeAuthBinding(){return binding;}
      export function acquireOriginalIDEIdentityPeerBinding(actualEntry){events.push(['peer.getter',actualEntry]);if(control.failGetter)throw control.getterCause;if(control.missing)return null;
        return Object.defineProperty({},'acquireOriginalIDEIdentityPeerChannel',{get(){control.onFactoryLookup?.();return (actualEntry,owner)=>{if(owner!==parent)throw Error('PUBLIC_WRONG_OWNER');events.push(['peer.factory',actualEntry,true]);borrowed=true;control.onFactory?.();return peer;};}});}
    `);
    const original=await import(pathToFileURL(join(sdk,'src/original-ide-admission-parent-delivery.js')));
    const contract=await import(pathToFileURL(join(sdk,'native/original-auth-identity-v2-contract.mjs')));
    const {OriginalIDEIdentityCall}=await import(pathToFileURL(join(desktop,'wallet-identity-v2-caller.mjs')));
    const caller=new OriginalIDEIdentityCall({binding:original.acquireOriginalIDENativeAuthBinding(),actualEntryURL:entry,contract});
    await run({...original,caller});
  }finally{await rm(root,{recursive:true,force:true});}
}
const controlTest=(name,run)=>test(name,{timeout:5000,skip:!kernelPath?'Matching canonical peer lifecycle kernel not supplied; no native acceptance claimed.':false},()=>fixture(run));
async function waitFor(predicate){const end=Date.now()+2000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setImmediate(resolve));assert.ok(predicate(),'Expected controlled Native operation did not enter.');}

controlTest('fixed peer factory is lazy after begin, sees SAME hidden owner, and sends exactly three arguments',async f=>{
  const one=f.caller.openPeerCall(),two=f.caller.openPeerCall();assert.equal(one,two);const call=await one;
  assert.deepEqual(f.events,[]);assert.equal(Object.keys(f.caller).length,0);
  await call.begin('receive');const sent=f.events.find(e=>Array.isArray(e)&&e[0]==='peer.send');
  assert.equal(sent[1],3);assert.equal(sent[2],'receive');assert.equal(sent[4],undefined);
  assert.ok(f.events.indexOf('parent.construct')<f.events.findIndex(e=>Array.isArray(e)&&e[0]==='peer.getter'));
  assert.equal(await call.waitForReturn(),'PUBLIC_RESULT');await call.close();
  assert.ok(f.events.indexOf('peer.close')<f.events.indexOf('parent.join'));
  assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='peer.factory').length,1);
  assert.equal(f.events.filter(e=>e==='peer.close').length,1);assert.equal(f.events.filter(e=>e==='parent.close').length,1);
});
controlTest('protected calls keep operation-specific originals and invoke once',async f=>{
  f.control.purpose='AUTH-PROTECTED-KEY-CALL';const call=await f.caller.openPeerCall();const raw='{"PUBLIC_INVOCATION":true}';
  await call.begin('keyCall',raw);const sent=f.events.find(e=>Array.isArray(e)&&e[0]==='peer.send');assert.deepEqual(sent.slice(1,3),[3,'keyCall']);assert.equal(sent[4],raw);
  assert.equal(await call.waitForReturn(),'PUBLIC_INVOKE');await assert.rejects(async()=>call.waitForReturn(),/RETURN_ONCE/);await call.close();assert.equal(f.events.filter(e=>e==='parent.invoke').length,1);
});
controlTest('recovery uses its own original purpose and no invocation selector',async f=>{
  f.control.purpose='AUTH-IDENTITY-RECOVER';const call=await f.caller.openPeerCall();await call.begin('recover');
  const sent=f.events.find(e=>Array.isArray(e)&&e[0]==='peer.send');assert.equal(sent[2],'recover');assert.equal(sent[4],undefined);
  assert.equal(await call.waitForReturn(),'PUBLIC_RESULT');await call.close();
});
controlTest('returned partial survives a falsy current failure and closes child before parent',async f=>{
  f.control.failCurrent=true;f.control.currentCause=undefined;const call=await f.caller.openPeerCall();let caught=false;
  try{await call.begin('receive');}catch(e){caught=true;assert.equal(e,undefined);}assert.ok(caught);
  await call.close();assert.equal(f.events.filter(e=>e==='peer.close').length,1);assert.ok(f.events.indexOf('peer.close')<f.events.indexOf('parent.join'));
  assert.equal(call.outcome().firstCausePresent,true);assert.equal(call.outcome().firstCause,undefined);
});
controlTest('reentrant retirement during factory captures the late partial and fences parent join',async f=>{
  const call=await f.caller.openPeerCall();f.control.onFactory=()=>{call.retire();assert.throws(()=>f.caller.join(),{code:'IDE_IDENTITY_JOIN_PENDING'});};
  await assert.rejects(call.begin('receive'),{code:'IDE_IDENTITY_CALL_RETIRED'});await call.close();
  assert.equal(f.events.filter(e=>e==='peer.retire').length,1);assert.equal(f.events.filter(e=>e==='peer.close').length,1);assert.equal(f.events.filter(e=>e==='parent.close').length,1);
});
controlTest('absent fixed table refuses without fallback or request replay and parent remains cleanable',async f=>{
  f.control.missing=true;const call=await f.caller.openPeerCall();await assert.rejects(call.begin('receive'),{code:'IDE_IDENTITY_PEER_UNAVAILABLE'});await call.close();
  assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='peer.factory').length,0);assert.equal(f.events.filter(e=>e==='parent.construct').length,1);assert.equal(f.events.filter(e=>e==='parent.close').length,1);
});
controlTest('the original fixed getter falsy failure stays the same failure and never enters a factory',async f=>{
  f.control.failGetter=true;f.control.getterCause=false;const call=await f.caller.openPeerCall();
  await assert.rejects(call.begin('receive'),e=>e===false);await call.close();
  assert.equal(call.outcome().firstCause,false);assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='peer.factory').length,0);assert.equal(f.events.filter(e=>e==='parent.close').length,1);
});
controlTest('retirement reentered by factory lookup never calls that factory',async f=>{
  const call=await f.caller.openPeerCall();f.control.onFactoryLookup=()=>{call.retire();assert.throws(()=>f.caller.join(),{code:'IDE_IDENTITY_JOIN_PENDING'});};
  await assert.rejects(call.begin('receive'),{code:'IDE_IDENTITY_CALL_RETIRED'});await call.close();
  assert.equal(f.events.filter(e=>Array.isArray(e)&&e[0]==='peer.factory').length,0);assert.equal(f.events.filter(e=>e==='parent.close').length,1);
});
controlTest('a falsy child close failure retains cleanup debt and cannot close the parent or replay close',async f=>{
  const call=await f.caller.openPeerCall();await call.begin('receive');f.control.failClose=true;f.control.closeCause=undefined;
  let rejected=false;try{await call.close();}catch(e){rejected=true;assert.equal(e,undefined);}assert.ok(rejected);
  try{await call.close();}catch(e){assert.equal(e,undefined);}
  assert.equal(f.events.filter(e=>e==='peer.close').length,1);assert.equal(f.events.includes('parent.close'),false);assert.equal(call.outcome().firstCausePresent,true);
});
controlTest('retirement while send is pending cannot advance to receive, proof or effects',async f=>{
  let resolveSend;f.control.sendPending=new Promise(resolve=>resolveSend=resolve);const call=await f.caller.openPeerCall();const pending=call.begin('receive');
  await waitFor(()=>f.events.some(e=>Array.isArray(e)&&e[0]==='peer.send'));
  call.retire();resolveSend();await assert.rejects(pending,{code:'IDE_IDENTITY_CALL_RETIRED'});await call.close();
  for(const e of ['peer.receive','parent.proof','parent.invoke','parent.result'])assert.equal(f.events.includes(e),false);
});
controlTest('late returned proof after cancellation is retained internally and cannot invoke an effect',async f=>{
  const call=await f.caller.openPeerCall();await call.begin('receive');let resolveReturn;f.control.returnPending=new Promise(resolve=>resolveReturn=resolve);
  const pending=call.waitForReturn();await waitFor(()=>f.events.includes('peer.receive'));call.retire();
  resolveReturn({decision:'approve',requestId:'PUBLIC_REQUEST',purpose:'AUTH-IDENTITY-RECEIVE',proof:new Uint8Array([1])});await assert.rejects(pending,{code:'IDE_IDENTITY_CALL_RETIRED'});await call.close();assert.equal(f.events.includes('parent.proof'),false);assert.equal(f.events.includes('parent.result'),false);
});
