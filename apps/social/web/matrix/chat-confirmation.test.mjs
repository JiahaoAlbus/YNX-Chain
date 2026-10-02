import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatConfirmation} from './chat-confirmation.mjs';
import {createChatCopy} from './chat-copy.mjs';

class Element{
 constructor(tag,document){this.tag=tag;this.document=document;this.children=[];this.dataset={};this.attributes={};this.isConnected=true;this.textContent=''}
 append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node)}}
 setAttribute(key,value){this.attributes[key]=value}
 remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this)}
 focus(){this.document.activeElement=this}
 showModal(){this.open=true;this.modal=true}
 show(){this.open=true;this.modal=false}
 close(){this.open=false;this.onclose?.()}
}
function fixture(lang='en'){
 const document={documentElement:{lang},createElement(tag){return new Element(tag,this)}};
 const original=document.createElement('button');document.activeElement=original;
 const container=document.createElement('section'),controller=new AbortController(),copy=createChatCopy(document);
 let valid=true;
 const ui=createChatConfirmation({container,environment:{document},text:copy.text});
 const input={title:copy.text('removeTitle'),description:copy.text('currentBody'),account:'fixture-existing-user',site:'https://fixture.example.test/',deviceId:'ORIGINAL-DEVICE',signal:controller.signal,guard(){if(!valid)throw Object.assign(Error('Stale context'),{code:'UI_STALE_VIEW'})}};
 const dialog=()=>container.children[0],buttons=()=>dialog().children.at(-1).children;
 return {document,original,container,controller,ui,input,dialog,buttons,invalidate(){valid=false}};
}
test('review names the exact account/site/device, uses real logo and defaults focus to Cancel',async()=>{
 const h=fixture(),pending=h.ui.request(h.input),dialog=h.dialog();
 assert.equal(dialog.modal,true);assert.equal(dialog.attributes['aria-labelledby'],'chat-confirm-title');
 assert.equal(dialog.children[0].children[0].src,'/assets/ynx-logo.png');
 assert.deepEqual(dialog.children[3].children.filter((_,index)=>index%2).map(node=>node.textContent),[h.input.account,h.input.site,h.input.deviceId]);
 assert.equal(h.document.activeElement,h.buttons()[0]);h.buttons()[0].onclick();assert.equal(await pending,false);assert.equal(h.container.children.length,0);assert.equal(h.document.activeElement,h.original);
});
test('approval is single-use; retained detached approval cannot approve a newer request',async()=>{
 const h=fixture(),first=h.ui.request(h.input),old=h.buttons()[1];old.onclick();assert.equal(await first,true);
 const second=h.ui.request(h.input);old.onclick();assert.equal(h.dialog().open,true);h.buttons()[0].onclick();assert.equal(await second,false);
});
for(const method of ['cancel','escape','abort'])test(method+' closes the branded review with no approval',async()=>{
 const h=fixture(),pending=h.ui.request(h.input),old=h.buttons()[1];
 if(method==='cancel')h.ui.cancel();else if(method==='escape'){let prevented=false;h.dialog().oncancel({preventDefault(){prevented=true}});assert.equal(prevented,true)}else h.controller.abort();
 assert.equal(await pending,false);old.onclick();assert.equal(h.container.children.length,0);
});
test('account/view changes are rechecked at the approval click, not just when shown',async()=>{
 const h=fixture(),pending=h.ui.request(h.input),rejected=assert.rejects(pending,error=>error.code==='UI_STALE_VIEW');h.invalidate();h.buttons()[1].onclick();await rejected;assert.equal(h.container.children.length,0);
});
test('already-aborted intent cannot show a dialog',async()=>{
 const h=fixture();h.controller.abort();assert.equal(await h.ui.request(h.input),false);assert.equal(h.container.children.length,0);
});
test('double requests are rejected without replacing the original review',async()=>{
 const h=fixture(),pending=h.ui.request(h.input),dialog=h.dialog();await assert.rejects(h.ui.request(h.input),error=>error.code==='CHAT_CONFIRM_BUSY');assert.equal(h.dialog(),dialog);h.ui.cancel();assert.equal(await pending,false);
});
test('unsupported dialog presentation fails closed and does not fall back to native confirm',async()=>{
 const h=fixture(),create=h.document.createElement;h.document.createElement=function(tag){const node=create.call(this,tag);if(tag==='dialog')node.showModal=()=>{throw Error('unavailable')};return node};
 await assert.rejects(h.ui.request(h.input),error=>error.code==='CHAT_CONFIRM_UNAVAILABLE'&&!error.message.includes(h.input.account));assert.equal(h.container.children.length,0);
});
test('progress is non-modal so standard upstream UIA controls remain interactive; no success is synthesized',()=>{
 const h=fixture();h.ui.progress({...h.input,title:'Pending deletion',description:'Complete identity verification'});
 assert.equal(h.dialog().modal,false);assert.equal(h.dialog().dataset.phase,'progress');assert.equal(h.dialog().attributes['aria-live'],'polite');
 h.buttons()[0].onclick();assert.equal(h.container.children.length,0);
 h.ui.result({...h.input,title:'Removal not confirmed',description:'Check device list before retrying'});assert.equal(h.dialog().modal,true);assert.equal(h.dialog().children[1].textContent,'Removal not confirmed');h.ui.cancel();
});
test('explicit current document language is inherited without locale storage and remains dynamic',async()=>{
 const h=fixture('zh-CN'),pending=h.ui.request(h.input);assert.equal(h.buttons()[0].textContent,'取消');assert.equal(h.buttons()[1].textContent,'移除设备访问权限');h.ui.cancel();assert.equal(await pending,false);
 const copy=createChatCopy(h.document);h.document.documentElement.lang='en';assert.equal(copy.text('cancel'),'Cancel');h.document.documentElement.lang='zh-CN';assert.equal(copy.text('ready'),'设备检查通过，可以向此对话发送消息。');
});
test('context is rendered as text nodes, never interpreted as HTML or a new URL',async()=>{
 const h=fixture();h.input.account='<img src=x onerror=fixture>';const pending=h.ui.request(h.input);assert.equal(h.dialog().children[3].children[1].textContent,h.input.account);assert.equal(h.dialog().children[3].children[1].children.length,0);h.ui.cancel();await pending;
});
