import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
const require=createRequire(import.meta.url);require('reflect-metadata');
const {HostedPluginProcess}=require('@theia/plugin-ext/lib/hosted/node/hosted-plugin-process');
const {install}=require('../../ynx-workbench/lib/local-plugin-shutdown');
async function fixture() {
 const directory=await mkdtemp('/private/tmp/ynx-plugin-stop-'),path=directory+'/host.cjs';
 await writeFile(path,"process.on('message', value=>{if(JSON.parse(value).type===0)process.send(JSON.stringify({type:1}));});process.send('ready');setInterval(()=>{},1000);");
 class Host extends HostedPluginProcess {}
 const lifecycle=install(Host.prototype),host=new Host(),notifications=[],errors=[];
 Object.assign(host,{configuration:{path},logger:{debug(){},info(){},error:value=>errors.push(value)},messageService:{error:value=>notifications.push(value)},localizationService:{getNlsConfig:()=>({})},pluginHostEnvironmentVariables:{getContributions:()=>[]},navigatorState:{},cli:{pluginHostStopTimeout:100,pluginHostTerminateTimeout:500},processUtils:{terminateProcessTree:pid=>process.kill(pid,'SIGTERM')}});
 host.childProcess=host.fork({serverName:'hosted-plugin',args:[]});const child=host.childProcess,exited=once(child,'exit');await once(child,'message');
 return{host,child,exited,lifecycle,notifications,errors};
}
test('awaited backend contribution uses real plugin IPC termination and preserves unexpected SIGTERM reporting',async()=>{
 const normal=await fixture();await normal.lifecycle.onStop();await normal.exited;assert.equal(normal.host.terminatingPluginServer,true);assert.deepEqual(normal.notifications,[]);assert.deepEqual(normal.errors,[]);assert.equal(normal.lifecycle.onStop(),normal.lifecycle.onStop());assert.throws(()=>normal.host.fork({serverName:'late',args:[]}),/shutdown/);
 const crash=await fixture();crash.child.kill('SIGTERM');await crash.exited;assert.equal(crash.notifications.length,1);assert.match(crash.notifications[0],/crashed unexpectedly/);assert.equal(crash.errors.length,1);await crash.lifecycle.onStop();
});
test('concurrent client disposal and backend shutdown await the same existing termination',async()=>{
 const f=await fixture();const first=f.host.terminatePluginServer(),second=f.host.terminatePluginServer();assert.equal(first,second);await f.lifecycle.onStop();await f.exited;assert.deepEqual(f.notifications,[]);
});
