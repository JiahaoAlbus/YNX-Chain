import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createChatCopy} from './chat-copy.mjs';
import {createContactChat} from './contact-chat.mjs';
import {roomPresentation,approvedMessagePreview,messagePresentation,shouldSubmitChatKey} from './chat-presentation.mjs';
import {mountLocalContentFilter} from './local-filter-ui.mjs';
import {validMatrixUserId} from './login.mjs';

// Reuse the original permission/Matrix fixture without altering its assertions
// or substituting the product filter. This is controlled caller execution, NOT
// an admitted SDK, actual server identity, DOM browser or model acceptance.
const fixtureSource=readFileSync(new URL('./session-ui.test.mjs',import.meta.url),'utf8');
const start=fixtureSource.indexOf('const source=readFileSync(');
const end=fixtureSource.indexOf("test('encrypted-event checks");
assert.ok(start>=0&&end>start,'Original Matrix fixture must remain locatable');
let fixture=fixtureSource.slice(start,end);
fixture=fixture.replace("new URL('./session-ui.mjs',import.meta.url)",`new URL(${JSON.stringify(new URL('./session-ui.mjs',import.meta.url).href)})`);
const anchor='Object.assign(context,{roomPresentation,approvedMessagePreview,messagePresentation,shouldSubmitChatKey});';
assert.equal(fixture.split(anchor).length,2,'Inject only at the original explicit fixture boundary');
fixture=fixture.replace(anchor,`
 Node.prototype.setAttribute=function(name,value){this.attributes??=new Map();this.attributes.set(name,String(value))};
 const doc=context.document;doc.defaultView={};doc.documentElement={lang:'en'};doc.createTextNode=text=>({textContent:text});root.ownerDocument=doc;
 Object.assign(context,{roomPresentation,approvedMessagePreview,messagePresentation,shouldSubmitChatKey,mountLocalContentFilter,
  mountChatAppearance:()=>({refreshControls(){},setScope(){}})});
`);
fixture+='\nglobalThis.callerFixture={ready,harness,flush,connect,select};';
const context=vm.createContext({vm,assert,URL,createChatCopy,createContactChat,roomPresentation,approvedMessagePreview,messagePresentation,shouldSubmitChatKey,mountLocalContentFilter,validMatrixUserId,Uint8Array,AbortController,console,setImmediate,
 readFileSync:(file,options)=>readFileSync(process.env.SOCIAL_MATRIX_UI_SOURCE??file,options)});
vm.runInContext(fixture,context);
const {ready,flush}=context.callerFixture;
const text=node=>[node.textContent??'',...(node.children??[]).map(text)].join(' ');
const messageText=h=>text(h.nodes.get('[data-messages]'));
function filterControls(h){
 const settings=h.root.children.find(node=>node.dataset.localFilterSettings==='true');
 assert.ok(settings,'Actual session-ui must mount its filter, not an injected default-off stub');
 return {checkbox:settings.children[1].children[0],status:settings.children[2]};
}
function toggle(h,value){const {checkbox}=filterControls(h);checkbox.checked=value;checkbox.onchange()}
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}}
async function show(h,body,file){h.state.messages=async()=>[{id:'original-event',sender:'peer',content:{body,...(file?{file}:{})}}];h.state.t.options.publish({type:'encrypted-event'});await flush()}

test('actual message caller mounts explicit filter and restores only by a fresh permission-checked render',async()=>{
 const h=await ready();await show(h,'AUTHORIZED ORIGINAL');
 assert.ok(messageText(h).includes('AUTHORIZED ORIGINAL'));assert.equal(filterControls(h).status.dataset.modelState,'off');
 toggle(h,true);assert.equal(messageText(h).includes('AUTHORIZED ORIGINAL'),false);await flush();
 assert.ok(messageText(h).includes('Unchecked content hidden'));assert.equal(filterControls(h).status.dataset.modelState,'unavailable');
 const before=h.state.identityCalls;toggle(h,false);await flush();
 assert.ok(h.state.identityCalls>before);assert.ok(messageText(h).includes('AUTHORIZED ORIGINAL'));
});

test('preference enabled during delayed decryption never commits the unchecked original',async()=>{
 const h=await ready(),block=deferred();await show(h,'PREVIOUS');h.state.messages=()=>block.promise;
 h.state.t.options.publish({type:'encrypted-event'});await flush();toggle(h,true);
 assert.equal(messageText(h).includes('PREVIOUS'),false);
 block.resolve([{id:'late-event',sender:'peer',content:{body:'LATE UNCHECKED ORIGINAL'}}]);await flush();
 assert.equal(messageText(h).includes('LATE UNCHECKED ORIGINAL'),false);assert.ok(messageText(h).includes('Unchecked content hidden'));
});

test('enabling filter during attachment decryption prevents original object URL release',async()=>{
 const h=await ready();await show(h,'approved.txt',{url:'mxc://hs.test/approved'});const block=deferred();h.state.download=()=>block.promise;
 const button=h.nodes.get('[data-messages]').children[0].children.find(node=>node.textContent==='Download encrypted attachment');assert.ok(button);
 button.onclick();await flush();assert.equal(h.state.downloads,1);toggle(h,true);block.resolve(new ArrayBuffer(2));await flush();
 assert.equal(h.state.urls,0);assert.equal(h.nodes.get('[data-diagnostic-code]').textContent,'LOCAL_FILTER_UNAVAILABLE');
});

test('turning filtering off after private authority expires cannot unlock the old plaintext',async()=>{
 const h=await ready();await show(h,'PRIVATE OLD ACCOUNT');toggle(h,true);await flush();h.state.permission=false;
 h.state.t.options.publish({type:'encrypted-event'});await flush();assert.equal(h.state.t.client,null);
 toggle(h,false);await flush();assert.equal(messageText(h).includes('PRIVATE OLD ACCOUNT'),false);assert.equal(h.nodes.get('[data-messages]').children.length,0);
});

test('actual caller masks its room summary while filtering is enabled',async()=>{
 const h=await ready();await show(h,'ORIGINAL SUMMARY');toggle(h,true);await flush();
 const previews=h.nodes.get('[data-room-list]').children.flatMap(room=>room.children).flatMap(node=>node.children??[]).filter(node=>node.className==='chat-room-preview');
 assert.ok(previews.length);assert.ok(previews.every(node=>!text(node).includes('ORIGINAL SUMMARY')));
 assert.ok(previews.some(node=>text(node).includes('Unchecked content hidden')));
});
