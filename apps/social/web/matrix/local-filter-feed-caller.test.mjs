import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mountRestrictedFeed} from './restricted-feed-ui.mjs';
import {mountLocalContentFilter} from './local-filter-ui.mjs';

// Controlled DOM and authority ports, actual unmodified feed/filter/display
// modules. No Matrix SDK/server, browser, persistent vault or admitted model.
class Element {
  constructor(document,tag='text') {
    this.ownerDocument=document;this.tagName=tag;this.children=[];
    this.dataset={};this.attributes=new Map();this.listeners=new Map();
    this.parentNode=null;this.value='';this.disabled=false;this.hidden=false;this._text='';
  }
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('')}
  set textContent(value){this._text=String(value);this.replaceChildren()}
  append(...children){for(const child of children){child.parentNode=this;this.children.push(child)}}
  replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...children)}
  setAttribute(name,value){this.attributes.set(name,String(value))}
  remove(){if(this.parentNode){const parent=this.parentNode;parent.children=parent.children.filter(child=>child!==this);this.parentNode=null}}
  addEventListener(name,listener){this.listeners.set(name,listener)}
  async fire(name){await this.listeners.get(name)?.({preventDefault(){}})}
  click(){if(this.tagName==='a')this.ownerDocument.downloadLinks.push({href:this.href,download:this.download});else return this.fire('click')}
}
const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
const find=(node,tag)=>descendants(node).find(child=>child.tagName===tag);
const button=(node,label)=>descendants(node).find(child=>child.tagName==='button'&&child.textContent===label);
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve))};
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const safe=Object.freeze({gore:0.01,explicit_violence:0.02,sexual_content:0.03});
const protocol='ynx-social-matrix-moment/v1',sender='@owner:fixture.invalid';
const audience={protocol,kind:'private',roomId:'!moment:fixture.invalid',revision:'a'.repeat(64),owner:sender,members:[sender]};
const index={eventId:'$original-moment',transactionId:'original_moment_nonce_0001',audience};
const parent={protocol,eventId:index.eventId,roomId:audience.roomId,revision:audience.revision,owner:sender};
const original='AUTHORIZED MOMENT BODY';
const decoded={eventId:index.eventId,text:original,parent,attachment:{body:'original.bin',url:'mxc://fixture.invalid/original'}};
function fixture(t,{enabled=false,classifier}={}){
  const calls={read:[],loads:0,permissions:0,saves:[],clears:[],publishes:[],downloads:[],urls:[],revoked:[]};
  const document={documentElement:{lang:'en'},downloadLinks:[],createElement:tag=>new Element(document,tag),createTextNode:text=>{const node=new Element(document);node.textContent=text;return node},defaultView:{crypto:webcrypto,Blob,URL:{createObjectURL(blob){calls.urls.push(blob);return 'blob:controlled'},revokeObjectURL(url){calls.revoked.push(url)}}}};
  const root=new Element(document,'main'),settings=new Element(document,'aside');
  const state={authority:1,permission:true,indexes:[index],stored:null,read:async value=>value.parentEventId?{eventId:value.eventId,text:state.stored.text,parent:null,attachment:null}:{...decoded},download:async()=>Uint8Array.of(1,2,3).buffer,publish:async()=>{}};
  let view;
  const filter=mountLocalContentFilter({root,settingsContainer:settings,classifier,storage:{getItem:()=>String(enabled),setItem(){}},onChanged:()=>{void view.reload()}});
  const checkbox=find(settings,'input');
  const assertCurrent=binding=>{calls.permissions++;if(!state.permission||binding!==state.authority)throw Error('CONTROLLED_ORIGINAL_PERMISSION_REVOKED')};
  const drafts={async load(binding){assertCurrent(binding);return structuredClone(state.stored)},async save(intent,binding){assertCurrent(binding);calls.saves.push(structuredClone(intent));state.stored=structuredClone(intent)},async clearConfirmed(nonce,binding,guard){assertCurrent(binding);guard?.();assert.equal(nonce,state.stored.transactionId);calls.clears.push(nonce);state.stored=null}};
  const args={root,contentFilter:filter,capture:()=>state.authority,assertCurrent,loadIndexes:async()=>{calls.loads++;return {indexes:structuredClone(state.indexes)}},consumer:{async read(value){calls.read.push(structuredClone(value));if(!state.permission)throw Error('CONTROLLED_ORIGINAL_PERMISSION_REVOKED');return state.read(value)}},commentDrafts:drafts,commentSender:async binding=>{assertCurrent(binding);return sender},publishComment:async value=>{assertCurrent(value.binding);assert.equal(value.transactionId,state.stored.transactionId,'Original intent must be reserved before send');calls.publishes.push(structuredClone(value));await state.publish(value)},downloadAttachment:async value=>{value.guard();assertCurrent(value.binding);calls.downloads.push(value);return state.download(value)}};
  view=mountRestrictedFeed(args);
  t.after(()=>{view.destroy();filter.destroy()});
  return {root,settings,state,calls,filter,document,get view(){return view},toggle(value){checkbox.checked=value;checkbox.onchange()},body:()=>find(root,'article')?.children[0],draft:()=>root.children.find(node=>node.tagName==='section')?.children[3],async reload(){await view.reload();await settle()},async submit(text){const form=find(root,'form');assert.ok(form,'Actual feed must create the comment form');find(form,'textarea').value=text;await form.fire('submit');await settle()},async recover(){await button(root,'Verify original pending comment').fire('click');await settle()},remount(){view.destroy();view=mountRestrictedFeed(args)}};
}

