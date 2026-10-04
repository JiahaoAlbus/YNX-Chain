import test from 'node:test';
import assert from 'node:assert/strict';
import {mountLocalContentFilter} from './local-filter-ui.mjs';

class Node{
 constructor(document){this.ownerDocument=document;this.children=[];this.dataset={};this.textContent=''}
 append(...items){this.children.push(...items)}
 setAttribute(){}
 remove(){}
}
function fixture(classifier){
 const document={documentElement:{lang:'en'},defaultView:{},createElement(){return new Node(document)},createTextNode(text){return {textContent:text}}};
 const root=new Node(document),settings=new Node(document),slots=new Map();let changes=0;
 const filter=mountLocalContentFilter({root,settingsContainer:settings,classifier,storage:{getItem:key=>slots.get(key)??null,setItem:(key,value)=>slots.set(key,value)},onChanged:()=>changes++});
 const checkbox=settings.children[0].children[1].children[0];
 return {filter,root,settings,slots,changes:()=>changes,toggle(value){checkbox.checked=value;checkbox.onchange()},node:()=>new Node(document)};
}
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
const safe={gore:0.01,explicit_violence:0.02,sexual_content:0.03};

test('default off is mounted without scanning; missing model never shows enabled original or preview',async()=>{
 const f=fixture(),node=f.node();
 f.filter.renderText(node,'APPROVED ORIGINAL',{id:'first',assertCurrent(){}});assert.equal(node.textContent,'APPROVED ORIGINAL');
 f.toggle(true);assert.equal(node.textContent.includes('APPROVED ORIGINAL'),false);
 f.filter.renderText(node,'APPROVED ORIGINAL',{id:'first',assertCurrent(){}});await flush();
 assert.equal(node.textContent.includes('APPROVED ORIGINAL'),false);assert.equal(node.dataset.localFilterState,'unavailable');
 assert.equal(f.filter.preview('PRIVATE PREVIEW').includes('PRIVATE PREVIEW'),false);
 assert.throws(()=>f.filter.assertAttachmentAllowed(),/Unchecked attachments/);
 f.toggle(false);f.filter.renderText(node,'APPROVED ORIGINAL',{id:'first',assertCurrent(){}});await flush();
 assert.equal(node.textContent,'APPROVED ORIGINAL');assert.equal(f.filter.preview('PRIVATE PREVIEW'),'PRIVATE PREVIEW');
 assert.doesNotThrow(()=>f.filter.assertAttachmentAllowed());assert.equal(f.changes(),2);
});

test('pending classifier completion must pass original current-view fence before display',async()=>{
 let resolve;const pending=new Promise(done=>resolve=done);let current=true,calls=0;
 const f=fixture({supportedMimeTypes:['text/plain'],classify(){calls++;return pending}}),node=f.node();f.toggle(true);
 f.filter.renderText(node,'ORIGINAL',{id:'original',assertCurrent(){if(!current)throw Error('Retired private view')}});
 assert.equal(node.textContent.includes('ORIGINAL'),false);await flush();assert.equal(calls,1);
 current=false;resolve(safe);await flush();assert.equal(node.textContent.includes('ORIGINAL'),false);
});

test('turning off cancels the old model and requires a fresh authorized render',async()=>{
 let resolve,signal;const pending=new Promise(done=>resolve=done);
 const f=fixture({supportedMimeTypes:['text/plain'],classify(_bytes,_mime,abort){signal=abort;return pending}}),node=f.node();f.toggle(true);
 f.filter.renderText(node,'OLD',{id:'event',assertCurrent(){}});await flush();f.toggle(false);
 assert.equal(signal.aborted,true);resolve(safe);await flush();assert.equal(node.textContent.includes('OLD'),false);
 f.filter.renderText(node,'CURRENT',{id:'event',assertCurrent(){}});await flush();assert.equal(node.textContent,'CURRENT');
});

test('classifier error stays hidden and a subsequent explicit render can recover',async()=>{
 let calls=0;const f=fixture({supportedMimeTypes:['text/plain'],async classify(){if(++calls===1)throw Error('Model unavailable');return safe}}),node=f.node();f.toggle(true);
 f.filter.renderText(node,'FIRST',{id:'first',assertCurrent(){}});await flush();assert.equal(node.dataset.localFilterState,'unavailable');assert.equal(node.textContent.includes('FIRST'),false);
 f.filter.renderText(node,'SECOND',{id:'second',assertCurrent(){}});await flush();assert.equal(node.textContent,'SECOND');
 f.filter.cancel();assert.equal(node.textContent.includes('SECOND'),false);
});

for(const enabled of [false,true])test(`message refresh cannot clear another current panel, filtering ${enabled}`,async()=>{
 const f=fixture({supportedMimeTypes:['text/plain'],async classify(){return safe}}),message=f.node(),moment=f.node();
 if(enabled)f.toggle(true);
 f.filter.renderText(message,'MESSAGE',{id:'message',scope:'messages',assertCurrent(){}});
 f.filter.renderText(moment,'MOMENT',{id:'moment',scope:'moments',assertCurrent(){}});await flush();
 assert.equal(moment.textContent,'MOMENT');f.filter.cancel('messages');await flush();
 assert.equal(moment.textContent,'MOMENT');assert.equal(message.textContent.includes('MESSAGE'),false);
 f.filter.cancel();assert.equal(moment.textContent.includes('MOMENT'),false);
});
