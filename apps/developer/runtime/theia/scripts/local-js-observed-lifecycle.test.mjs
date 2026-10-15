import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:net';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
const {adaptLocalJsDebugging}=createRequire(import.meta.url)('../../ynx-workbench/lib/plugin-vscode-init-adapter');
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(ok=>setTimeout(ok,5));}throw Error('Expected exact session lifecycle');};
async function fixture(fn,options={}){const root=await mkdtemp(join(tmpdir(),'yl-')),path=join(root,'s'),sockets=new Set(),observed=new Map(),cancelled=[],stops=[],messages=[],prepared=[];let provider,descriptorFactory,onStart,onEnd;
 const env={YNX_WORKSPACE_MODE:'local',YNX_JS_DEBUG_SOCKET:path,YNX_JS_DEBUG_CREDENTIAL:'a'.repeat(64),YNX_JS_DEBUG_PROJECT:'project',YNX_LOCAL_PROJECT_ID:'project',YNX_JS_DEBUG_LAUNCHER:'/runtime/local-js-debug-launcher.sh',YNX_JS_DEBUG_NODE:'/runtime/node'};
 const server=createServer(s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));let buffer='';s.on('data',data=>{buffer+=data;for(let i;(i=buffer.indexOf('\n'))>=0;){const q=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);assert.equal(q.credential,env.YNX_JS_DEBUG_CREDENTIAL);assert.equal(q.projectId,'project');if(q.op==='prepare'){const id=randomUUID();prepared.push(id);const send=()=>s.write(JSON.stringify({kind:'prepared',launchId:id})+'\n');if(options.prepare)options.prepare(q,send,id,s);else send();}else if(q.op==='observe'){observed.set(q.launchId,s);const send=()=>s.write('{"kind":"observing"}\n');if(options.observe)options.observe(q,send,s);else send();}else if(q.op==='cancel'){cancelled.push(q.launchId);s.write('{"kind":"cancelled"}\n');}}});});await new Promise(ok=>server.listen(path,ok));
 const api={window:{showErrorMessage:m=>messages.push(m)},debug:{registerDebugConfigurationProvider:(type,p)=>{provider=p;},registerDebugAdapterDescriptorFactory:(type,f)=>{descriptorFactory=f;},onDidStartDebugSession:cb=>onStart=cb,onDidTerminateDebugSession:cb=>onEnd=cb,stopDebugging:async session=>{stops.push(session.id);onEnd(session);}}};
 const lifecycle=adaptLocalJsDebugging(api,env);api.debug.registerDebugConfigurationProvider('pwa-node',{});
 const configure=()=>provider.resolveDebugConfigurationWithSubstitutedVariables(undefined,{type:'pwa-node',request:'launch',program:'/project/a.js',cwd:'/project',console:'integratedTerminal',noDebug:true});
 try{await fn({configure,prepared,resolve:configuration=>provider.resolveDebugConfigurationWithSubstitutedVariables(undefined,configuration),registerProvider:original=>api.debug.registerDebugConfigurationProvider('pwa-node',original),registerFactory:factory=>{api.debug.registerDebugAdapterDescriptorFactory('pwa-node',factory);return descriptorFactory;},onStart:session=>onStart(session),onEnd:session=>onEnd(session),observed,stops,cancelled,messages,lifecycle});}finally{await lifecycle.dispose();for(const s of sockets)s.destroy();await new Promise(ok=>server.close(ok));await rm(root,{recursive:true,force:true});}
}
test('fast result before session started ends exactly that session; unrelated concurrent launch survives',()=>fixture(async f=>{
 const a=await f.configure(),b=await f.configure();f.observed.get(a.__ynxJsLaunch).end('{"kind":"ended","code":0,"cancelled":false}\n');await new Promise(ok=>setImmediate(ok));
 f.onStart({id:'other',configuration:b});f.onStart({id:'finished',configuration:a});await until(()=>f.stops.length===1);assert.deepEqual(f.stops,['finished']);await until(()=>f.cancelled.includes(a.__ynxJsLaunch));assert.ok(!f.cancelled.includes(b.__ynxJsLaunch));
}));
test('cancel before late result cannot restart or stop another session; observer disconnect ends current session',()=>fixture(async f=>{
 const a=await f.configure(),session={id:'cancelled',configuration:a};f.onStart(session);f.onEnd(session);await until(()=>f.cancelled.length===1);f.observed.get(a.__ynxJsLaunch).end('{"kind":"ended","code":0,"cancelled":false}\n');
 const b=await f.configure();f.onStart({id:'disconnected',configuration:b});f.observed.get(b.__ynxJsLaunch).destroy();await until(()=>f.stops.length===1);assert.deepEqual(f.stops,['disconnected']);assert.ok(f.messages.some(x=>x.includes('disconnected')));
}));
test('prepare expiry or failed start ends Running session and reports failure',()=>fixture(async f=>{const a=await f.configure();f.onStart({id:'not-started',configuration:a});f.observed.get(a.__ynxJsLaunch).end('{"kind":"ended","code":null,"cancelled":true}\n');await until(()=>f.stops.length===1);assert.deepEqual(f.stops,['not-started']);assert.ok(f.messages.some(x=>x.includes('did not complete')));}));

