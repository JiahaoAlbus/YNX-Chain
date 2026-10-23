import test from 'node:test';
import assert from 'node:assert/strict';
import {appendWalletIDEIdentityApproval} from '../src/wallet-ide-identity-peer-ui.mjs';
function fixture(extra={}){
 const review={reviewId:'PUBLIC-review-only',requestId:'PUBLIC-original-request',purpose:'PUBLIC exact Native purpose',account:'PUBLIC-selected-account',networkId:'PUBLIC-original-network',...extra},children=[],calls=[],messages=[];let state={account:review.account,revision:1,locked:false},attached=true,reply=async(id,decision)=>({ok:true,value:{reviewId:id,decision,recorded:true}});
 const document={createElement:()=>({disabled:false,addEventListener(type,fn){this[type]=fn;}})},container={append:x=>children.push(x)};
 const ui=appendWalletIDEIdentityApproval({container,review,api:{async decideIDEIdentityPeer(id,decision){calls.push([id,decision]);return reply(id,decision);}},getKeyState:()=>state,isCurrent:()=>attached,onResult:m=>messages.push(m),document});
 return{review,children,buttons:children.filter(x=>x.type==='button'),calls,messages,ui,change:s=>{state={...state,...s};},detach:()=>{attached=false;},reply:fn=>{reply=fn;}};
}
test('publication displays all six semantic fields as DATA while preserving disabled approval and cancellation',async()=>{
 const publication={byteSize:42,contentDigest:'a'.repeat(64),projectId:'PUBLIC-project',publishPurpose:'release',targetEnvironment:'testnet',version:'PUBLIC-v2',dataOnly:true,artifactVerified:false,publisherCurrent:false,publicationAuthorized:false};
 const f=fixture({purpose:'AUTH-PROTECTED-KEY-CALL',approvalAvailable:false,publication});
 for(const value of [42,publication.contentDigest,publication.projectId,publication.publishPurpose,publication.targetEnvironment,publication.version])assert(f.children.some(x=>x.textContent.includes(String(value))));
 assert(f.children.some(x=>/not verified/.test(x.textContent)));assert.equal(f.buttons[0].disabled,true);await f.buttons[0].click();assert.equal(f.calls.length,0);await f.buttons[2].click();assert.deepEqual(f.calls,[[f.review.reviewId,'cancel']]);
});
test('a key-call without an explicit approval availability cannot enable the approval button',async()=>{
 const f=fixture({purpose:'AUTH-PROTECTED-KEY-CALL'});assert.equal(f.buttons[0].disabled,true);await f.buttons[0].click();assert.equal(f.calls.length,0);
});
test('publication display cannot upgrade verified/current/authorized flags or insert HTML',()=>{
 const publication={byteSize:42,contentDigest:'a'.repeat(64),projectId:'<img src=x>',publishPurpose:'release',targetEnvironment:'testnet',version:'PUBLIC-v2',dataOnly:true,artifactVerified:false,publisherCurrent:false,publicationAuthorized:false};
 for(const key of ['artifactVerified','publisherCurrent','publicationAuthorized'])assert.throws(()=>fixture({purpose:'AUTH-PROTECTED-KEY-CALL',approvalAvailable:false,publication:{...publication,[key]:true}}),/REVIEW_INVALID/);
 const f=fixture({purpose:'AUTH-PROTECTED-KEY-CALL',approvalAvailable:false,publication});assert(f.children.some(x=>x.textContent.includes('<img src=x>')));assert(f.children.every(x=>x.innerHTML===undefined));
});
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
