import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),localization=require('../runtime/ynx-workbench/lib/native-wallet-localization');
const source=await readFile(new URL('../runtime/ynx-workbench/lib/native-wallet-view.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
class Node {constructor(document,tag){this.ownerDocument=document;this.tag=tag;this.children=[];this.listeners=new Map();}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(event,fn){this.listeners.set(event,fn);}focus(){}click(){if(!this.disabled)this.listeners.get('click')?.();}}
const document={createElement:tag=>new Node(document,tag)};
class BaseWidget{constructor(){this.node=new Node(document,'root');this.title={};this.toDispose=[];}onActivateRequest(){}dispose(){for(const d of this.toDispose.splice(0))d.dispose();}}
const loaded={exports:{}};vm.runInNewContext(source,{module:loaded,AbortController,setTimeout,clearTimeout,require:name=>{
 if(name==='@theia/core/lib/browser/widgets')return{BaseWidget};
 if(name==='@theia/core/lib/browser/common-menus')return{CommonMenus:{VIEW_VIEWS:[]}};
 if(name==='@theia/core/lib/common/nls')return{nls:{localize:(_key,text)=>text}};
 if(name==='./native-wallet-controller')return{};
 if(name==='./native-wallet-sdk.generated')return{};
 if(name==='./native-wallet-localization')return localization;
 throw Error('Unexpected test dependency '+name);
}});
function fixture(call){const controller={state:{phase:'idle',session:{status:'disconnected'},serviceConfiguration:'not-supplied'},inspect:async()=>{},cancel:async()=>{}};const widget=new loaded.exports.NativeWalletWidget({controller,listeners:new Set(),projectContracts:{call}});const button=label=>widget.node.children.find(node=>node.tag==='button'&&node.textContent===label);return{widget,button,input:widget.node.children.find(node=>node.tag==='input'),result:widget.node.children.find(node=>node.tag==='pre')};}
test('confirmed cancellation allows an explicit retry through the actual connect button',async()=>{const calls=[],f=fixture(async action=>{calls.push(action);return action==='inspect'?{onlineConfigured:true}:action==='cancel'?{state:'cancelled'}:{connected:true};});await tick();f.button(localization.EN.projectContractCancel).click();await tick();assert.equal(f.button(localization.EN.projectContractConnect).disabled,false);assert.equal(calls.filter(x=>x==='connect').length,0);f.button(localization.EN.projectContractConnect).click();await tick();assert.equal(calls.filter(x=>x==='connect').length,1);f.widget.dispose();});
test('unconfirmed cancellation cannot look successful or allow reconnect while cleanup is pending',async()=>{const waiting=deferred(),calls=[],f=fixture(async action=>{calls.push(action);return action==='inspect'?{onlineConfigured:true}:waiting.promise;});await tick();f.button(localization.EN.projectContractCancel).click();await tick();assert.equal(f.button(localization.EN.projectContractConnect).disabled,true);assert.equal(f.button(localization.EN.projectContractRefresh).disabled,true);assert.equal(calls.filter(x=>x==='connect').length,0);waiting.resolve({state:'unknown'});await tick();assert.equal(f.button(localization.EN.projectContractConnect).disabled,true);assert.ok(f.widget.node.children.some(node=>node.textContent===localization.EN.projectContractUnavailable));f.widget.dispose();});
test('opening the real Wallet widget only inspects; actual saved-reference click uses the project backend',async()=>{
 const calls=[],f=fixture(async(action,body)=>{calls.push({action,body});return action==='inspect'?{onlineConfigured:false}:{authority:'query-reference-only',referenceId:body.referenceId};});await tick();assert.equal(calls.length,1);assert.equal(calls[0].action,'inspect');assert.equal(f.button(localization.EN.projectContractConnect).disabled,true);assert.equal(f.button(localization.EN.projectReferenceQuery).disabled,true);
 f.input.value='11111111-2222-3333-4444-555555555555';f.button(localization.EN.projectReferenceRead).click();await tick();assert.equal(calls[1].action,'read');assert.equal(calls[1].body.referenceId,f.input.value);assert.match(f.result.textContent,/query-reference-only/);f.widget.dispose();
});
test('configured connect remains an explicit real button callback, with no automatic query or prepare',async()=>{
 const calls=[],f=fixture(async(action,body)=>{calls.push({action,body});return action==='inspect'?{onlineConfigured:true}:{connected:true};});await tick();assert.equal(calls.length,1);assert.equal(f.button(localization.EN.projectContractConnect).disabled,false);f.button(localization.EN.projectContractConnect).click();await tick();assert.equal(calls.filter(call=>call.action==='connect').length,1);assert.ok(calls.every(call=>['inspect','connect'].includes(call.action)));assert.equal(calls[1].action,'connect');assert.equal(Object.keys(calls[1].body).length,0);assert.equal(f.button(localization.EN.projectReferenceQuery).disabled,false);f.widget.dispose();
});
test('a late backend result cannot repopulate a disposed project widget',async()=>{
 const waiting=deferred(),f=fixture(async action=>action==='inspect'?{onlineConfigured:false}:waiting.promise);await tick();f.input.value='11111111-2222-3333-4444-555555555555';f.button(localization.EN.projectReferenceRead).click();f.widget.dispose();waiting.resolve({PUBLIC:'late project result'});await tick();assert.equal(f.result.textContent,undefined);
});
test('the original pending connect shows pairing before approval without a second connect or stale status overwrite',async()=>{
 const approval=deferred(),lateStatus=deferred(),calls=[];let inspect=0;
 const f=fixture(async(action)=>{calls.push(action);if(action==='connect')return approval.promise;if(action==='inspect'){inspect++;if(inspect===1)return{onlineConfigured:true};if(inspect===2)return{onlineConfigured:true,pairingURI:'PUBLIC-pairing-selection'};return lateStatus.promise;}});
 await tick();f.button(localization.EN.projectContractConnect).click();await tick();const pairing=f.widget.node.children.find(node=>node.tag==='textarea');assert.equal(pairing.hidden,false);assert.equal(pairing.value,'PUBLIC-pairing-selection');assert.equal(calls.filter(action=>action==='connect').length,1);
 // A manual refresh observes this same pending request, not a newer epoch.
 f.button(localization.EN.projectContractRefresh).click();await tick();approval.resolve({connected:true});await tick();assert.equal(pairing.hidden,true);assert.equal(pairing.value,'');const connected=f.widget.node.children.find(node=>node.textContent===localization.EN.projectContractConnected);assert.ok(connected);
 lateStatus.resolve({onlineConfigured:true,pairingURI:'PUBLIC-stale-selection'});await tick();assert.equal(pairing.hidden,true);assert.equal(pairing.value,'');assert.equal(connected.textContent,localization.EN.projectContractConnected);f.widget.dispose();
});
