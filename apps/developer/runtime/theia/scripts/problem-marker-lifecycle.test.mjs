import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),patch=require('../../ynx-workbench/lib/problem-marker-lifecycle');
require('reflect-metadata');
assert.equal(require('@theia/markers/package.json').version,'1.76.0');
const tree=require('@theia/core/lib/browser/tree/tree'),selection=require('@theia/core/lib/browser/tree/tree-selection'),expansion=require('@theia/core/lib/browser/tree/tree-expansion');
const URI=require('@theia/core/lib/common/uri').default,open=require('@theia/core/lib/browser/opener-service').open;
function nativeClasses(){
 const browser={...tree,...selection,...expansion,TreeModelImpl:class{},open,OpenerService:require('@theia/core/lib/browser/opener-service').OpenerService},cache=new Map();
 function load(name){if(cache.has(name))return cache.get(name);const filename=require.resolve(name),local=createRequire(filename),exports={};cache.set(name,exports);
  vm.runInNewContext(readFileSync(filename,'utf8'),{exports,require:id=>{
   if(id==='@theia/core/lib/browser')return browser;
   if(name.endsWith('marker-tree')&&id==='./marker-manager')return{MarkerManager:class{}};
   if(id==='../marker-tree'||id==='./marker-tree')return load('@theia/markers/lib/browser/marker-tree');
   if(name.endsWith('problem-tree-model')&&id==='../marker-tree-model')return load('@theia/markers/lib/browser/marker-tree-model');
   if(name.endsWith('problem-tree-model')&&id==='./problem-manager')return{ProblemManager:class{}};
   return local(id);
  }});return exports;
 }
 return load('@theia/markers/lib/browser/problem/problem-tree-model');
}
async function fixture(){
 const classes=nativeClasses();
 // Test-only baseline executes the actual retained caller with no owned fix,
 // matching the parent bootstrap before its new installer. Production never
 // reads this variable. No original dependency file is changed.
 if(process.env.YNX_TEST_PROBLEMS_NATIVE_BASELINE!=='1'){patch.installOn(classes.ProblemTree.prototype);patch.installOn(classes.ProblemTree.prototype);}
 const rows=new Map(),opened=[];let listener,queries=0;
 const manager={onDidChangeMarkers:fn=>{listener=fn;return{dispose(){}}},getUris:()=>[...rows].filter(([,v])=>v.length).map(([k])=>k),findMarkers:({uri})=>{queries++;return rows.get(uri.toString())||[]}};
 const value=new classes.ProblemTree(manager,{kind:'problem'});await value.refresh();
 const uri=name=>new URI('file:///TEST_ONLY_PROJECT/'+name);
 const marker=(resource,owner='TEST_ONLY_OWNER',line=1)=>({kind:'problem',owner,uri:resource.toString(),data:{message:'TEST_ONLY_DIAGNOSTIC',severity:1,range:{start:{line,character:2},end:{line,character:4}}}});
 const publish=async(resource,markers)=>{rows.set(resource.toString(),markers);await listener(resource)};
 const model=Object.create(classes.ProblemTreeModel.prototype);model.problemManager=manager;model.openerService={getOpener:async()=>({open:async(resource,options)=>{opened.push({resource,options})}})};
 const flush=()=>value.doInsertNodesWithMarkers.flush();
 const dispose=()=>{value.doInsertNodesWithMarkers.cancel();value.dispose()};
 return{value,manager,rows,opened,model,uri,marker,publish,flush,dispose,get queries(){return queries}};
}
test('R50 diagnostics cleared before native debounce flush cannot resurrect obsolete Problems row',async()=>{
 const f=await fixture(),uri=f.uri('closed.cpp');try{await f.publish(uri,[f.marker(uri)]);assert.equal(f.value.queuedMarkers.size,1);await f.publish(uri,[]);f.flush();assert.equal(f.manager.findMarkers({uri}).length,0);assert.equal(f.value.root.children.length,0);assert.equal(f.value.queuedMarkers.size,0);}finally{f.dispose()}
});
test('R50 existing visible file then queued diagnostics cleared stays removed after native flush',async()=>{
 const f=await fixture(),uri=f.uri('updated.cpp');try{await f.publish(uri,[f.marker(uri)]);f.flush();await f.publish(uri,[f.marker(uri,'TEST_ONLY_NEW',4)]);await f.publish(uri,[]);f.flush();assert.equal(f.value.root.children.length,0);}finally{f.dispose()}
});
test('R50 clearing one URI preserves another pending file and exact diagnostic owner',async()=>{
 const f=await fixture(),a=f.uri('a.cpp'),b=f.uri('b.cpp'),other=f.marker(b,'TEST_ONLY_OTHER');try{await f.publish(a,[f.marker(a)]);await f.publish(b,[other]);await f.publish(a,[]);f.flush();assert.equal(f.value.root.children.length,1);assert.equal(f.value.root.children[0].uri.toString(),b.toString());assert.equal(f.value.root.children[0].children[0].marker,other);assert.equal(f.manager.findMarkers({uri:b})[0],other);}finally{f.dispose()}
});
test('R50 fresh diagnostics after clear remain current and retain original zero-based selection',async()=>{
 const f=await fixture(),uri=f.uri('fresh.cpp'),fresh=f.marker(uri,'TEST_ONLY_CURRENT',8);try{await f.publish(uri,[f.marker(uri)]);await f.publish(uri,[]);await f.publish(uri,[fresh]);f.flush();assert.equal(f.value.root.children.length,1);const node=f.value.root.children[0].children[0];assert.equal(node.marker,fresh);const options=f.model.getOpenerOptionsByMarker(node);assert.equal(options.selection,fresh.data.range);}finally{f.dispose()}
});
test('R50 normal Problems open and reveal use original URI/range without changing marker collection',async()=>{
 const f=await fixture(),uri=f.uri('current.cpp'),diagnostic=f.marker(uri);try{await f.publish(uri,[diagnostic]);f.flush();const node=f.value.root.children[0].children[0];f.model.doOpenNode(node);f.model.revealNode(node);for(let n=0;n<4;n++)await Promise.resolve();assert.equal(f.opened.length,2);assert.equal(f.opened[0].resource,uri);assert.equal(f.opened[0].options.selection,diagnostic.data.range);assert.equal(f.opened[1].options.mode,'reveal');assert.equal(f.manager.findMarkers({uri})[0],diagnostic);}finally{f.dispose()}
});
test('R50 repeated current diagnostics preserve actual native owner replacement and refresh contract',async()=>{
 const f=await fixture(),uri=f.uri('owner.cpp');try{await f.publish(uri,[f.marker(uri,'TEST_ONLY_OLD')]);const latest=f.marker(uri,'TEST_ONLY_LATEST',3);await f.publish(uri,[latest]);f.flush();assert.equal(f.value.root.children[0].children.length,1);assert.equal(f.value.root.children[0].children[0].marker,latest);assert.equal(f.queries,2);}finally{f.dispose()}
});
