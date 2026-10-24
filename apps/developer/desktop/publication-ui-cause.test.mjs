import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs/promises';import{createRequire}from'node:module';import{duplexPair}from'node:stream';import vm from'node:vm';
const channel=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/project-contracts-channel.js');
const locale=createRequire(import.meta.url)('../runtime/ynx-workbench/lib/ynx-localization.js');
const source=await fs.readFile(new URL('../runtime/ynx-workbench/lib/artifact-publication-view.js',import.meta.url),'utf8');
class Node{constructor(document,tag){this.ownerDocument=document;this.tag=tag;this.children=[];this.listeners=new Map();}append(...items){this.children.push(...items);}setAttribute(){}addEventListener(event,fn){this.listeners.set(event,fn);}click(){if(!this.disabled)this.listeners.get('click')?.();}}
const document={createElement:tag=>new Node(document,tag)};class Widget{constructor(){this.node=new Node(document,'root');this.title={};this.toDispose=[];}dispose(){for(const d of this.toDispose)d.dispose();}}
const loaded={exports:{}};vm.runInNewContext(source,{module:loaded,require:name=>name==='@theia/core/lib/browser/widgets'?{BaseWidget:Widget}:{CommonMenus:{VIEW_VIEWS:[]}}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const code of ['IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED','IDE_PUBLICATION_NOT_SUPPLIED','IDE_PUBLICATION_PROJECT_RETIRED','IDE_PUBLICATION_PUBLISHER_UNAVAILABLE','IDE_ARTIFACT_FRESH_APPROVAL_REQUIRED'])test(`actual private pipe retains only public cause ${code}`,async()=>{
 const[a,b]=duplexPair(),server=channel.serve(a,{call:async()=>{throw Object.assign(Error('SECRET backend path and private details'),{code,secret:'SECRET'});},close:async()=>{}}),client=channel.client(b);
 try{await assert.rejects(client.call('publication-observe',{requestId:'11111111-2222-3333-4444-555555555555'}),error=>{assert.equal(error.code,code);assert.doesNotMatch(error.message,/SECRET/);assert.equal(error.secret,undefined);return true;});}finally{client.close();server.close();}
});
test('unknown private cause stays generic and does not expose raw backend error',async()=>{
 const[a,b]=duplexPair(),server=channel.serve(a,{call:async()=>{throw Object.assign(Error('SECRET'),{code:'SECRET_UNREVIEWED_CAUSE'});},close:async()=>{}}),client=channel.client(b);
 try{await assert.rejects(client.call('publication-observe',{requestId:'11111111-2222-3333-4444-555555555555'}),error=>{assert.equal(error.code,'IDE_CONTRACT_SERVICE_UNAVAILABLE');assert.doesNotMatch(error.message,/SECRET/);return true;});}finally{client.close();server.close();}
});
test('actual Widget distinguishes missing original Source without printing arbitrary exceptions',async()=>{
 const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{throw Object.assign(Error('SECRET'),{code:'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED'});}},{},(_key,text)=>text);
 widget.fields.requestId.value='11111111-2222-3333-4444-555555555555';widget.buttons.observe.click();await tick();assert.match(widget.status.textContent,/original project identity/i);assert.doesNotMatch(widget.status.textContent,/SECRET/);widget.dispose();
});
test('dispose before the queued picker executes never opens a native window',async()=>{
 let picks=0;const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{throw Error('must not run');}},{ynxDesktopFiles:{open:async()=>{picks++;return{cancelled:true};}}},(_key,text)=>text);
 widget.buttons.choose.click();widget.dispose();await tick();assert.equal(picks,0);
});
test('actual Widget receives the public Source cause through the private pipe end to end',async()=>{
 const[a,b]=duplexPair(),server=channel.serve(a,{call:async()=>{throw Object.assign(Error('SECRET original payload'),{code:'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED'});},close:async()=>{}}),client=channel.client(b);
 // The real frontend RPC serializes browser objects before Node validates
 // them. Keep that JSON boundary; a VM-realm object is intentionally rejected
 // by the Node pipe's plain-object guard if passed directly.
 const project={call:(action,body)=>client.call(action,JSON.parse(JSON.stringify(body)))};
 const widget=new loaded.exports.ArtifactPublicationWidget(project,{},(_key,text)=>text);
 try{widget.fields.requestId.value='11111111-2222-3333-4444-555555555555';widget.buttons.observe.click();await tick();assert.match(widget.status.textContent,/original project identity/i);assert.doesNotMatch(widget.status.textContent,/SECRET/);}finally{widget.dispose();client.close();server.close();}
});
test('malformed next frame retires the pipe before its queued host action can start',async()=>{
 let calls=0,closes=0;const[a,b]=duplexPair(),server=channel.serve(a,{call:async()=>{calls++;return{};},close:async()=>{closes++;}});
 try{b.write(JSON.stringify({id:1,action:'references',body:{}})+'\n'+JSON.stringify({id:2,action:'invalid-private-frame',body:{}})+'\n');await tick();assert.equal(closes,1);assert.equal(calls,0);}finally{b.destroy();server.close();}
});
test('owned Chinese localization supplies fixed diagnostics without claiming an editor language pack',async()=>{
 for(const key of ['publicationProjectSourceMissing','publicationProjectChanged','publicationArtifactChanged','publicationArtifactOutsideProject','publicationServiceMissing']){assert.ok(locale.EN_DEFAULTS['ynx/workbench/'+key]);assert.match(locale.TRANSLATIONS['ynx/workbench/'+key],/[\u4e00-\u9fff]/);}
 const translate=(key,fallback)=>locale.TRANSLATIONS['ynx/workbench/'+key]??fallback;
 const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{throw Object.assign(Error('SECRET'),{code:'IDE_PROJECT_ORIGINAL_SOURCE_NOT_SUPPLIED'});}},{},translate);
 widget.fields.requestId.value='11111111-2222-3333-4444-555555555555';widget.buttons.observe.click();await tick();assert.equal(widget.status.textContent,'正式项目身份来源尚未就绪，本地编辑、运行和调试仍可使用。');widget.dispose();
});
test('empty or malformed request ID is a local field error and never calls the service',async()=>{
 let calls=0;const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{calls++;return{};}},{},(_key,text)=>text);
 for(const id of ['','not-a-request','11111111-2222-3333-4444-55555555555']){widget.fields.requestId.value=id;widget.buttons.observe.click();await tick();assert.equal(calls,0);assert.match(widget.status.textContent,/valid saved deployment request/i);}
 widget.dispose();
});
test('missing review fields are explained locally instead of reporting a service failure',async()=>{
 let calls=0;const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{calls++;return{};}},{ynxDesktopFiles:{open:async()=>({uris:['file:///PUBLIC/build/server.mjs']})}},(_key,text)=>text);
 widget.buttons.choose.click();await tick();widget.buttons.review.click();await tick();assert.equal(calls,0);assert.match(widget.status.textContent,/version.*purpose.*environment/i);widget.dispose();
});
test('null publisher is shown as unavailable and never as a request to create or sign a key',async()=>{
 const widget=new loaded.exports.ArtifactPublicationWidget({call:async()=>{throw Object.assign(Error('SECRET'),{code:'IDE_PUBLICATION_PUBLISHER_UNAVAILABLE'});}},{},(key,text)=>locale.TRANSLATIONS['ynx/workbench/'+key]??text);
 widget.fields.requestId.value='11111111-2222-3333-4444-555555555555';widget.buttons.observe.click();await tick();assert.equal(widget.status.textContent,'当前项目没有正式注册的发布者，本次没有请求上传或签名。');widget.dispose();
});