const descriptorGate=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('R38 terminated admitted launch cannot return late adapter descriptor or affect replacement',()=>fixture(async f=>{
 const a=await f.configure(),b=await f.configure(),old={id:'TEST_ONLY_old',configuration:a},current={id:'TEST_ONLY_current',configuration:b},gate=descriptorGate(),entered=descriptorGate();let adapterStarts=0;
 const original={createDebugAdapterDescriptor:async session=>{if(session===old){entered.resolve();return gate.promise;}return{kind:'TEST_ONLY_descriptor',session:session.id};}};
 const factory=f.registerFactory(original),pending=factory.createDebugAdapterDescriptor(old).then(descriptor=>{adapterStarts++;return descriptor;});await entered.promise;
 f.onEnd(old);await f.lifecycle.whenIdle();f.onStart(current);
 const fresh=await factory.createDebugAdapterDescriptor(current);assert.equal(fresh.session,current.id);gate.resolve({kind:'TEST_ONLY_descriptor',session:old.id});
 await assert.rejects(pending,/launch has ended/);assert.equal(adapterStarts,0);assert.deepEqual(f.cancelled,[a.__ynxJsLaunch]);assert.deepEqual(f.stops,[]);assert.equal(current.configuration,b);
}));
test('R38 already terminated configuration never re-enters adapter factory',()=>fixture(async f=>{
 const configuration=await f.configure(),session={id:'TEST_ONLY_ended',configuration};f.onEnd(session);await f.lifecycle.whenIdle();let calls=0;
 const factory=f.registerFactory({createDebugAdapterDescriptor:async()=>{calls++;return{};}});
 await assert.rejects(factory.createDebugAdapterDescriptor(session),/launch has ended/);assert.equal(calls,0);assert.deepEqual(f.cancelled,[configuration.__ynxJsLaunch]);
}));
test('R38 current selected launch and ordinary unmarked descriptor retain original args and result',()=>fixture(async f=>{
 const configuration=await f.configure();configuration.name='TEST_ONLY_user_launch';configuration.env.USER_CHOICE='kept';const session={id:'TEST_ONLY_live',configuration},executable={command:'TEST_ONLY_adapter'},descriptor={port:4711},calls=[];
 const factory=f.registerFactory({createDebugAdapterDescriptor:async(...args)=>{calls.push(args);return descriptor;}});
 assert.equal(await factory.createDebugAdapterDescriptor(session,executable),descriptor);assert.equal(calls[0][0],session);assert.equal(calls[0][1],executable);assert.equal(configuration.name,'TEST_ONLY_user_launch');assert.equal(configuration.cwd,'/project');assert.equal(configuration.env.USER_CHOICE,'kept');
 const attach={id:'TEST_ONLY_attach',configuration:{type:'pwa-node',request:'attach'}};assert.equal(await factory.createDebugAdapterDescriptor(attach,executable),descriptor);assert.equal(calls[1][0],attach);assert.deepEqual(f.cancelled,[]);
}));
test('R38 original adapter failure remains first cause and cleans only that admitted launch',()=>fixture(async f=>{
 const a=await f.configure(),b=await f.configure(),original=Error('TEST_ONLY_original_descriptor_error');
 const factory=f.registerFactory({createDebugAdapterDescriptor:async()=>{throw original;}});
 await assert.rejects(factory.createDebugAdapterDescriptor({id:'TEST_ONLY_failure',configuration:a}),error=>error===original);assert.deepEqual(f.cancelled,[a.__ynxJsLaunch]);assert.ok(!f.cancelled.includes(b.__ynxJsLaunch));assert.deepEqual(f.stops,[]);
}));
test('R38 rebound session cannot redirect old descriptor failure cleanup onto new launch',()=>fixture(async f=>{
 const a=await f.configure(),b=await f.configure(),session={id:'TEST_ONLY_rebound',configuration:a},gate=descriptorGate(),entered=descriptorGate(),original=Error('TEST_ONLY_original_late_factory_error');
 const factory=f.registerFactory({createDebugAdapterDescriptor:async()=>{entered.resolve();await gate.promise;throw original;}});
 const pending=factory.createDebugAdapterDescriptor(session);await entered.promise;f.onEnd(session);await f.lifecycle.whenIdle();session.configuration=b;gate.resolve();
 await assert.rejects(pending,error=>error===original);assert.deepEqual(f.cancelled,[a.__ynxJsLaunch]);assert.ok(!f.cancelled.includes(b.__ynxJsLaunch));assert.deepEqual(f.stops,[]);
}));

