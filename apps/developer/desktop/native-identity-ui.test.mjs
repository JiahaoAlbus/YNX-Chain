import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const source=await fs.readFile(new URL('./native-identity-ui.js',import.meta.url),'utf8');
function fixture(){
  const frames=[],events=new Map(),timers=new Map();let clock=0;
  const window={webkit:{messageHandlers:{ynxLocalWallet:{postMessage:body=>frames.push(body)}}}};
  vm.runInNewContext(source,{window,location:{pathname:'/'},crypto:{randomUUID},DOMException,Error,Object,Promise,Map,TextEncoder,
    addEventListener:(name,fn)=>events.set(name,fn),setTimeout:fn=>{timers.set(++clock,fn);return clock;},clearTimeout:id=>timers.delete(id)});
  const reply=(body,extra={})=>window.__ynxIdentityReply({id:body.id,document:body.document,phase:'response-received',authorized:false,dataOnly:true,...extra});
  return {window,frames,events,timers,reply};
}
test('native UI sends only explicit receive/recover selection and returns DATA, never a grant',async()=>{
  const f=fixture(),pending=f.window.ynxDesktopIdentity.receive();const body=f.frames[0];
  assert.deepEqual(Object.keys(body).sort(),['action','document','id']);assert.equal(body.action,'native-identity-receive');
  f.reply(body,{document:randomUUID()});assert.equal(f.frames.length,1);
  f.reply(body,{authorized:true});assert.equal(f.frames.length,1);
  f.reply(body,{opaque:'PUBLIC_MUST_NOT_ESCAPE'});const value=await pending;
  assert.equal(JSON.stringify(value),'\u007b"phase":"response-received","authorized":false,"dataOnly":true}');
  assert.equal(f.frames[1].action,'native-identity-cancel');assert.equal(f.timers.size,0);
  const next=f.window.ynxDesktopIdentity.recover();f.reply(f.frames[2]);await next;
});
test('abort and late status never revive a UI request; no automatic retry',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.window.ynxDesktopIdentity.receive({signal:controller.signal});
  const body=f.frames[0];controller.abort();await assert.rejects(pending,{name:'AbortError'});
  f.reply(body);assert.equal(f.frames.length,2);assert.equal(f.frames[1].action,'native-identity-cancel');
});
test('correlated Native user cancellation maps to AbortError without synthesizing an approval or retry',async()=>{
  const f=fixture(),pending=f.window.ynxDesktopIdentity.receive();
  f.reply(f.frames[0],{error:'AUTH_IDENTITY_PEER_USER_CANCELLED'});
  await assert.rejects(pending,{name:'AbortError'});
  assert.equal(f.frames.length,2);assert.equal(f.frames[1].action,'native-identity-cancel');assert.equal(f.timers.size,0);
});
test('other Native failures are not relabelled as user cancellation',async()=>{
  const f=fixture(),pending=f.window.ynxDesktopIdentity.recover();
  f.reply(f.frames[0],{error:'AUTH_IDENTITY_CURRENT_UNAVAILABLE'});
  await assert.rejects(pending,error=>error.name==='Error'&&error.message.includes('AUTH_IDENTITY_CURRENT_UNAVAILABLE'));
  assert.equal(f.frames.length,2);
});
test('page retirement and timeout cancel the exact request, retain no active timer',async()=>{
  for(const mode of ['pagehide','timeout']){
    const f=fixture(),pending=f.window.ynxDesktopIdentity.recover();
    if(mode==='pagehide')f.events.get('pagehide')();else [...f.timers.values()][0]();
    await assert.rejects(pending);assert.equal(f.frames.length,2);assert.equal(f.frames[1].id,f.frames[0].id);assert.equal(f.timers.size,0);
  }
});
test('one active request and pre-aborted selection cannot dispatch another Native operation',async()=>{
  const f=fixture(),pending=f.window.ynxDesktopIdentity.receive();
  await assert.rejects(f.window.ynxDesktopIdentity.recover(),/already active/);
  const controller=new AbortController();controller.abort();await assert.rejects(f.window.ynxDesktopIdentity.recover({signal:controller.signal}),{name:'AbortError'});
  assert.equal(f.frames.length,1);f.reply(f.frames[0]);await pending;
});
async function widgetFixture(){
  const require=createRequire(import.meta.url),locale=require('../runtime/ynx-workbench/lib/native-wallet-localization.js');
  class Element{constructor(){this.children=[];this.events={};}append(...nodes){this.children.push(...nodes);}setAttribute(){}addEventListener(name,fn){this.events[name]=fn;}click(){this.events.click();}}
  const document={createElement:()=>new Element()};
  class BaseWidget{constructor(){this.node=new Element();this.node.ownerDocument=document;this.title={};this.toDispose=[];}dispose(){for(const item of this.toDispose)item.dispose();}onActivateRequest(){}}
  const loaded={exports:{}};
  vm.runInNewContext(await fs.readFile(new URL('../runtime/ynx-workbench/lib/native-wallet-view.js',import.meta.url),'utf8'),{module:loaded,AbortController,Promise,Error,require:name=>{
    if(name==='@theia/core/lib/browser/widgets')return {BaseWidget};
    if(name==='@theia/core/lib/browser/common-menus')return {CommonMenus:{VIEW_VIEWS:[]}};
    if(name==='@theia/core/lib/common/nls')return {nls:{localize:(_key,text)=>text}};
    if(name==='./native-wallet-localization')return locale;
    if(name==='./native-wallet-controller')return {};
    if(name==='./native-wallet-sdk.generated')return {};
    throw Error(name);
  }});
  let resolve;const entered=[],completion=new Promise(r=>resolve=r);
  const service={target:{ynxDesktopIdentity:{receive:options=>{entered.push(options);return completion;},recover:options=>{entered.push(options);return completion;}}},listeners:new Set(),controller:{state:{phase:'idle',session:{status:'disconnected'}},inspect:async()=>{},cancel:async()=>{}}};
  const widget=new loaded.exports.NativeWalletWidget(service),find=key=>widget.node.children.find(n=>n.textContent===locale.EN[key]);
  return {widget,service,entered,resolve,find,flush:()=>new Promise(r=>setImmediate(r)),locale};
}
test('actual Wallet Widget buttons dispatch Native identity once without promoting Product Session',async()=>{
  const f=await widgetFixture(),before=f.service.controller.state;
  f.find('identityReceive').click();f.find('identityRecover').click();await f.flush();assert.equal(f.entered.length,1);
  f.resolve({phase:'response-received',authorized:false,dataOnly:true});await f.flush();
  assert.ok(f.find('identityReceived'));assert.equal(f.service.controller.state,before);f.widget.dispose();
});
test('actual Widget cancel aborts its request and late response cannot display identity success',async()=>{
  const f=await widgetFixture();f.find('identityRecover').click();await f.flush();f.find('identityCancel').click();
  assert.ok(f.find('identityCancelled'));
  assert.equal(f.entered[0].signal.aborted,true);f.resolve({phase:'response-received',authorized:false,dataOnly:true});await f.flush();
  assert.equal(f.find('identityReceived'),undefined);f.widget.dispose();
});
test('actual Widget dispose cancels pending identity selection without later UI mutation',async()=>{
  const f=await widgetFixture();f.find('identityReceive').click();await f.flush();const text=f.widget.node.children.map(n=>n.textContent);
  f.widget.dispose();assert.equal(f.entered[0].signal.aborted,true);f.resolve({phase:'response-received',authorized:false,dataOnly:true});await f.flush();
  assert.deepEqual(f.widget.node.children.map(n=>n.textContent),text);
});
test('actual Foundation status guard rejects extra authority, wrong context and numeric booleans',{
  skip:process.platform!=='darwin'?'Requires Foundation':false,
},async()=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'ynx-identity-status-'));
  try{
    const include=fileURLToPath(new URL('./macos/',import.meta.url));
    await fs.writeFile(path.join(root,'test.m'),`#import "ynx-original-service-pipe.h"
      #import "ynx-native-identity-status.h"
      int main(){@autoreleasepool{
      NSDictionary *row=@{@"id":@"PUBLIC_ID",@"document":@"PUBLIC_DOC",@"instance":@"PUBLIC_INSTANCE",@"projectId":@"PUBLIC_PROJECT",@"workspace":@"/PUBLIC",@"kind":@"receive"};
      NSMutableDictionary *record=[row mutableCopy];[record addEntriesFromDictionary:@{@"schema":@"ynx-ide-native-identity-status/v1",@"phase":@"response-received",@"dataOnly":@YES,@"authorized":@NO}];
      if(!YNXNativeIdentityStatus(record,row))return 1;
      record[@"proof"]=@"PUBLIC";if(YNXNativeIdentityStatus(record,row))return 2;[record removeObjectForKey:@"proof"];
      record[@"authorized"]=@0;if(YNXNativeIdentityStatus(record,row))return 3;record[@"authorized"]=@NO;
      record[@"document"]=@"OTHER";if(YNXNativeIdentityStatus(record,row))return 4;record[@"document"]=row[@"document"];
      record[@"phase"]=@"failed";record[@"errorCode"]=@"PUBLIC_UNAVAILABLE";if(!YNXNativeIdentityStatus(record,row))return 5;
      record[@"errorCode"]=@"secret/raw error";if(YNXNativeIdentityStatus(record,row))return 6;
      return 0;}}`);
    execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-fobjc-arc','-Werror','-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk','-I'+include,'-framework','Foundation',path.join(root,'test.m'),'-o',path.join(root,'test')],{stdio:'pipe',timeout:20000});
    execFileSync(path.join(root,'test'),[],{stdio:'pipe',timeout:5000});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