test('actual mount/reload body and indexed comment fail closed with enabled unavailable model',async t=>{
  const f=fixture(t,{enabled:true});
  f.state.indexes=[index,{...index,eventId:'$indexed-comment',parentEventId:index.eventId,sender}];
  f.state.read=async value=>value.parentEventId?{eventId:value.eventId,text:'AUTHORIZED INDEXED COMMENT',parent:null}:{...decoded};
  await f.reload();
  const articles=descendants(f.root).filter(node=>node.tagName==='article');assert.equal(articles.length,2);
  for(const article of articles){assert.equal(article.children[0].dataset.localFilterState,'unavailable');assert.equal(article.children[0].textContent,'Unchecked content hidden.')}
  assert.equal(f.root.textContent.includes(original),false);assert.equal(f.root.textContent.includes('AUTHORIZED INDEXED COMMENT'),false);
  assert.equal(f.calls.read.length,2);
  await button(f.root,'Download encrypted attachment').fire('click');
  assert.equal(f.calls.downloads.length,0);assert.equal(f.calls.urls.length,0);
});

test('off recovery re-reads the original indexed content through current permissions',async t=>{
  const f=fixture(t,{enabled:true});await f.reload();const reads=f.calls.read.length,permissions=f.calls.permissions,retiredForm=find(f.root,'form');
  f.toggle(false);await settle();assert.equal(f.body().textContent,original);
  assert.equal(f.calls.read.length,reads+1);assert.ok(f.calls.permissions>permissions);
  find(retiredForm,'textarea').value='RETIRED RELOAD COMMENT';await retiredForm.fire('submit');
  assert.equal(f.calls.read.length,reads+1);assert.equal(f.calls.saves.length,0);assert.equal(f.calls.publishes.length,0);
  await f.submit('AUTHORIZED COMMENT');assert.equal(f.calls.publishes.length,1);
  assert.deepEqual(f.calls.publishes[0].index,index);assert.deepEqual(f.calls.publishes[0].parent,parent);
  assert.equal(f.calls.saves[0].transactionId,f.calls.publishes[0].transactionId);assert.equal(f.state.stored,null);
  const authorizedReads=f.calls.read.length;f.state.authority++;
  await f.submit('CHANGED AUTHORITY MUST NOT SEND');
  assert.equal(f.calls.read.length,authorizedReads);assert.equal(f.calls.saves.length,1);assert.equal(f.calls.publishes.length,1);assert.equal(f.state.stored,null);
});

