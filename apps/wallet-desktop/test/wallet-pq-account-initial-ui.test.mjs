import fs from 'node:fs';import vm from 'node:vm';import{createHash}from'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPQAccountInitialUI,appendPQAccountInitialReviewAction} from '../src/wallet-pq-account-initial-ui.mjs';
const account='0x'+'11'.repeat(20),hash='0x'+'22'.repeat(32);
function harness(){const nodes=[];function node(){const n={children:[],value:'',textContent:'',disabled:false,append(...items){this.children.push(...items);},setAttribute(){},addEventListener(type,fn){this[type]=fn;}};nodes.push(n);return n;}const section=node(),doc={createElement:()=>node(),querySelector:s=>{assert.equal(s,'#backup-section');return section;}},state={account,revision:1,locked:false,authenticating:false},calls=[];const api={preparePQAccountInitial:input=>new Promise(resolve=>calls.push({input,resolve})),preparePQAccountInitialBroadcast:hash=>new Promise(resolve=>calls.push({hash,resolve}))};return{nodes,node,section,doc,state,calls,api};}
test('normal registration panel previews only entered activation height and suppresses duplicate clicks',async()=>{
 const h=harness(),ui=createPQAccountInitialUI({api:h.api,getKeyState:()=>h.state,document:h.doc});ui.render();const panel=h.section.children[0],input=panel.children.find(n=>n.id==='pq-account-initial-height'),button=panel.children.find(n=>n.type==='button'),status=panel.children.at(-1);input.value='9007199254740994';const pending=button.click();await button.click();assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].input,{activateAt:'9007199254740994'});h.calls[0].resolve({ok:true,value:{account,action:'sign',effectReady:false,signed:false,submitted:false}});await pending;assert.match(status.textContent,/not signed or submitted/);assert.match(status.textContent,/separate approvals/);assert.equal(button.disabled,false);
});
test('lock/account revision invalidation clears the local draft and refuses late preview success',async()=>{
 const h=harness(),ui=createPQAccountInitialUI({api:h.api,getKeyState:()=>h.state,document:h.doc});ui.render();const panel=h.section.children[0],input=panel.children.find(n=>n.id==='pq-account-initial-height'),button=panel.children.find(n=>n.type==='button'),status=panel.children.at(-1);input.value='10';const pending=button.click();h.state.locked=true;h.state.revision++;ui.invalidate();h.calls[0].resolve({ok:true,value:{account,action:'sign',effectReady:false,signed:false,submitted:false}});await pending;assert.equal(input.value,'');assert.equal(status.textContent,'');assert.equal(button.disabled,true);await button.click();assert.equal(h.calls.length,1);
});
test('original submission preview has its own API and never dispatches on UNKNOWN or after lock',async()=>{
 const h=harness(),row=h.node(),messages=[];for(const status of ['pq-submission-unknown','pq-inclusion-observed'])appendPQAccountInitialReviewAction({row,record:{account,hash,kind:'pq-account-initial',status},api:h.api,getKeyState:()=>h.state,isCurrent:()=>true,onResult:v=>messages.push(v),document:h.doc});assert.equal(row.children.length,0);
 appendPQAccountInitialReviewAction({row,record:{account,hash,kind:'pq-account-initial',status:'pq-signed-unsubmitted'},api:h.api,getKeyState:()=>h.state,isCurrent:()=>true,onResult:v=>messages.push(v),document:h.doc});const button=row.children[0],pending=button.click();await button.click();assert.equal(h.calls.length,1);assert.equal(h.calls[0].hash,hash);h.calls[0].resolve({ok:true,value:{account,action:'broadcast',effectReady:false,signed:false,submitted:false}});await pending;assert.match(messages[0],/Original signed registration retained/);h.state.locked=true;await button.click();assert.equal(h.calls.length,1);
});

test('native approval: preview does not infer Native permission availability',async()=>{
 const h=harness();let approved=0;h.api.approve=()=>approved++;const ui=createPQAccountInitialUI({api:h.api,getKeyState:()=>h.state,document:h.doc});ui.render();const panel=h.section.children[0],button=panel.children.find(n=>n.type==='button'),result=panel.children.at(-1);const task=button.click();h.calls[0].resolve({ok:true,value:{account,action:'sign',effectReady:false,signed:false,submitted:false}});await task;
 assert.match(result.textContent,/separate approvals/i);assert.doesNotMatch(result.textContent,/Native permission is (?:not )?ready/i);assert.equal(approved,0);assert.equal(h.calls.length,1);
});
test('native approval: signing preview rejects another or missing action',async()=>{
 for(const action of ['broadcast',undefined]){const h=harness(),ui=createPQAccountInitialUI({api:h.api,getKeyState:()=>h.state,document:h.doc});ui.render();const panel=h.section.children[0],button=panel.children.find(n=>n.type==='button'),result=panel.children.at(-1);const task=button.click();h.calls[0].resolve({ok:true,value:{account,action,effectReady:false,signed:false,submitted:false}});await task;assert.match(result.textContent,/Preview unavailable/);assert.equal(h.calls.length,1);}
});
test('native approval: original submission review preserves the already signed state',async()=>{
 const h=harness(),row=h.node(),messages=[];appendPQAccountInitialReviewAction({row,record:{account,hash,kind:'pq-account-initial',status:'pq-signed-unsubmitted'},api:h.api,getKeyState:()=>h.state,isCurrent:()=>true,onResult:m=>messages.push(m),document:h.doc});const task=row.children[0].click();h.calls[0].resolve({ok:true,value:{account,action:'broadcast',effectReady:false,signed:false,submitted:false}});await task;
 assert.match(messages[0],/Original signed registration retained/);assert.match(messages[0],/nothing submitted/i);assert.doesNotMatch(messages[0],/not signed/);assert.equal(h.calls[0].hash,hash);assert.equal(h.calls.length,1);
});
test('native approval: actual review projection explains each original approval effect',()=>{
 const source=fs.readFileSync(new URL('../src/wallet-pq-account-initial-review.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('export function projectPQAccountInitialReview')).replace('export ','');const project=vm.runInNewContext(body+';projectPQAccountInitialReview',{Buffer,hash:b=>createHash('sha256').update(b).digest('hex')});
 const base={account,networkId:'a'.repeat(64),operationId:'PUBLIC-operation',purpose:'TX-BATCH',requestDigest:'b'.repeat(64),expiresAt:'2026-11-08T00:00:30.000Z',intent:{activateAt:'42',pkA:'ab'.repeat(2592),pkB:'cd'.repeat(64)},originalOperationId:'PUBLIC-original',transportHash:hash,abciTransactionHash:'0x'+'33'.repeat(32),executionHeight:'41'};
 const sign=project({...base,action:'sign'}),broadcast=project({...base,action:'broadcast'});
 assert.match(sign.warning,/original signing approval/i);assert.match(sign.warning,/no submission/i);assert.match(broadcast.warning,/submit only the retained original/i);assert.match(broadcast.warning,/no new signing/i);
 for(const value of [sign,broadcast]){assert.equal(value.effectReady,false);assert.doesNotMatch(value.warning,/confirmation cannot sign or send/i);assert.doesNotMatch(value.warning,/permission (?:is )?(?:not )?ready/i);}
 assert.equal(broadcast.transportHash,hash);assert.equal(sign.nonce,'1');
});
