import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('../../services/language-service/node_modules/typescript/lib/typescript.js');
const source=await readFile(new URL('../src/runtime/PortPreviewDialog.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
assert.equal(compiled.diagnostics.length,0);
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
function fixture(){
 const hooks=[],effects=[],creates=[],revokes=[],closed=[];let index=0,pending=[],tree,disposed=false,lateWrites=0;
 const props={open:true,runtimeId:'TEST_ONLY_RUNTIME_A',projectId:'TEST_ONLY_PROJECT_A',onOpenChange:value=>{closed.push(value);props.open=value}};
 const grant=(runtimeId=props.runtimeId,projectId=props.projectId,port=3000,id='TEST_ONLY_PREVIEW_A')=>({runtimeId,projectId,port,previewId:id,url:'/runtime/previews/'+'a'.repeat(43)+'/',expiresAt:'2099-01-01T00:00:00.000Z',sandbox:'opaque-origin',network:'container-loopback-only',maximumResponseBytes:1024*1024});
 const api={createPortPreview:async(runtimeId,projectId,port)=>grant(runtimeId,projectId,port),revokePortPreview:async()=>{}};
 const react={useState(value){const i=index++;hooks[i]??={value};return[hooks[i].value,next=>{if(disposed)lateWrites++;hooks[i].value=typeof next==='function'?next(hooks[i].value):next}]},
 useRef(value){const i=index++;hooks[i]??={current:value};return hooks[i]},
 useEffect(fn,deps){const i=index++,old=effects[i];if(!old||deps.some((v,n)=>v!==old.deps[n]))pending.push(()=>{old?.cleanup?.();effects[i]={deps,cleanup:fn()}})}};
 const jsx=(type,props)=>({type,props}),exports={};
 vm.runInNewContext(compiled.outputText,{exports,Error,Date,Number,require:id=>{
  if(id==='react')return react;if(id==='react/jsx-runtime')return{jsx,jsxs:jsx};
  if(id==='@radix-ui/react-dialog')return{Root:'DialogRoot',Portal:'Portal',Overlay:'Overlay',Content:'Content',Title:'Title',Description:'Description'};
  if(id==='lucide-react')return{RefreshCcw:'Refresh',X:'X'};if(id==='../components/ui/button')return{Button:'button'};
  if(id==='./client')return{createPortPreview:(...args)=>{creates.push(args);return api.createPortPreview(...args)},revokePortPreview:(...args)=>{revokes.push(args);return api.revokePortPreview(...args)}};
  throw Error('Unexpected preview dependency '+id);
 }});
 const render=(next={})=>{assert.equal(disposed,false);Object.assign(props,next);index=0;pending=[];tree=exports.PortPreviewDialog(props);for(const fn of pending)fn();};
 const nodes=()=>{const list=[];const walk=node=>{if(Array.isArray(node))node.forEach(walk);else if(node&&typeof node==='object'){list.push(node);walk(node.props?.children)}};walk(tree);return list};
 const button=label=>{const node=nodes().find(n=>n.type==='button'&&(n.props['aria-label']===label||n.props.children===label||(Array.isArray(n.props.children)&&n.props.children.some(x=>typeof x==='string'&&x.trim()===label))));assert.ok(node,label);return node.props};
 const approve=()=>{const b=nodes().find(n=>n.type==='button'&&['Approve preview','Replace preview grant'].includes(n.props.children));assert.ok(b);assert.equal(b.props.disabled,false);b.props.onClick();};
 const settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve();if(!disposed)render()};
 const text=()=>{const out=[];const walk=n=>{if(Array.isArray(n))n.forEach(walk);else if(n&&typeof n==='object')walk(n.props?.children);else if(typeof n==='string')out.push(n)};walk(tree);return out.join(' ')};
 const dispose=()=>{for(const effect of effects)effect?.cleanup?.();disposed=true};
 render();return{api,props,creates,revokes,closed,grant,render,button,approve,settle,text,dispose,iframe:()=>nodes().find(n=>n.type==='iframe')?.props,get lateWrites(){return lateWrites}};
}
test('R49 close while creation awaits cannot resurrect grant when dialog reopens',async()=>{
 const f=fixture(),reply=gate();f.api.createPortPreview=()=>reply.promise;
 try{f.approve();await f.settle();f.button('Close port preview').onClick();await f.settle();reply.resolve(f.grant());await f.settle();f.render({open:true});await f.settle();assert.equal(f.iframe(),undefined);assert.deepEqual(f.revokes,[['TEST_ONLY_RUNTIME_A','TEST_ONLY_PREVIEW_A']]);}
 finally{reply.resolve(f.grant());f.dispose();}
});
test('R49 runtime switch isolates late successful create and cannot clear newer busy state',async()=>{
 const f=fixture(),old=gate(),current=gate();let call=0;f.api.createPortPreview=()=>++call===1?old.promise:current.promise;
 try{f.approve();await f.settle();f.render({runtimeId:'TEST_ONLY_RUNTIME_B',projectId:'TEST_ONLY_PROJECT_B'});await f.settle();f.approve();await f.settle();old.resolve(f.grant('TEST_ONLY_RUNTIME_A','TEST_ONLY_PROJECT_A'));await f.settle();assert.equal(f.button('Approve preview').disabled,true);assert.equal(f.iframe(),undefined);current.resolve(f.grant(undefined,undefined,3000,'TEST_ONLY_B'));await f.settle();assert.ok(f.iframe());assert.deepEqual(f.revokes,[['TEST_ONLY_RUNTIME_A','TEST_ONLY_PREVIEW_A']]);}
 finally{old.resolve(f.grant('TEST_ONLY_RUNTIME_A','TEST_ONLY_PROJECT_A'));current.resolve(f.grant());f.dispose();}
});
test('R49 project switch within same runtime retires exact old project grant',async()=>{
 const f=fixture();try{f.approve();await f.settle();assert.ok(f.iframe());f.render({projectId:'TEST_ONLY_PROJECT_B'});await f.settle();assert.equal(f.iframe(),undefined);assert.deepEqual(f.revokes,[['TEST_ONLY_RUNTIME_A','TEST_ONLY_PREVIEW_A']]);f.approve();await f.settle();assert.ok(f.iframe());}
 finally{f.dispose();}
});
test('R49 slow close cleanup cannot close reopened replacement or release its grant',async()=>{
 const f=fixture(),cleanup=gate();let calls=0;f.api.revokePortPreview=()=>++calls===1?cleanup.promise:Promise.resolve();
 try{f.approve();await f.settle();f.button('Close port preview').onClick();assert.deepEqual(f.closed,[false]);f.render({open:false});await f.settle();f.render({open:true});await f.settle();f.api.createPortPreview=async()=>f.grant(undefined,undefined,3000,'TEST_ONLY_NEW');f.approve();await f.settle();assert.ok(f.iframe());cleanup.resolve();await f.settle();assert.equal(f.props.open,true);assert.ok(f.iframe());assert.deepEqual(f.closed,[false]);}
 finally{cleanup.resolve();f.dispose();}
});
test('R49 unmount during creation revokes late exact grant without state writes',async()=>{
 const f=fixture(),reply=gate();f.api.createPortPreview=()=>reply.promise;f.approve();await f.settle();f.dispose();reply.resolve(f.grant());await f.settle();assert.equal(f.lateWrites,0);assert.deepEqual(f.revokes,[['TEST_ONLY_RUNTIME_A','TEST_ONLY_PREVIEW_A']]);
});
test('R49 ordinary approve reload and close preserve actual grant envelope and owner',async()=>{
 const f=fixture();try{f.approve();await f.settle();assert.equal(f.creates.length,1);assert.ok(f.iframe());const url=f.iframe().src;f.button('Reload').onClick();await f.settle();assert.equal(f.iframe().src,url);f.button('Close port preview').onClick();await f.settle();assert.deepEqual(f.closed,[false]);assert.deepEqual(f.revokes,[['TEST_ONLY_RUNTIME_A','TEST_ONLY_PREVIEW_A']]);assert.equal(f.iframe(),undefined);}
 finally{f.dispose();}
});
test('R49 current create failure becomes retryable through original button',async()=>{
 const f=fixture();let calls=0;f.api.createPortPreview=async()=>{if(++calls===1)throw Error('TEST_ONLY_CURRENT_FAILURE');return f.grant()};
 try{f.approve();await f.settle();assert.match(f.text(),/CURRENT_FAILURE/);assert.equal(f.button('Approve preview').disabled,false);f.approve();await f.settle();assert.ok(f.iframe());assert.doesNotMatch(f.text(),/CURRENT_FAILURE/);}
 finally{f.dispose();}
});
test('R49 old rejection after context change cannot overwrite newer request recovery state',async()=>{
 const f=fixture(),old=gate(),current=gate();let calls=0;f.api.createPortPreview=()=>++calls===1?old.promise:current.promise;
 try{f.approve();await f.settle();f.render({projectId:'TEST_ONLY_PROJECT_B'});await f.settle();f.approve();await f.settle();old.reject(Error('TEST_ONLY_RETIRED_FAILURE'));await f.settle();assert.doesNotMatch(f.text(),/RETIRED_FAILURE/);assert.equal(f.button('Approve preview').disabled,true);current.resolve(f.grant());await f.settle();assert.ok(f.iframe());}
 finally{old.resolve(f.grant());current.resolve(f.grant());f.dispose();}
});

test('R49 invalid service envelope remains denied without alternate runtime or preview fallback',async()=>{
 const f=fixture();f.api.createPortPreview=async()=>({...f.grant(),network:'TEST_ONLY_UNADMITTED_NETWORK'});
 try{f.approve();await f.settle();assert.equal(f.iframe(),undefined);assert.match(f.text(),/invalid capability envelope/);assert.deepEqual(f.creates,[['TEST_ONLY_RUNTIME_A','TEST_ONLY_PROJECT_A',3000]]);assert.equal(f.button('Approve preview').disabled,false);}
 finally{f.dispose();}
});

test('R49 stale mismatched envelope never revokes an uncorrelated preview or writes departed UI',async()=>{
 const f=fixture(),reply=gate();f.api.createPortPreview=()=>reply.promise;f.approve();await f.settle();f.dispose();
 reply.resolve(f.grant('TEST_ONLY_UNRELATED_RUNTIME','TEST_ONLY_PROJECT_A'));await f.settle();assert.equal(f.lateWrites,0);assert.deepEqual(f.revokes,[]);
});
