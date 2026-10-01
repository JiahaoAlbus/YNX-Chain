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
const controllerSource=videoSource.slice(videoSource.indexOf('let videoSignInIntent = 0;'),videoSource.indexOf('async function refreshLibraryView()'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
class Element {
 constructor(){this.children=[];this.listeners=new Map();this.hidden=false;this.disabled=false;this.open=false;}
 replaceChildren(){this.children=[];} append(item){this.children.push(item);} addEventListener(event,handler){this.listeners.set(event,handler);} close(){this.open=false;} showModal(){this.open=true;} removeAttribute(name){delete this[name];} setAttribute(name,value){this[name]=value;} focus(){this.focused=true;}
}
async function videoUI(provider,finish,overrides={}){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 const calls=[];
 const dependencies={$,document:{createElement:()=>new Element()},window:{},location:{origin:"https://video.ynxweb4.com"},discoverWalletCandidates:async()=>[{isYNXWallet:true,provider,label:'YNX Wallet'},{isMetaMask:true,provider:{request(){throw Error('MetaMask cannot approve private Video')}}}],dispatchPreparedProductRequest:video,videoProductSession:{prepare:async()=>({url:'video-fixture'}),finishReturn:finish},productConnected:()=>false, signOutVideoAccount:async()=>{},renderProductState:state=>calls.push(state),refreshLibraryView:async()=>calls.push('owned-library'),...overrides};
 const controller=await new AsyncFunction(...Object.keys(dependencies),'let productSignOutPending=false,productRevision=0;'+controllerSource+'return {prepareVideoSignIn,cancelVideoSignIn};')(...Object.values(dependencies));
 return {...controller,$,calls};
}
test('Video shipped chooser routes the chosen YNX button to approval and the original library',async()=>{
 const requests=[];const c=await videoUI({request:async input=>{requests.push(input);return {version:2,returnUrl:'video-callback'};}},async url=>{assert.equal(url,'video-callback');return {status:'connected',session:{account:'native-fixture'}};});
 await c.prepareVideoSignIn();assert.equal(c.$('#product-wallet-choices').children.length,4);
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

for(const [name,dispatch] of [['Video',video],['Creator',creator]]){
 test(name+' cancellation during SDK completion revokes the persisted late session before flight release',async()=>{
  const completing=deferred(),abort=new AbortController();let persisted=null,revokeStarted=false;const states=[];
  const finish=async()=>{await completing.promise;persisted={account:'old-owner'};return {status:'connected',session:persisted};};
  const revoke=async()=>{revokeStarted=true;await completing.promise;await new Promise(r=>setImmediate(r));persisted=null;return {status:'disconnected'};};
  const operation=dispatch({request:async()=>({version:2,returnUrl:'fixture'})},async()=>({url:'fixture'}),finish,()=>!abort.signal.aborted,{signal:abort.signal,revoke,onRevocation:state=>states.push(state)});
  await new Promise(r=>setImmediate(r));abort.abort();await new Promise(r=>setImmediate(r));assert.equal(revokeStarted,true);
  await assert.rejects(dispatch({request:async()=>{}},async()=>({url:'new'}),async()=>{}),{code:'PRODUCT_APPROVAL_DRAINING'});
  completing.resolve();await assert.rejects(operation,{code:'PRODUCT_APPROVAL_CANCELLED'});assert.equal(persisted,null);assert.equal(states.at(-1).status,'disconnected');
 });
 test(name+' failed cancellation keeps revocation pending, never reports a connected return',async()=>{
  const completing=deferred(),abort=new AbortController();const states=[];
  const operation=dispatch({request:async()=>({version:2,returnUrl:'fixture'})},async()=>({url:'fixture'}),async()=>{await completing.promise;return {status:'network-unavailable'};},()=>!abort.signal.aborted,{signal:abort.signal,revoke:async()=>({status:'retry-required',message:'Authority unavailable'}),onRevocation:state=>states.push(state)});
  await new Promise(r=>setImmediate(r));abort.abort();completing.resolve();await assert.rejects(operation,error=>error.productSessionState.revocationPending===true);assert.equal(states.at(-1).revocationPending,true);assert.ok(states.every(state=>state.status!=='connected'));
 });
}

test('Video Web Wallet click opens transport synchronously before preparing private approval',async()=>{
 const calls=[];const provider={connect:()=>{calls.push('popup-open');return Promise.resolve(['0xfixture']);},request:async input=>{calls.push(input.method);return {version:2,returnUrl:'callback'};},suspend:()=>calls.push('transport-close')};
 const c=await videoUI(provider,async()=>({status:'connected'}),{createHostedWalletAdapter:()=>provider,videoProductSession:{prepare:async()=>{calls.push('prepare');return {url:'fixture'};},finishReturn:async()=>({status:'connected'}),disconnect:async()=>({status:'disconnected'})}});
 await c.prepareVideoSignIn();const choosing=c.$('#product-wallet-choices').children[1].onclick();assert.deepEqual(calls,['popup-open']);await choosing;assert.deepEqual(calls,['popup-open','prepare','ynx_requestProductSessionV2']);assert.equal(c.calls.at(-1),'owned-library');
});
test('Video Mobile renders URI QR/deeplink, cancellation blocks late approval and clears code',async()=>{
 const connection=deferred();let cancellations=0,requests=0,qr=0;
 const provider={request:async()=>{requests++;}};
 class Pair {constructor(input){assert.equal(input.origin,'https://video.ynxweb4.com');assert.deepEqual(input.methods,['ynx_requestProductSessionV2']);}connect(input){input.onURI('wc:qa-fixture');return connection.promise;}cancel(){cancellations++;}}
 const c=await videoUI(provider,async()=>({status:'connected'}),{WalletConnectDAppConnection:Pair,QRCode:{toCanvas:async()=>{qr++;}}});
 await c.prepareVideoSignIn();const choosing=c.$('#product-wallet-choices').children[2].onclick();assert.equal(qr,1);assert.equal(c.$('#product-pair-panel').hidden,false);assert.ok(c.$('#product-pair-open').href.startsWith('ynxwallet://wc?uri='));
 c.cancelVideoSignIn();connection.resolve(provider);await choosing;assert.equal(requests,0);assert.ok(cancellations>0);assert.equal(c.$('#product-pair-panel').hidden,true);assert.equal(c.$('#product-pair-open').href,undefined);
});
test('Video Mobile approved Pair still needs explicit V2 product approval; expiry remains retryable',async()=>{
 let connects=0,requests=0;class Pair {connect(){connects++;return connects===1?Promise.reject(Object.assign(new Error('timeout'),{code:'YNX_PAIR_APPROVAL_TIMEOUT'})):Promise.resolve({request:async input=>{requests++;assert.equal(input.method,'ynx_requestProductSessionV2');return {version:2,returnUrl:'callback'};}});}cancel(){}}
 const c=await videoUI({},async()=>({status:'connected'}),{WalletConnectDAppConnection:Pair});await c.prepareVideoSignIn();await c.$('#product-wallet-choices').children[2].onclick();assert.match(c.$('#product-wallet-status').textContent,/expired/);assert.equal(requests,0);await c.$('#product-wallet-back').onclick();await c.$('#product-wallet-choices').children[2].onclick();assert.equal(requests,1);assert.equal(c.calls.at(-1),'owned-library');
});

test('Video without an injected extension still offers Web, phone and native choices',async()=>{
 const c=await videoUI({},async()=>({status:'connected'}),{discoverWalletCandidates:async()=>{throw Object.assign(new Error('No provider'),{code:'WALLET_NOT_INSTALLED'});}});await c.prepareVideoSignIn();assert.equal(c.$('#product-wallet-choices').children.length,4);assert.equal(c.$('#product-wallet-choices').children[0].disabled,true);assert.equal(c.$('#product-wallet-choices').children[1].textContent,'YNX Web Wallet');assert.equal(c.$('#product-wallet-choices').children[2].textContent,'YNX Wallet on my phone');
});

test('Video native step keeps the real launch in the dialog, one click only, cancel and expiry block it',async()=>{
 let timer;const url='ynxwallet://product-session/v2?request=qa';
 const c=await videoUI({},async()=>{}, {setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},videoProductSession:{prepare:async()=>({url,expiresAt:new Date(Date.now()+60000).toISOString()}),disconnect:async()=>({status:'disconnected'})}});
 await c.prepareVideoSignIn();await c.$('#product-wallet-choices').children.at(-1).onclick();
 const link=c.$('#product-native-open');assert.equal(c.$('#product-wallet-chooser').open,true);assert.equal(c.$('#product-wallet-choices').hidden,true);assert.equal(link.href,url);assert.equal(link.focused,true);
 const click=link.onclick;let prevented=0;click({preventDefault(){prevented++;}});assert.equal(prevented,0);click({preventDefault(){prevented++;}});assert.equal(prevented,1);
 await c.cancelVideoSignIn();click({preventDefault(){prevented++;}});assert.equal(prevented,2);assert.equal(link.href,undefined);
 await new Promise(resolve=>setImmediate(resolve));
 await c.prepareVideoSignIn();await c.$('#product-wallet-choices').children.at(-1).onclick();const expiredClick=link.onclick;timer();assert.equal(link.hidden,true);assert.match(c.$('#product-wallet-status').textContent,/expired/);
 // Expiry removes the actual navigable href. A retained handler cannot activate an absent link.
 assert.equal(link.href,undefined);await c.cancelVideoSignIn();expiredClick({preventDefault(){prevented++;}});assert.equal(prevented,3);
});
test('Video cancelled native preparation revokes only its late pending request and never exposes a launch',async()=>{
 let resolve,revoked=0;const pending=new Promise(yes=>{resolve=yes;});const c=await videoUI({},async()=>{}, {videoProductSession:{prepare:()=>pending,disconnect:async()=>{revoked++;return {status:'disconnected'};}}});
 await c.prepareVideoSignIn();const prep=c.$('#product-wallet-choices').children.at(-1).onclick();await c.cancelVideoSignIn();resolve({url:'ynxwallet://product-session/v2?request=late',expiresAt:new Date(Date.now()+60000).toISOString()});await prep;
 assert.equal(revoked,1);assert.equal(c.$('#product-native-open').href,undefined);assert.equal(c.$('#product-native-open').hidden,true);
});
test('Video unknown wallet failures do not expose internal exception text',async()=>{
 const c=await videoUI({},async()=>{}, {discoverWalletCandidates:async()=>{throw Error('SECRET_INTERNAL_STAGE_99');}});await c.prepareVideoSignIn();assert.doesNotMatch(c.$('#product-wallet-status').textContent,/SECRET_INTERNAL_STAGE_99/);assert.match(c.$('#product-wallet-status').textContent,/try again/);
});
