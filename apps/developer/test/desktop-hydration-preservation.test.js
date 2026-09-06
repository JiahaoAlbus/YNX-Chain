import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import test from 'node:test';
// Run the actual hydration effect with a deferred server reply and observable model writes.
const code=(await transform(await readFile(new URL('../frontend/src/app/Workbench.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'esm'})).code;
const start=code.indexOf('    let cancelled = false;'),end=code.indexOf('\n  }, [reconnect]);',start);
assert.ok(start>0&&end>start);
const body=code.slice(start,end);
function harness({different=false,editDuringLoad=false}={}) {
 const initial={id:'project',name:'P',files:{'main.cpp':different?'offline':'server'},folders:[],open:['main.cpp'],active:'main.cpp',revision:5,remoteRevision:3};
 let current=structuredClone(initial),resolve,hydrated=false,dirty=new Set(),runtime;
 const workspaceOf=p=>({name:p.name,folders:p.folders,files:p.files,open:p.open,active:p.active});
 const workspace=workspaceOf(initial),key=JSON.stringify(workspace),keyRef={current:key},lastSynced={current:''};
 const parameters={runtimeHealth:async()=>({sandboxReady:true}),loadWorkspace:()=>new Promise(r=>resolve=r),project:initial,workspace,workspaceKey:key,workspaceKeyRef:keyRef,lastSynced,
 setProject:value=>{current=typeof value==='function'?value(current):value;keyRef.current=JSON.stringify(workspaceOf(current))},setDirty:value=>{dirty=typeof value==='function'?value(dirty):value},setRuntime:value=>runtime=value,setConnectionBusy:()=>{},setHydrated:value=>hydrated=value,reconnect:async()=>{},saveWorkspace:async()=>{throw Error('unexpected remote write')}};
 const cleanup=new Function(...Object.keys(parameters),body)(...Object.values(parameters));
 return {async finish(){while(!resolve)await new Promise(r=>setImmediate(r));if(editDuringLoad){current={...current,files:{'main.cpp':'typed-during-load'},revision:6};keyRef.current=JSON.stringify(workspaceOf(current));}resolve({name:'P',files:{'main.cpp':'server'},folders:[],open:['main.cpp'],active:'main.cpp',revision:3});while(!hydrated)await new Promise(r=>setImmediate(r));return {current,dirty,runtime,lastSynced}},cleanup};
}
test('Windows/browser restored offline content survives a stale remote response without a Mac bridge',async()=>{const f=harness({different:true}),result=await f.finish();assert.equal(result.current.files['main.cpp'],'offline');assert.equal(result.runtime,'Recovered local changes');assert.ok(result.dirty.has('main.cpp'));f.cleanup()});
test('typing while remote hydration is pending cannot be overwritten by the captured initial project',async()=>{const f=harness({editDuringLoad:true}),result=await f.finish();assert.equal(result.current.files['main.cpp'],'typed-during-load');assert.equal(result.current.revision,6);f.cleanup()});
test('matching restored content retains its model revision and accepts server revision metadata',async()=>{const f=harness(),result=await f.finish();assert.equal(result.current.files['main.cpp'],'server');assert.equal(result.current.revision,5);assert.equal(result.current.remoteRevision,3);f.cleanup()});
