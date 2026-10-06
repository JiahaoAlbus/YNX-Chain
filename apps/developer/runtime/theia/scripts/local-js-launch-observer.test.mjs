import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:net';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createRequire} from 'node:module';
const {observeLocalJsLaunch}=createRequire(import.meta.url)('../../ynx-workbench/lib/local-js-launch-observer');
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'yo-')),path=join(root,'o.sock'),sockets=new Set(),server=createServer(s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});await new Promise(ok=>server.listen(path,ok));try{await fn({server,env:{YNX_JS_DEBUG_SOCKET:path,YNX_LOCAL_PROJECT_ID:'project',YNX_JS_DEBUG_CREDENTIAL:'secret'}});}finally{for(const socket of sockets)socket.destroy();await new Promise(ok=>server.close(ok));await rm(root,{recursive:true,force:true});}}
test('ack and fast exit in same frame retain result and exact authenticated launch identity',()=>fixture(async({server,env})=>{
 server.on('connection',s=>s.once('data',raw=>{assert.deepEqual(JSON.parse(raw),{op:'observe',launchId:'owned',projectId:'project',credential:'secret'});s.end('{"kind":"observing"}\n{"kind":"ended","code":17,"cancelled":false}\n');}));
 let end;const result=new Promise(ok=>end=ok);const observer=await observeLocalJsLaunch(env,'owned',end);assert.deepEqual(await result,{code:17,cancelled:false});observer.dispose();
}));
test('disconnect after admission reports failure once; explicit disposal suppresses late result',()=>fixture(async({server,env})=>{
 let current;server.on('connection',s=>s.once('data',()=>{current=s;s.write('{"kind":"observing"}\n');}));let count=0,finish;const ended=new Promise(ok=>finish=ok);await observeLocalJsLaunch(env,'one',v=>{count++;finish(v);});current.destroy();assert.match((await ended).error,/disconnected/);assert.equal(count,1);
 const observer=await observeLocalJsLaunch(env,'two',()=>count++);observer.dispose();await new Promise(ok=>setImmediate(ok));assert.equal(count,1);
}));
test('invalid or refused admission rejects rather than waiting forever',()=>fixture(async({server,env})=>{server.on('connection',s=>s.once('data',()=>s.end('{"kind":"error"}\n')));await assert.rejects(observeLocalJsLaunch(env,'bad',()=>assert.fail()),/refused/);}));
