import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {PassThrough} from 'node:stream';
import {createNativeParentControl} from './native-parent-control.mjs';

// PUBLIC facade controls: exercise the production pipe/path/cancellation code,
// without a Native owner, Source, proof, Wallet identity or authorization.
async function fixture(run){
  const root=await fs.realpath(await fs.mkdtemp(path.join(homedir(),'.ynx-identity-channel-test-')));
  const workspace=path.join(root,'project'),directory=path.join(root,'control');
  await fs.mkdir(workspace);await fs.mkdir(directory,{mode:0o700});
  await fs.copyFile(new URL('./native-identity-channel.mjs',import.meta.url),path.join(root,'channel.mjs'));
  await fs.writeFile(path.join(root,'wallet-admission-startup.mjs'),`export const calls=[];
    export let opening;export function deferOpen(){opening=new Promise(r=>release=r);}export let release;
    export let result={private:'PUBLIC_OPAQUE_DO_NOT_SERIALIZE'};
    export function setResult(value){result=value;}
    export let closeFailure=false;export function failClose(){closeFailure=true;}
    export async function openBundledWalletIdentityPeerCall(entry){calls.push(['open',entry]);if(opening)await opening;return {
      begin(...args){calls.push(['begin',...args]);},waitForReturn(){calls.push(['wait']);return result;},
      retire(){calls.push(['retire']);},async close(){calls.push(['close']);if(closeFailure)throw undefined;}
    };}`);
  const api=await import(pathToFileURL(path.join(root,'channel.mjs')));
  const stub=await import(pathToFileURL(path.join(root,'wallet-admission-startup.mjs')));
  const input=new PassThrough(),control=createNativeParentControl({input});
  const context={id:randomUUID(),workspace},instance=randomUUID(),document=randomUUID();
  const errors=[];
  const options={control,instance,context,directory,runningBackendModuleURL:'file:///PUBLIC/code-server.mjs',onError:e=>errors.push(e)};
  const channel=await api.attachNativeIdentityChannel(options);
  const frame=(action='native-identity-receive',extra={})=>({action,document,id:randomUUID(),instance,projectId:context.id,workspace,...extra});
  const send=body=>input.write(JSON.stringify(body)+'\n');
  const until=async check=>{for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,5));}assert.fail('PUBLIC control did not settle');};
  const read=async id=>{try{return JSON.parse(await fs.readFile(path.join(directory,'identity-'+id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  try{await run({api,options,channel,stub,frame,send,until,read,directory,errors});}
  finally{await channel.finishCleanup();await control.finishCleanup();await fs.rm(root,{recursive:true,force:true});}
}
test('normal parent pipe publishes only DATA; duplicate request cannot run twice; explicit cancel closes retained peer',()=>fixture(async f=>{
  const body=f.frame();f.send(body);f.send(body);
  await f.until(()=>f.read(body.id));
  const result=await f.read(body.id);
  assert.equal(result.phase,'response-received');assert.equal(result.authorized,false);assert.equal(result.dataOnly,true);
  assert.equal(JSON.stringify(result).includes('PUBLIC_OPAQUE'),false);
  assert.deepEqual(f.stub.calls.filter(x=>x[0]==='begin'),[['begin','receive',undefined]]);
  assert.equal(f.stub.calls.some(x=>x[0]==='close'),false);
  f.send({...body,action:'native-identity-cancel'});
  await f.until(()=>f.stub.calls.some(x=>x[0]==='close'));
  assert.equal(f.stub.calls.filter(x=>x[0]==='close').length,1);
}));
test('confirmed cleanup releases private call/result references while retaining duplicate-request history',()=>fixture(async f=>{
  const body=f.frame();f.send(body);await f.until(()=>f.read(body.id));
  assert.equal(f.channel.status().retainedPrivateCalls,1);assert.equal(f.channel.status().retainedPrivateResults,1);
  f.send({...body,action:'native-identity-cancel'});await f.until(()=>!f.channel.status().busy);
  assert.equal(f.channel.status().retainedPrivateCalls,0);assert.equal(f.channel.status().retainedPrivateResults,0);
  assert.equal(f.channel.status().requests,1);f.send(body);await new Promise(r=>setImmediate(r));
  assert.equal(f.stub.calls.filter(x=>x[0]==='open').length,1);assert.equal(f.stub.calls.filter(x=>x[0]==='close').length,1);
}));
test('no renderer key call, extra authority field or cross-project request enters fixed factory',()=>fixture(async f=>{
  f.send(f.frame('native-identity-key-call'));f.send(f.frame(undefined,{expectedRoot:'PUBLIC'}));f.send(f.frame(undefined,{projectId:randomUUID()}));
  await new Promise(r=>setImmediate(r));assert.deepEqual(f.stub.calls,[]);
  await assert.rejects(f.api.attachNativeIdentityChannel({...f.options,provider:{}}),{code:'IDE_IDENTITY_TRANSPORT_INVALID'});
}));
test('cancel during fixed import retains and closes late facade without beginning or publishing',()=>fixture(async f=>{
  f.stub.deferOpen();const body=f.frame('native-identity-recover');f.send(body);
  await f.until(()=>f.stub.calls.length===1);f.send({...body,action:'native-identity-cancel'});f.stub.release();
  await f.until(()=>f.stub.calls.some(x=>x[0]==='close'));
  assert.equal(f.stub.calls.some(x=>x[0]==='begin'),false);assert.equal(await f.read(body.id),null);
  assert.equal(f.stub.calls.filter(x=>x[0]==='close').length,1);
}));
test('late approval after cancellation cannot publish completion or restart the request',()=>fixture(async f=>{
  let resolve;f.stub.setResult(new Promise(r=>resolve=r));const body=f.frame();f.send(body);
  await f.until(()=>f.stub.calls.some(x=>x[0]==='wait'));f.send({...body,action:'native-identity-cancel'});
  resolve({private:'PUBLIC_LATE'});await f.until(()=>f.stub.calls.some(x=>x[0]==='close'));
  assert.equal(await f.read(body.id),null);assert.equal(f.stub.calls.filter(x=>x[0]==='begin').length,1);
}));
test('falsy close failure remains cleanup debt and cannot be replayed as clean',()=>fixture(async f=>{
  f.stub.failClose();const body=f.frame();f.send(body);await f.until(()=>f.read(body.id));
  const result=await f.channel.finishCleanup();assert.equal(result.complete,false);assert.equal(result.firstFailurePresent,true);assert.equal(result.firstFailure,undefined);
  assert.equal((await f.channel.finishCleanup()).complete,false);assert.equal(f.stub.calls.filter(x=>x[0]==='close').length,1);
  assert.equal(f.channel.status().retainedPrivateCalls,1);assert.equal(f.channel.status().retainedPrivateResults,1);
}));
test('control-directory replacement refuses publication without entering a Native action',()=>fixture(async f=>{
  f.stub.deferOpen();const body=f.frame();f.send(body);await f.until(()=>f.stub.calls.length===1);
  await fs.rename(f.directory,f.directory+'-retained');await fs.mkdir(f.directory,{mode:0o700});f.stub.release();
  await f.until(()=>f.stub.calls.some(x=>x[0]==='close'));
  assert.equal(f.stub.calls.some(x=>x[0]==='begin'),false);assert.equal(await f.read(body.id),null);
  assert.equal(f.errors.some(x=>x?.code==='IDE_IDENTITY_TRANSPORT_CHANGED'),true);
}));
test('pending request cannot be displaced by a second action and recover uses its exact purpose',()=>fixture(async f=>{
  let resolve;f.stub.setResult(new Promise(r=>resolve=r));const first=f.frame('native-identity-recover');f.send(first);
  await f.until(()=>f.stub.calls.some(x=>x[0]==='wait'));
  const second=f.frame();f.send(second);await f.until(()=>f.read(second.id));
  assert.equal((await f.read(second.id)).errorCode,'IDE_IDENTITY_REQUEST_BUSY');
  assert.deepEqual(f.stub.calls.filter(x=>x[0]==='begin'),[['begin','recover',undefined]]);
  f.send({...first,action:'native-identity-cancel'});resolve(null);
  await f.until(()=>f.stub.calls.some(x=>x[0]==='close'));assert.equal(await f.read(first.id),null);
}));
