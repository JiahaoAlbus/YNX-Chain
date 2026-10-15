import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const req=createRequire(new URL('../../theia/node_modules/@theia/filesystem/lib/browser/filesystem-saveable-service.js',import.meta.url));
const require=createRequire(import.meta.url);
const URI=req('@theia/core/lib/common/uri').default;
const buffer=req('@theia/core/lib/common/buffer');
const source=fs.readFileSync(req.resolve('@theia/filesystem/lib/browser/filesystem-saveable-service'),'utf8');
const openerSource=fs.readFileSync(req.resolve('@theia/core/lib/browser/opener-service'),'utf8');
function method(a,b){const start=source.indexOf(a),end=source.indexOf(b,start+a.length);assert.ok(start>=0&&end>start);return source.slice(start,end).trim().replace(/\/\*\*[\s\S]*$/,'').trim();}
const openStart=openerSource.indexOf('async function open('),openEnd=openerSource.indexOf('function getDefaultHandler',openStart);
const open=Function('return ('+openerSource.slice(openStart,openEnd).trim()+')')();
const native=Function('browser_1','buffer_1','return ({'+[
 method('    async saveAs(','    async saveSnapshot('),
 method('    async saveSnapshot(','    async confirmOverwrite(')].join(',\n')+'})')(
 {CommonCommands:{SAVE_AS:{label:'Save As'}},Saveable:{Snapshot:{read:s=>s.read()}},open},buffer);
const {installOn}=require('../lib/filesystem-save-as-owner');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function fixture({exists=false,same=false,serialize=false,plugin=false}={}) {
 const chooser=deferred(),writing=deferred(),writeGate=deferred(),serialization=deferred(),serialized=deferred();
 const uri=new URI('file:///TEST_ONLY/source.cpp'),target=same?uri:new URI('file:///TEST_ONLY/target.cpp');
 const writes=[],opens=[],warnings=[],messages=[],saves=[],pluginCalls=[];
 const widget={id:'TEST_ONLY_EDITOR',isDisposed:false,resource:uri,editor:{document:{version:1}},
  selection:{line:4,character:2},getResourceUri(){return this.resource},
  saveable:{dirty:true,text:'TEST_ONLY_OLD',createSnapshot(){const text=this.text;return {read:()=>text}},
   async revert(){this.text='TEST_ONLY_DISK';this.dirty=false}}};
 if(serialize)widget.saveable.serialize=async()=>{const text=widget.saveable.text;serialized.resolve();await serialization.promise;return buffer.BinaryBuffer.fromString(text)};
 if(plugin)widget.saveable.saveAs=async o=>{pluginCalls.push(o)};
 const prototype=Object.assign({},native);
 if(!process.env.YNX_R53_UNPATCHED)installOn(prototype);
 const service=Object.assign(Object.create(prototype),{
  canSaveNotSaveAs:()=>true,save:async w=>{saves.push(w);return uri},
  fileDialogService:{showSaveDialog:()=>chooser.promise},
  fileService:{exists:async()=>exists,
   createFile:async(u,b)=>{writes.push({u:String(u),text:b.toString()});writing.resolve();await writeGate.promise},
   writeFile:async(u,b)=>{writes.push({u:String(u),text:b.toString()});writing.resolve();await writeGate.promise}},
  confirmOverwrite:async()=>true,
  openerService:{getOpener:async()=>({open:async(u,o)=>{opens.push({u:String(u),o});return 'TEST_ONLY_OPEN'}})},
  messageService:{info:async message=>messages.push(message)},logger:{warn:e=>warnings.push(e)}
 });
 return {service,widget,uri,target,chooser,writing,writeGate,serialization,serialized,writes,opens,warnings,messages,saves,pluginCalls,
  start(){return service.saveAs(widget)},
  choose(){chooser.resolve(target)},
  type(text){widget.saveable.text=text;widget.saveable.dirty=true;widget.editor.document.version++},
  async finish(pending){writeGate.resolve();return pending}};
}
test('normal native snapshot write and tab replacement keep original widget reference',async()=>{
 const f=fixture(),pending=f.start();f.choose();await f.writing.promise;const result=await f.finish(pending);
 assert.equal(String(result),String(f.target));assert.deepEqual(f.writes,[{u:String(f.target),text:'TEST_ONLY_OLD'}]);
 assert.equal(f.opens.length,1);assert.equal(f.opens[0].o.widgetOptions.ref,f.widget);
 assert.equal(f.opens[0].o.widgetOptions.mode,'tab-replace');assert.equal(f.widget.saveable.dirty,false);
});
test('native chooser cancellation changes neither buffer nor storage',async()=>{
 const f=fixture(),pending=f.start();f.chooser.resolve(undefined);assert.equal(await pending,undefined);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);assert.equal(f.widget.saveable.text,'TEST_ONLY_OLD');assert.equal(f.widget.saveable.dirty,true);
});
test('typing while chooser pending is included in the selected snapshot',async()=>{
 const f=fixture(),pending=f.start();f.type('TEST_ONLY_CHOOSER_TYPING');f.choose();await f.writing.promise;await f.finish(pending);
 assert.equal(f.writes[0].text,'TEST_ONLY_CHOOSER_TYPING');assert.equal(f.opens.length,1);
});
test('another active editor does not silently retarget the captured source',async()=>{
 const f=fixture(),pending=f.start();f.service.currentWidget={saveable:{text:'TEST_ONLY_OTHER_EDITOR'}};
 f.choose();await f.writing.promise;await f.finish(pending);assert.equal(f.writes[0].text,'TEST_ONLY_OLD');
});
test('disposed chooser source does not write or open a replacement',async()=>{
 const f=fixture(),pending=f.start();f.widget.isDisposed=true;f.writeGate.resolve();f.choose();await pending;
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);assert.equal(f.widget.saveable.dirty,true);
});
test('chooser source rebound to different document is retired',async()=>{
 const f=fixture(),pending=f.start();f.widget.editor.document={version:1};f.writeGate.resolve();f.choose();await pending;
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);
});
test('typing during acknowledged write remains dirty, selected and open',async()=>{
 const f=fixture(),pending=f.start();f.choose();await f.writing.promise;f.type('TEST_ONLY_DURING_WRITE');
 const result=await f.finish(pending);
 assert.equal(String(result),String(f.target));assert.equal(f.writes.length,1);assert.equal(f.writes[0].text,'TEST_ONLY_OLD');
 assert.equal(f.widget.saveable.text,'TEST_ONLY_DURING_WRITE');assert.equal(f.widget.saveable.dirty,true);
 assert.deepEqual(f.widget.selection,{line:4,character:2});assert.equal(String(f.widget.resource),String(f.uri));
 assert.deepEqual(f.opens,[]);assert.equal(f.messages.length,1);
});
test('typing during serialization retires before any storage write',async()=>{
 const f=fixture({serialize:true}),pending=f.start();f.choose();await f.serialized.promise;
 f.type('TEST_ONLY_DURING_SERIALIZE');f.writeGate.resolve();f.serialization.resolve();assert.equal(await pending,undefined);
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);assert.equal(f.widget.saveable.text,'TEST_ONLY_DURING_SERIALIZE');
});
test('write rejection is not replayed, reverted or reported as saved',async()=>{
 const f=fixture(),pending=f.start();f.choose();await f.writing.promise;
 const unknown=Error('TEST_ONLY_UNKNOWN_WRITE_RESULT');f.writeGate.reject(unknown);
 assert.equal(await pending,undefined);assert.equal(f.writes.length,1);assert.equal(f.widget.saveable.dirty,true);
 assert.deepEqual(f.opens,[]);assert.deepEqual(f.warnings,[unknown]);assert.deepEqual(f.messages,[]);
});
test('same URI still delegates original Save',async()=>{
 const f=fixture({same:true}),pending=f.start();f.choose();await pending;
 assert.deepEqual(f.saves,[f.widget]);assert.deepEqual(f.writes,[]);
});
test('native overwrite uses writeFile once and retains later typing',async()=>{
 const f=fixture({exists:true}),pending=f.start();f.choose();await f.writing.promise;
 f.type('TEST_ONLY_OVERWRITE_NEW');await f.finish(pending);
 assert.equal(f.writes.length,1);assert.equal(f.widget.saveable.text,'TEST_ONLY_OVERWRITE_NEW');assert.deepEqual(f.opens,[]);
});
test('custom plugin save implementation remains delegated',async()=>{
 const f=fixture({plugin:true}),pending=f.start();f.choose();await pending;
 assert.equal(f.pluginCalls.length,1);assert.deepEqual(f.writes,[]);assert.equal(f.opens.length,1);
});

