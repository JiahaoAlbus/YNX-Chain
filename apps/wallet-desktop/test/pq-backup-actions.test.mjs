import test from 'node:test';
import assert from 'node:assert/strict';
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
const load=()=>import('../src/pq-backup-actions.mjs');
const account='0x'+'1'.repeat(40),networkId='2'.repeat(64);
async function fixture(){
 const {createPQBackupActions}=await load();let exports=0,reads=0,restores=0,retires=0;
 const lifecycle=new DesktopKeyLifecycle({authorizer:{available:()=>true,authenticate:async()=>{},inProcess:true},focused:()=>true,schedule:()=>null,unschedule:()=>{}});lifecycle.setAccount(account);await lifecycle.unlock();
 const wire=new Uint8Array([1,2,3]),binding={owner:account,chainId:networkId},handle={},credential='TEST-ONLY-INDEPENDENT-CREDENTIAL';
 const vault={readPQProposalBinding:async id=>{assert.equal(id,networkId);return binding;},withPQBackup:async(id,action)=>{assert.equal(id,networkId);return action({wire:new Uint8Array(wire),credential,binding},lifecycle.current());}};
 const sdk={restorePQWalletKeyHandle:async(bytes,key,expected)=>{assert.deepEqual(bytes,wire);assert.equal(key,credential);assert.equal(expected,binding);restores++;return handle;},readPQWalletKeyPublic:()=>binding,assertPQPublicBindingMatches:(a,b)=>assert.equal(a,b),destroyPQWalletKeyHandle:h=>{assert.equal(h,handle);retires++;return true;}};
 const files={write:async(file,bytes,guard)=>{guard.assert();assert.equal(file,'TEST-normal-dialog-path');assert.deepEqual(bytes,wire);exports++;},read:async()=>{reads++;return new Uint8Array(wire);}};
 const choices={export:async()=> 'TEST-normal-dialog-path',verify:async()=> 'TEST-normal-dialog-path'};
 const actions=createPQBackupActions({lifecycle,vault,sdk,networkId,files,chooseExportFile:()=>choices.export(),chooseVerifyFile:()=>choices.verify()});
 return {actions,lifecycle,sdk,files,choices,counts:()=>({exports,reads,restores,retires}),credential};
}
test('PQ backup normal export verifies exact original and retires imported keys before revealing separate credential',async()=>{
 const f=await fixture(),value=await f.actions.export();assert.equal(value.saved,true);assert.equal(value.verified,true);assert.equal(value.credential,f.credential);assert.equal(value.walletChanged,false);
 assert.deepEqual(f.counts(),{exports:1,reads:1,restores:1,retires:1});assert.equal('wire' in value,false);
});
test('PQ normal verify does not write or sign; cancelled dialog does not read private backup',async()=>{
 const f=await fixture();f.choices.export=async()=>null;assert.equal((await f.actions.export()).saved,false);assert.deepEqual(f.counts(),{exports:0,reads:0,restores:0,retires:0});
 assert.equal((await f.actions.verify()).verified,true);assert.deepEqual(f.counts(),{exports:0,reads:1,restores:1,retires:1});
});
test('PQ export failure or a late lock never reveals credential or automatically writes again',async()=>{
 const f=await fixture();f.files.write=async()=>{f.lifecycle.lock();throw false;};
 await assert.rejects(f.actions.export());assert.equal(f.counts().restores,0);
 assert.equal(f.actions.selectOriginalOutcome(value=>value.firstCause),false);
});
test('PQ key retirement failure prevents successful backup confirmation',async()=>{
 const f=await fixture();f.sdk.destroyPQWalletKeyHandle=()=>false;await assert.rejects(f.actions.export());
 assert.equal(f.counts().exports,1);assert.equal(f.counts().restores,1);
 await assert.rejects(f.actions.verify());assert.equal(f.counts().restores,1);
});
test('PQ late restored handle after lock is retired once and no credential is returned',async()=>{
 const f=await fixture(),restore=f.sdk.restorePQWalletKeyHandle;f.sdk.restorePQWalletKeyHandle=async(...args)=>{const handle=await restore(...args);f.lifecycle.lock();return handle;};
 await assert.rejects(f.actions.export());assert.equal(f.counts().retires,1);assert.equal(f.actions.status().firstCausePresent,true);
});
test('PQ changed backup bytes refuse before any private key restoration',async()=>{
 const f=await fixture();f.files.read=async()=>new Uint8Array([1,2,4]);await assert.rejects(f.actions.verify());assert.equal(f.counts().restores,0);
});
test('PQ backup normal main/preload wiring never accepts a renderer path, binding or credential',async()=>{
 const {readFile}=await import('node:fs/promises');
 const main=await readFile(new URL('../src/main.mjs',import.meta.url),'utf8'),preload=await readFile(new URL('../src/preload.cjs',import.meta.url),'utf8');
 for(const action of ['export','verify']){assert.ok(main.includes(`handleWalletIPC('wallet:pq-backup-${action}',()=>safeIPC(`));assert.ok(preload.includes(`()=>ipcRenderer.invoke('wallet:pq-backup-${action}')`));}
 assert.equal(preload.includes('withPQBackup'),false);assert.ok(main.includes('pqBackupActions=createPQBackupActions('));
 assert.equal(preload.includes('selectOriginalOutcome'),false);
});