function r44Gate(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
test('R44 late prepare after lifecycle disposal retires exact launch and returns no configuration',()=>{
 const entered=r44Gate();return fixture(async f=>{
  const pending=f.configure(),reply=await entered.promise;await f.lifecycle.dispose();reply.send();const configuration=await pending;
  assert.equal(configuration,null);assert.deepEqual(f.cancelled,[reply.id]);await f.lifecycle.dispose();assert.deepEqual(f.cancelled,[reply.id]);
 },{prepare(q,send,id){entered.resolve({send,id});}});
});
test('R44 late observer acknowledgement after disposal closes its subscription and cannot return configuration',()=>{
 const entered=r44Gate();return fixture(async f=>{
  const pending=f.configure(),reply=await entered.promise;await f.lifecycle.dispose();reply.send();assert.equal(await pending,null);
  await until(()=>reply.socket.destroyed);assert.deepEqual(f.cancelled,[reply.id]);await f.lifecycle.dispose();assert.deepEqual(f.cancelled,[reply.id]);
 },{observe(q,send,socket){entered.resolve({send,socket,id:q.launchId});}});
});
test('R44 official provider result after disposal cannot prepare or return a launch',()=>fixture(async f=>{
 const gate=r44Gate(),entered=r44Gate();f.registerProvider({resolveDebugConfigurationWithSubstitutedVariables:async(_folder,configuration)=>{entered.resolve();await gate.promise;return configuration;}});
 const pending=f.configure();await entered.promise;await f.lifecycle.dispose();gate.resolve();assert.equal(await pending,null);assert.deepEqual(f.prepared,[]);assert.deepEqual(f.cancelled,[]);
}));
test('R44 already disposed contribution refuses a new launch without supervisor admission',()=>fixture(async f=>{
 await f.lifecycle.dispose();assert.equal(await f.configure(),null);assert.deepEqual(f.prepared,[]);assert.deepEqual(f.cancelled,[]);
}));
test('R44 normal current launch and attach preserve original config and exact cleanup',()=>fixture(async f=>{
 const configuration=await f.configure();assert.ok(configuration.__ynxJsLaunch);assert.equal(configuration.program,'/project/a.js');assert.equal(configuration.console,'integratedTerminal');
 const attach={type:'pwa-node',request:'attach',port:9229};assert.equal(await f.resolve(attach),attach);assert.equal(f.prepared.length,1);f.onEnd({id:'R44_NORMAL',configuration});await f.lifecycle.whenIdle();assert.deepEqual(f.cancelled,[configuration.__ynxJsLaunch]);
}));
test('R44 original prepare error remains visible after disposal without cancelling another launch',()=>{
 const entered=r44Gate();return fixture(async f=>{
  const pending=f.configure(),reply=await entered.promise;await f.lifecycle.dispose();reply.send();assert.equal(await pending,null);assert.ok(f.messages.includes('Local JavaScript launch: TEST_ONLY_ORIGINAL_PREPARE_ERROR'));assert.deepEqual(f.cancelled,[]);
 },{prepare(q,send,id,socket){entered.resolve({send:()=>socket.write(JSON.stringify({kind:'error',message:'TEST_ONLY_ORIGINAL_PREPARE_ERROR'})+'\n')});}});
});
