import test from 'node:test';
import assert from 'node:assert/strict';
import {appendWalletIDEIdentityApproval} from '../src/wallet-ide-identity-peer-ui.mjs';
function fixture(){
 const review={reviewId:'PUBLIC-review-only',requestId:'PUBLIC-original-request',purpose:'PUBLIC exact Native purpose',account:'PUBLIC-selected-account',networkId:'PUBLIC-original-network'},children=[],calls=[],messages=[];let state={account:review.account,revision:1,locked:false},attached=true,reply=async(id,decision)=>({ok:true,value:{reviewId:id,decision,recorded:true}});
 const document={createElement:()=>({disabled:false,addEventListener(type,fn){this[type]=fn;}})},container={append:x=>children.push(x)};
 const ui=appendWalletIDEIdentityApproval({container,review,api:{async decideIDEIdentityPeer(id,decision){calls.push([id,decision]);return reply(id,decision);}},getKeyState:()=>state,isCurrent:()=>attached,onResult:m=>messages.push(m),document});
 return{review,children,buttons:children.filter(x=>x.type==='button'),calls,messages,ui,change:s=>{state={...state,...s};},detach:()=>{attached=false;},reply:fn=>{reply=fn;}};
}
test('displays exact purpose/account/network and sends only opaque review ID plus one explicit decision',async()=>{
 const f=fixture();for(const v of [f.review.purpose,f.review.account,f.review.networkId])assert(f.children.some(x=>x.textContent.includes(v)));assert.equal(f.calls.length,0);await f.buttons[0].click();assert.deepEqual(f.calls,[[f.review.reviewId,'approve']]);assert.match(f.messages.at(-1),/not identity authorization/);assert(f.buttons.every(b=>b.disabled));assert.doesNotMatch(JSON.stringify(f.calls),/proof|requestRaw|network|account/);
});
test('reject and cancel remain distinct, without synthetic approval or fallback rejection',async()=>{
 for(const [index,name,pattern]of [[1,'reject',/no approval proof/],[2,'cancel',/not rejection/]]){const f=fixture();await f.buttons[index].click();assert.deepEqual(f.calls,[[f.review.reviewId,name]]);assert.match(f.messages.at(-1),pattern);await f.buttons[0].click();assert.equal(f.calls.length,1);}
});
test('pending, lost and foreign decision responses cannot admit a duplicate choice or claim completion',async()=>{
 const f=fixture();let release;f.reply(()=>new Promise((_,reject)=>{release=reject;}));const work=f.buttons[0].click();await f.buttons[2].click();assert.equal(f.calls.length,1);release(Error('PUBLIC lost ACK'));await work;await f.buttons[0].click();assert.equal(f.calls.length,1);assert.match(f.messages.at(-1),/Acknowledgement unknown/);
 for(const change of [{reviewId:'foreign'},{decision:'reject'},{recorded:false}]){const x=fixture();x.reply(async(id,decision)=>({ok:true,value:{reviewId:id,decision,recorded:true,...change}}));await x.buttons[0].click();assert.match(x.messages.at(-1),/outcome unknown/);}
});
test('lock, account/revision switch and detached rows suppress late results and do not regain a spent choice',async()=>{
 for(const mode of ['lock','account','revision','detach']){const f=fixture();let release;f.reply(()=>new Promise(resolve=>{release=resolve;}));const work=f.buttons[0].click();if(mode==='lock')f.change({locked:true});if(mode==='account')f.change({account:'foreign'});if(mode==='revision')f.change({revision:2});if(mode==='detach')f.detach();release({ok:true,value:{reviewId:f.review.reviewId,decision:'approve',recorded:true}});await work;assert.equal(f.messages.length,0);await f.buttons[1].click();assert.equal(f.calls.length,1);}
});
