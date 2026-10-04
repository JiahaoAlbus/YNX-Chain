import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatCopy} from './chat-copy.mjs';
import {mountChatChromeCopy} from './chat-chrome-copy.mjs';
function fixture(lang='zh-CN'){
 const document={documentElement:{lang}};
 const title={textContent:'Your conversations'};
 const messages={textContent:'ORIGINAL MESSAGE',attrs:new Map([['aria-label','Encrypted messages']]),getAttribute(key){return this.attrs.get(key)??null},setAttribute(key,value){this.attrs.set(key,value)}};
 const label={dataset:{chatCopy:'send'},textContent:'Send message'};
 const draft={value:'ORIGINAL DRAFT'},contact={textContent:'Original contact'};
 const root={querySelector:s=>s==='[data-room-title]'?title:s==='[data-messages]'?messages:null,querySelectorAll:()=>[label]};
 let selected=false,callback,options,disconnected=false;
 class Observer{constructor(fn){callback=fn}observe(target,input){assert.equal(target,document.documentElement);options=input}disconnect(){disconnected=true}}
 const mounted=mountChatChromeCopy({root,document,copy:createChatCopy(document),hasRoom:()=>selected,Observer});
 return {document,title,messages,label,draft,contact,mounted,setSelected:value=>selected=value,change(lang){document.documentElement.lang=lang;callback()},options,get disconnected(){return disconnected}};
}
test('cold Chinese workspace localizes empty title and accessible timeline',()=>{
 const h=fixture();assert.equal(h.title.textContent,'你的对话');assert.equal(h.messages.getAttribute('aria-label'),'加密消息');assert.equal(h.label.textContent,'发送消息');
 assert.deepEqual(h.options,{attributes:true,attributeFilter:['lang']});
});
test('locale switches both ways preserve original draft, message and contact text',()=>{
 const h=fixture();h.change('en');assert.equal(h.title.textContent,'Your conversations');assert.equal(h.messages.getAttribute('aria-label'),'Encrypted messages');assert.equal(h.label.textContent,'Send message');
 h.change('zh-CN');assert.equal(h.title.textContent,'你的对话');assert.equal(h.draft.value,'ORIGINAL DRAFT');assert.equal(h.messages.textContent,'ORIGINAL MESSAGE');assert.equal(h.contact.textContent,'Original contact');
});
test('selected original room title is never translated, even when equal to an interface phrase',()=>{
 const h=fixture();h.setSelected(true);h.title.textContent='Your conversations';h.change('zh-CN');assert.equal(h.title.textContent,'Your conversations');h.change('en');assert.equal(h.title.textContent,'Your conversations');
});
test('locked refresh clears old room title without erasing messages or drafts and releases observer',()=>{
 const h=fixture();h.setSelected(true);h.title.textContent='PRIVATE ORIGINAL ROOM';h.setSelected(false);h.mounted.refresh();assert.equal(h.title.textContent,'你的对话');assert.equal(h.draft.value,'ORIGINAL DRAFT');assert.equal(h.messages.textContent,'ORIGINAL MESSAGE');h.mounted.dispose();assert.equal(h.disconnected,true);
});
