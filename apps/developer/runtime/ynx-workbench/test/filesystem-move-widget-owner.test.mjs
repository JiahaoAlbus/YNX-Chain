import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs=require("fs");const req=createRequire(new URL("../../theia/node_modules/@theia/filesystem/lib/browser/filesystem-frontend-contribution.js",import.meta.url)),URI=req("@theia/core/lib/common/uri").default;const fsSource=fs.readFileSync(req.resolve("@theia/filesystem/lib/browser/filesystem-frontend-contribution"),"utf8"),shellSource=fs.readFileSync(req.resolve("@theia/core/lib/browser/shell/application-shell"),"utf8");function method(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);if(a<0||b<0)throw Error("Native method boundary");return source.slice(a,b).trim()}const browser={Saveable:{get:w=>w.saveable},StatefulWidget:{is:w=>typeof w.restoreState==="function"},NavigatableWidgetOptions:{is:o=>typeof o.uri==="string"}},methods=[method(fsSource,"    popMoveSnapshot(","    applyMoveSnapshot("),method(fsSource,"    applyMoveSnapshot(","    async pushMove("),method(fsSource,"    async pushMove(","    async revertMove("),method(fsSource,"    async applyMove(","    createMoveToUri("),method(fsSource,"    createMoveToUri(","    async updateWidgets(")],close=method(shellSource,"    async closeWidget(id, options) {","    /**");const native=Function("browser_1","return ({"+methods.join(",\n")+"})")(browser),nativeClose=Function("saveable_1","widgets_2","return ({"+close+"}).closeWidget")({SaveableWidget:{is:w=>typeof w.closeWithSaving==="function"}},{waitForClosed:async()=>{}});

