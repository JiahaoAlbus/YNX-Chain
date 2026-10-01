import test from 'node:test';
import assert from 'node:assert/strict';
import {dispatchPreparedProductRequest as video} from './product-session.js';
import {dispatchPreparedProductRequest as creator} from '../creator-studio/product-session.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
for(const [name,dispatch] of [['Video',video],['Creator',creator]]){
 test(name+' dispatches exact V2 URL and accepts only SDK-verified product return',async()=>{
  const calls=[];const state={status:'connected',session:{account:'native-fixture'}};
  const provider={request:async input=>{calls.push(input);return {version:2,returnUrl:'https://callback.invalid/fixture'};}};
  const result=await dispatch(provider,async()=>({url:'ynxwallet://fixture'}),async url=>{calls.push(url);return state;});
  assert.equal(result,state);assert.deepEqual(calls,[{method:'ynx_requestProductSessionV2',params:['ynxwallet://fixture']},'https://callback.invalid/fixture']);
 });
 test(name+' cancelled preparation never opens approval; late approval cannot consume callback',async()=>{
  let live=true,requests=0,returns=0;const preparation=deferred();
  const provider={request:async()=>{requests++;return {version:2,returnUrl:'fixture'};}};
  const first=dispatch(provider,()=>preparation.promise,async()=>returns++,()=>live);
  live=false;preparation.resolve({url:'fixture'});await assert.rejects(first,{code:'PRODUCT_APPROVAL_CANCELLED'});assert.equal(requests,0);
  live=true;const approval=deferred();provider.request=()=>approval.promise;
  const second=dispatch(provider,async()=>({url:'fixture'}),async()=>returns++,()=>live);
  await new Promise(r=>setImmediate(r));live=false;
  await assert.rejects(dispatch(provider,async()=>({url:'another'}),async()=>{}),{code:'PRODUCT_APPROVAL_DRAINING'});
  approval.resolve({version:2,returnUrl:'fixture'});await assert.rejects(second,{code:'PRODUCT_APPROVAL_CANCELLED'});assert.equal(returns,0);
 });
 test(name+' rejects malformed return and allows explicit retry after rejection',async()=>{
  let finishes=0;const provider={request:async()=>({version:2,returnUrl:'fixture',extra:true})};
  await assert.rejects(dispatch(provider,async()=>({url:'fixture'}),async()=>finishes++),{code:'PRODUCT_RETURN_INVALID'});
  provider.request=async()=>{throw Object.assign(new Error('Rejected'),{code:4001});};
  await assert.rejects(dispatch(provider,async()=>({url:'fixture'}),async()=>finishes++),{code:4001});
  provider.request=async()=>({version:2,returnUrl:'fixture'});
  assert.deepEqual(await dispatch(provider,async()=>({url:'fixture'}),async()=>({status:'disconnected',message:'rejected'})),{status:'disconnected',message:'rejected'});assert.equal(finishes,0);
 });
}

import {readFile} from 'node:fs/promises';
const videoSource=await readFile(new URL('./app.js',import.meta.url),'utf8');
const controllerSource=videoSource.slice(videoSource.indexOf('let videoSignInIntent = 0;'),videoSource.indexOf('async function prepareNativeVideoSignIn()'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
class Element {
 constructor(){this.children=[];this.listeners=new Map();this.hidden=false;this.disabled=false;this.open=false;}
 replaceChildren(){this.children=[];} append(item){this.children.push(item);} addEventListener(event,handler){this.listeners.set(event,handler);} close(){this.open=false;} showModal(){this.open=true;}
}
async function videoUI(provider,finish){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const calls=[];
 const dependencies={$,document:{createElement:()=>new Element()},window:{},discoverWalletCandidates:async()=>[{isYNXWallet:true,provider,label:'YNX Wallet'},{isMetaMask:true,provider:{request(){throw Error('MetaMask cannot approve private Video')}}}],dispatchPreparedProductRequest:video,videoProductSession:{prepare:async()=>({url:'video-fixture'}),finishReturn:finish},renderProductState:state=>calls.push(state),refreshLibraryView:async()=>calls.push('owned-library'),prepareNativeVideoSignIn:async()=>calls.push('native')};
 const controller=await new AsyncFunction(...Object.keys(dependencies),'let productSignOutPending=false,productRevision=0;'+controllerSource+'return {prepareVideoSignIn,cancelVideoSignIn};')(...Object.values(dependencies));
 return {...controller,$,calls};
}
test('Video shipped chooser routes the chosen YNX button to approval and the original library',async()=>{
 const requests=[];const c=await videoUI({request:async input=>{requests.push(input);return {version:2,returnUrl:'video-callback'};}},async url=>{assert.equal(url,'video-callback');return {status:'connected',session:{account:'native-fixture'}};});
 await c.prepareVideoSignIn();assert.equal(c.$('#product-wallet-choices').children.length,2);
 await c.$('#product-wallet-choices').children[0].onclick();assert.deepEqual(requests,[{method:'ynx_requestProductSessionV2',params:['video-fixture']}]);assert.equal(c.calls.at(-1),'owned-library');assert.equal(c.$('#product-wallet-chooser').open,false);
});
test('Video choose-another and account-change discard a late approval without private activation',async()=>{
 const pending=deferred(),listeners=new Map();let returns=0;
 const provider={request:()=>pending.promise,on:(event,handler)=>listeners.set(event,handler),removeListener:event=>listeners.delete(event)};
 const c=await videoUI(provider,async()=>{returns++;return {status:'connected'};});
 await c.prepareVideoSignIn();const approval=c.$('#product-wallet-choices').children[0].onclick();await new Promise(r=>setImmediate(r));
 listeners.get('accountsChanged')();pending.resolve({version:2,returnUrl:'late'});await approval;
 assert.equal(returns,0);assert.deepEqual(c.calls,[]);assert.equal(c.$('#product-wallet-chooser').open,false);
 await c.prepareVideoSignIn();assert.equal(c.$('#product-wallet-choices').hidden,false);assert.equal(listeners.size,0);
});