test('off cannot restore body/comment/attachment after original permission is revoked',async t=>{
  const f=fixture(t,{enabled:true});await f.reload();const oldForm=find(f.root,'form'),oldDownload=button(f.root,'Download encrypted attachment');
  f.state.permission=false;f.toggle(false);await settle();
  assert.equal(find(f.root,'article'),undefined);assert.equal(f.root.textContent.includes(original),false);
  find(oldForm,'textarea').value='REVOKED COMMENT';await oldForm.fire('submit');await oldDownload.fire('click');
  assert.equal(f.calls.saves.length,0);assert.equal(f.calls.publishes.length,0);assert.equal(f.calls.downloads.length,0);assert.equal(f.calls.urls.length,0);
});

test('late body decryption after enable cannot pass the real display gate',async t=>{
  const f=fixture(t),late=deferred();f.state.read=()=>late.promise;
  const loading=f.view.reload();await settle();assert.equal(f.calls.read.length,1);
  f.toggle(true);late.resolve({...decoded,text:'LATE DECRYPTED BODY'});await loading;await settle();
  assert.equal(f.body().dataset.localFilterState,'unavailable');assert.equal(f.root.textContent.includes('LATE DECRYPTED BODY'),false);
});

test('late attachment after enable never creates a URL and returned bytes are wiped',async t=>{
  const f=fixture(t);await f.reload();const late=deferred(),bytes=Uint8Array.of(91,92,93).buffer;f.state.download=()=>late.promise;
  const downloading=button(f.root,'Download encrypted attachment').fire('click');await settle();assert.equal(f.calls.downloads.length,1);
  f.toggle(true);late.resolve(bytes);await downloading;await settle();
  assert.equal(f.calls.urls.length,0);assert.equal(f.document.downloadLinks.length,0);assert.deepEqual([...new Uint8Array(bytes)],[0,0,0]);
});

test('off attachment positive control uses original index, guard, URL revoke and byte wipe',async t=>{
  const f=fixture(t);await f.reload();const bytes=Uint8Array.of(7,8).buffer;f.state.download=async()=>bytes;
  await button(f.root,'Download encrypted attachment').fire('click');
  assert.deepEqual(f.calls.downloads[0].index,index);assert.deepEqual(f.calls.downloads[0].attachment,decoded.attachment);
  assert.equal(f.calls.urls.length,1);assert.deepEqual(f.document.downloadLinks,[{href:'blob:controlled',download:'original.bin'}]);
  assert.deepEqual(f.calls.revoked,['blob:controlled']);assert.deepEqual([...new Uint8Array(bytes)],[0,0]);
});

for(const enabled of [false,true])test(`messages refresh retains actual feed moments body, enabled=${enabled}`,async t=>{
  const classifier=enabled?{supportedMimeTypes:['text/plain'],async classify(){return safe}}:undefined;
  const f=fixture(t,{enabled,classifier});await f.reload();assert.equal(f.body().textContent,original);
  const message=new Element(f.document,'p');f.filter.renderText(message,'CURRENT MESSAGE',{id:'message:one',scope:'messages',assertCurrent(){}});await settle();
  assert.equal(message.textContent,'CURRENT MESSAGE');f.filter.cancel('messages');await settle();
  assert.equal(f.body().textContent,original);assert.equal(message.textContent,'Unchecked content hidden.');
});

for(const operation of ['lock','destroy'])test(`late decryption and retained actions reject old ${operation} generation`,async t=>{
  const f=fixture(t);await f.reload();const oldForm=find(f.root,'form'),oldDownload=button(f.root,'Download encrypted attachment'),late=deferred();
  f.state.read=()=>late.promise;const loading=f.view.reload();await settle();f.view[operation]();
  late.resolve({...decoded,text:'RETIRED DECRYPTED BODY'});await loading;await settle();
  find(oldForm,'textarea').value='RETIRED COMMENT';await oldForm.fire('submit');await oldDownload.fire('click');
  assert.equal(f.root.textContent.includes('RETIRED DECRYPTED BODY'),false);assert.equal(find(f.root,'article'),undefined);
  assert.equal(f.calls.saves.length,0);assert.equal(f.calls.publishes.length,0);assert.equal(f.calls.downloads.length,0);
});

test('delete/reload rejects retained attachment from the removed generation',async t=>{
  const f=fixture(t);await f.reload();const oldDownload=button(f.root,'Download encrypted attachment');
  f.state.indexes=[];await f.reload();assert.equal(find(f.root,'article'),undefined);
  await oldDownload.fire('click');assert.equal(f.calls.downloads.length,0);assert.equal(f.calls.urls.length,0);
});

