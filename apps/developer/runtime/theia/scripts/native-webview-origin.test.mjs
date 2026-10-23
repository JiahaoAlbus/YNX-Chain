import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {WebviewEnvironment}=require('@theia/plugin-ext/lib/main/browser/webview/webview-environment');
const {PluginApiContribution}=require('@theia/plugin-ext/lib/main/node/plugin-service');
const {PLUGIN_HOST_FRONTEND}=require('@theia/plugin-ext/lib/common/plugin-protocol');
const express=require('express');
const {install}=require('../../ynx-workbench/lib/native-webview-origin');
const original=WebviewEnvironment.prototype.externalEndpointUrl;
const view='11111111-2222-3333-4444-555555555555';
function setup(port=59712,options={}){
 const location=new URL('http://127.0.0.1:'+port+'/');globalThis.self={location};
 class ActualEnvironment extends WebviewEnvironment{};ActualEnvironment.prototype.externalEndpointUrl=original;
 const target={location,crypto:{randomUUID},__ynxNativeFilesystemBridgeEnabled:true,webkit:{messageHandlers:{ynxLocalWorkbench:{}}},...options};
 const installed=install(ActualEnvironment.prototype,target),env=new ActualEnvironment();env.environments={getValue:async()=>options.pattern?{value:options.pattern}:undefined};env.init();return {env,target,installed};
}
test('real native WebviewEnvironment creates a valid isolated loopback URL rather than numeric-host suffix',async()=>{
 const {env,installed}=setup();assert.equal(installed,true);const url=new URL((await env.externalEndpoint()).replace('{{uuid}}',view));
 assert.match(url.hostname,new RegExp('^'+view+'\\.[a-f0-9-]{36}\\.webview\\.localhost$'));assert.equal(url.port,'59712');assert.notEqual(url.origin,self.location.origin);
 const addresses=await lookup(url.hostname,{all:true});assert.ok(addresses.length>0);assert.ok(addresses.every(x=>['127.0.0.1','::1'].includes(x.address)));
 const csp=await env.cspSource(),root=await env.resourceRoot(PLUGIN_HOST_FRONTEND);assert.ok(csp.includes('.webview.localhost:59712'));assert.ok(root.includes('.webview.localhost:59712'));assert.ok(!csp.includes('127.0.0.1'));
});
test('original upstream vhost serves the isolated view route and still rejects its backend WebSocket upgrade',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ynx-webview-route-'));t.after(()=>rm(dir,{recursive:true}));await mkdir(join(dir,'lib/webview/pre'),{recursive:true});await writeFile(join(dir,'lib/webview/pre/index.html'),'<!doctype html><title>PUBLIC route marker</title>');
 const backend=new PluginApiContribution();backend.logger={info(){}};backend.applicationPackage={projectPath:dir};backend.remoteService={isRemoteServer:()=>false};backend.init();const app=express();backend.configure(app);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));const port=server.address().port,{env}=setup(port);const url=new URL((await env.externalEndpoint()).replace('{{uuid}}',view)+'/index.html');
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);assert.match(await response.text(),/PUBLIC route marker/);
 assert.equal(backend.serveSameOrigin,false);assert.equal(backend.allowWsUpgrade({headers:{origin:url.origin}}),false);assert.equal(backend.allowWsUpgrade({headers:{origin:'http://127.0.0.1:'+port}}),true);
 const parent=await fetch('http://127.0.0.1:'+port+'/webview/index.html');assert.equal(parent.status,404);
});
test('other windows retain separate document namespaces even on the same loopback port',async()=>{const a=setup(),aa=(await a.env.externalEndpoint()).replace('{{uuid}}',view);const b=setup(),bb=(await b.env.externalEndpoint()).replace('{{uuid}}',view);assert.notEqual(new URL(aa).origin,new URL(bb).origin);});
test('browser mode and remote or invalid native roots remain untouched',async()=>{for(const options of [{webkit:undefined},{__ynxNativeFilesystemBridgeEnabled:false},{location:new URL('https://example.invalid/')},{location:new URL('http://127.0.0.1/')},{location:new URL('http://localhost:59712/')}]){const {installed}=setup(59712,options);assert.equal(installed,false);}});
test('explicit upstream operator endpoint is preserved without contacting it',async()=>{const {env}=setup(59712,{pattern:'{{uuid}}.views.example.invalid:59712'});assert.equal(await env.externalEndpoint(),'http://{{uuid}}.views.example.invalid:59712/webview');});
test('navigation to another origin does not retain the native endpoint adapter',async()=>{const {env,target}=setup();target.location=new URL('https://example.invalid/');assert.equal(await env.externalEndpoint(),'http://{{uuid}}.webview.127.0.0.1:59712/webview');});