test('closed chooser widget and reopened same-id widget are not saved by old request',async()=>{
 const f=fixture(),pending=f.start(),replacement={id:f.widget.id,saveable:{text:'TEST_ONLY_REOPENED',dirty:true}};
 f.widget.isDisposed=true;f.service.currentWidget=replacement;f.writeGate.resolve();f.choose();await pending;
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);
 assert.equal(replacement.saveable.text,'TEST_ONLY_REOPENED');assert.equal(replacement.saveable.dirty,true);
});
test('saveable rebound while chooser pending does not serialize new owner',async()=>{
 const f=fixture(),pending=f.start();f.widget.saveable={...f.widget.saveable,text:'TEST_ONLY_REBOUND'};
 f.writeGate.resolve();f.choose();await pending;assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);
 assert.equal(f.widget.saveable.text,'TEST_ONLY_REBOUND');
});
test('URI rebound during overwrite confirmation retires request before write',async()=>{
 const f=fixture({exists:true}),confirmation=deferred(),entered=deferred();
 f.service.confirmOverwrite=async()=>{entered.resolve();return confirmation.promise};
 const pending=f.start();f.choose();await entered.promise;
 f.widget.resource=new URI('file:///TEST_ONLY/other.cpp');f.writeGate.resolve();confirmation.resolve(true);await pending;
 assert.deepEqual(f.writes,[]);assert.deepEqual(f.opens,[]);
});
test('new typing while opener resolves does not replace source tab',async()=>{
 const f=fixture(),opening=deferred(),entered=deferred();
 f.service.openerService.getOpener=async()=>{entered.resolve();await opening.promise;
 return {open:async(u,o)=>f.opens.push({u:String(u),o})}};
 const pending=f.start();f.choose();await f.writing.promise;f.writeGate.resolve();await entered.promise;
 f.type('TEST_ONLY_DURING_OPEN');opening.resolve();await pending;
 assert.equal(f.writes.length,1);assert.deepEqual(f.opens,[]);
 assert.equal(f.widget.saveable.text,'TEST_ONLY_DURING_OPEN');assert.equal(f.widget.saveable.dirty,true);
});