test('delete/reload rejects retained comment submit from the removed generation',async t=>{
  const f=fixture(t);await f.reload();const oldForm=find(f.root,'form'),reads=f.calls.read.length;
  f.state.indexes=[];await f.reload();assert.equal(find(f.root,'article'),undefined);
  find(oldForm,'textarea').value='DELETED GENERATION COMMENT';await oldForm.fire('submit');
  // The indexed parent can still be decrypted by the authority port. The old
  // view generation itself must reject this retained event before re-reading.
  assert.deepEqual({reads:f.calls.read.length-reads,saves:f.calls.saves.length,publishes:f.calls.publishes.length},{reads:0,saves:0,publishes:0},'Retired comment form must not capture the new epoch and send');
});

test('late classifier completion from deleted generation cannot render its original',async t=>{
  const late=deferred();let signal;
  const f=fixture(t,{enabled:true,classifier:{supportedMimeTypes:['text/plain'],classify(_bytes,_mime,abort){signal=abort;return late.promise}}});
  await f.reload();const oldBody=f.body();assert.equal(oldBody.dataset.localFilterState,'pending');
  f.state.indexes=[];await f.reload();assert.equal(signal.aborted,true);late.resolve(safe);await settle();
  assert.equal(oldBody.textContent.includes(original),false);assert.equal(f.root.textContent.includes(original),false);
});

test('late classifier completion after lock cannot render the retired body',async t=>{
  const late=deferred();const f=fixture(t,{enabled:true,classifier:{supportedMimeTypes:['text/plain'],classify(){return late.promise}}});
  await f.reload();const oldBody=f.body();f.view.lock();late.resolve(safe);await settle();
  assert.equal(oldBody.textContent.includes(original),false);assert.equal(find(f.root,'article'),undefined);
});

test('late attachment after lock refuses release and wipes bytes',async t=>{
  const f=fixture(t);await f.reload();const late=deferred(),bytes=Uint8Array.of(9,10).buffer;f.state.download=()=>late.promise;
  const downloading=button(f.root,'Download encrypted attachment').fire('click');await settle();f.view.lock();late.resolve(bytes);await downloading;
  assert.equal(f.calls.urls.length,0);assert.equal(f.document.downloadLinks.length,0);assert.deepEqual([...new Uint8Array(bytes)],[0,0]);
});

test('UNKNOWN preserves exact original nonce/text/parent across enabled, off, reload, remount and recovery miss',async t=>{
  const f=fixture(t);await f.reload();f.state.publish=async()=>{throw Error('CONTROLLED_DELIVERY_UNKNOWN')};
  await f.submit('ORIGINAL UNKNOWN COMMENT');assert.equal(f.calls.publishes.length,1);
  const intent=structuredClone(f.state.stored);assert.equal(intent.status,'delivery-unknown');assert.deepEqual(intent.comment.parent,parent);
  f.toggle(true);await settle();assert.equal(f.draft().dataset.localFilterState,'unavailable');assert.equal(f.root.textContent.includes(intent.text),false);
  assert.deepEqual(f.state.stored,intent);await f.submit('REPLACEMENT MUST NOT SEND');assert.equal(f.calls.publishes.length,1);
  f.toggle(false);await settle();assert.equal(f.draft().textContent,intent.text);await f.reload();f.remount();await f.reload();
  await f.submit('REMOUNT REPLACEMENT MUST NOT SEND');await f.recover();
  assert.deepEqual(f.state.stored,intent);assert.equal(f.calls.saves.length,1);assert.equal(f.calls.clears.length,0);assert.equal(f.calls.publishes.length,1);
  assert.ok(f.root.textContent.includes('Original comment not confirmed.'));
  f.state.indexes=[index,{...index,eventId:'$original-confirmed-comment',transactionId:intent.transactionId,parentEventId:index.eventId,sender}];
  await f.recover();assert.equal(f.state.stored,null);assert.deepEqual(f.calls.clears,[intent.transactionId]);assert.equal(f.calls.publishes.length,1);
  assert.ok(f.root.textContent.includes('No resend performed.'));
});