const {installOn}=require('../lib/filesystem-move-widget-owner');
function fixture({custom=false}={}) {
 const oldUri=new URI('file:///TEST_ONLY_PROJECT/a.cpp'),newUri=new URI('file:///TEST_ONLY_PROJECT/b.cpp');
 const closed=[],saveFlags=[];
 const make=(id,text)=>({id,isDisposed:false,isVisible:true,resource:oldUri,
  getResourceUri(){return this.resource},createMoveToUri:u=>u,
  editor:custom?undefined:{document:{version:1}},
  saveable:{dirty:true,text,createSnapshot(){return this.text},async revert(){this.dirty=false},
   applySnapshot(text){this.text=text;this.dirty=true}},
  storeState(){return {selection:{line:4,character:2}}},restoreState(v){this.view=v},
  async closeWithSaving(o){saveFlags.push(o.shouldSave());closed.push(this);this.isDisposed=true}
 });
 const old=make('TEST_ONLY_SOURCE','TEST_ONLY_OLD_UNSAVED'),target=make('TEST_ONLY_TARGET','TEST_ONLY_DISK');
 target.resource=newUri;target.saveable.dirty=false;
 let resolve,reject,entered;
 const waiting=new Promise(r=>entered=r),gate=new Promise((a,b)=>{resolve=a;reject=b});
 const shell={widgets:[old],activeWidget:old,pendingUpdates:Promise.resolve(),
  getWidgetById(id){return this.widgets.find(w=>w.id===id)},
  toTrackedStack(id){return this.widgets.filter(w=>w.id===id)},closeWidget:nativeClose,
  getAreaFor:()=> 'main',
  addWidget:async w=>{if(!shell.widgets.includes(w))shell.widgets.push(w)},
  activateWidget:async()=>{},revealWidget:async()=>{}};
 const prototype=Object.assign({},native);
 if(!process.env.YNX_R52_UNPATCHED) installOn(prototype,w=>w.saveable);
 const c=Object.assign(Object.create(prototype),{moveSnapshots:new Map(),shell,
  widgetManager:{getDescription:()=>({factoryId:'editor',options:{uri:oldUri.toString()}}),
   getOrCreateWidget:async()=>{entered();return gate}}});
 const event={operation:2,source:oldUri,target:newUri,correlationId:1};
 return {old,target,shell,c,make,closed,saveFlags,resolve,reject,waiting,oldUri,
  async start(){await c.pushMove(oldUri,old,event);return {pending:c.applyMove(oldUri,old,event)}},
  async finish(pending){resolve(target);await pending},
  assertMigrated(){assert.equal(target.saveable.text,'TEST_ONLY_OLD_UNSAVED');
   assert.equal(target.saveable.dirty,true);assert.deepEqual(target.view,{selection:{line:4,character:2}});
   assert.equal(target.resource.toString(),newUri.toString());}
 };
}
test('native ordinary rename preserves dirty snapshot, view, and closes exact source',async()=>{
 const f=fixture(),{pending}=await f.start();await f.waiting;await f.finish(pending);
 f.assertMigrated();assert.deepEqual(f.closed,[f.old]);assert.deepEqual(f.saveFlags,[false]);
 assert.equal(f.c.shell,f.shell);
});
test('closed and reopened same id retains new dirty owner',async()=>{
 const f=fixture(),{pending}=await f.start();await f.waiting;
 f.old.isDisposed=true;f.old.isVisible=false;
 const next=f.make(f.old.id,'TEST_ONLY_NEW_OWNER_DIRTY');f.shell.widgets=[next];f.shell.activeWidget=next;
 await f.finish(pending);f.assertMigrated();
 assert.equal(next.isDisposed,false);assert.equal(next.saveable.text,'TEST_ONLY_NEW_OWNER_DIRTY');
 assert.deepEqual(f.closed,[]);assert.deepEqual(f.saveFlags,[]);
});
test('same widget rebound to another document is not force closed',async()=>{
 const f=fixture(),{pending}=await f.start();await f.waiting;
 f.old.editor.document={version:1};await f.finish(pending);f.assertMigrated();
 assert.deepEqual(f.closed,[]);
});
test('typing while destination awaits retains newer source changes',async()=>{
 const f=fixture(),{pending}=await f.start();await f.waiting;
 f.old.saveable.text='TEST_ONLY_NEW_TYPING';f.old.saveable.dirty=true;f.old.editor.document.version++;
 await f.finish(pending);f.assertMigrated();assert.deepEqual(f.closed,[]);
 assert.equal(f.old.saveable.text,'TEST_ONLY_NEW_TYPING');
});
test('same id rebound to another URI is not force closed',async()=>{
 const f=fixture(),{pending}=await f.start();await f.waiting;
 f.old.resource=new URI('file:///TEST_ONLY_PROJECT/other.cpp');
 await f.finish(pending);f.assertMigrated();assert.deepEqual(f.closed,[]);
});
test('saveable owner replacement is not force closed',async()=>{
 const f=fixture(),{pending}=await f.start();await f.waiting;
 f.old.saveable=f.make('other','TEST_ONLY_REPLACEMENT').saveable;
 await f.finish(pending);f.assertMigrated();assert.deepEqual(f.closed,[]);
});
test('custom newly dirty unversioned source remains open',async()=>{
 const f=fixture({custom:true}),{pending}=await f.start();await f.waiting;
 f.old.saveable.dirty=true;f.old.saveable.text='TEST_ONLY_CUSTOM_NEW_TYPING';
 await f.finish(pending);f.assertMigrated();assert.deepEqual(f.closed,[]);
});
test('native factory rejection propagates unchanged for clean source',async()=>{
 const f=fixture();f.old.saveable.dirty=false;
 const {pending}=await f.start();await f.waiting;
 const failure=Error('TEST_ONLY_FACTORY_FAILURE');f.reject(failure);
 await assert.rejects(pending,e=>e===failure);assert.deepEqual(f.closed,[]);assert.equal(f.c.shell,f.shell);
});
test('concurrent moves keep per-call shells isolated',async()=>{
 const a=fixture(),b=fixture();
 const x=await a.start(),y=await b.start();await Promise.all([a.waiting,b.waiting]);
 const next=a.make(a.old.id,'TEST_ONLY_CONCURRENT_DIRTY');a.shell.widgets=[next];a.old.isDisposed=true;
 await Promise.all([a.finish(x.pending),b.finish(y.pending)]);
 assert.deepEqual(a.closed,[]);assert.deepEqual(b.closed,[b.old]);assert.equal(a.c.shell,a.shell);assert.equal(b.c.shell,b.shell);
 a.assertMigrated();b.assertMigrated();
});

test('native clean source still closes normally',async()=>{
 const f=fixture();f.old.saveable.dirty=false;
 const {pending}=await f.start();await f.waiting;await f.finish(pending);
 assert.deepEqual(f.closed,[f.old]);assert.deepEqual(f.saveFlags,[false]);
 assert.equal(f.target.saveable.dirty,false);
});
test('custom dirty source without soft revert or version stays recoverable',async()=>{
 const f=fixture({custom:true});delete f.old.saveable.revert;
 const {pending}=await f.start();await f.waiting;await f.finish(pending);
 f.assertMigrated();assert.deepEqual(f.closed,[]);assert.equal(f.old.saveable.dirty,true);
 assert.equal(f.old.saveable.text,'TEST_ONLY_OLD_UNSAVED');
});
