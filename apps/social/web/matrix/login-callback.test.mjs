import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,cp,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script,createContext} from 'node:vm';
import {build} from 'esbuild';
import {runMatrixLoginCallbackPage} from './login-callback-entry.mjs';
import {handleMatrixLoginCallback} from './login.mjs';

// All credentials here are synthetic. No production account or authority is used.
const origin='https://social.ynxweb4.com',path='/matrix/login/callback';
const token='fixture-login-only',state='a'.repeat(64);
const href=`${origin}${path}?state=${state}&loginToken=${token}#fixture`;
function fixture(url=href){
 const order=[],status={textContent:'Returning sign-in'},body={textContent:'brand preserved'};
 const environment={location:{href:url,replace(value){order.push('navigate');this.href=new URL(value,origin).href}},history:{replaceState(a,b,value){order.push('scrub');environment.location.href=new URL(value,origin).href}},document:{body,getElementById:id=>id==='callback-status'?status:null},opener:{postMessage(message,target){order.push('delivery');assert.equal(target,origin);assert.deepEqual(message,{type:'ynx-social-matrix-login-token',state,loginToken:token})}},close(){order.push('close')}};
 return {environment,order,status,body};
}
test('already-scrubbed bootstrap snapshot is delivered once with the exact Social origin',()=>{
 const f=fixture();f.environment.history.replaceState(null,'',path);
 assert.equal(runMatrixLoginCallbackPage({callbackHref:href,environment:f.environment}),true);
 assert.deepEqual(f.order,['scrub','scrub','delivery','close']);
 assert.equal(f.environment.location.href,origin+path);assert.equal(f.body.textContent,'brand preserved');
 assert.equal(handleMatrixLoginCallback({callbackHref:href,environment:f.environment}),true);
 assert.equal(f.order.filter(value=>value==='delivery').length,1);
 assert.match(f.status.textContent,/already been used/);
});
for(const query of ['',`?state=${state}`,`?loginToken=${token}`,`?state=invalid&loginToken=${token}`,`?state=${state}&state=${state}&loginToken=${token}`,`?state=${state}&loginToken=${token}&loginToken=duplicate`])test('invalid synthetic callback is scrubbed without delivery: '+query.replaceAll(token,'fixture').replaceAll(state,'nonce'),()=>{
 const f=fixture(origin+path+query+'#discard');
 assert.equal(runMatrixLoginCallbackPage({callbackHref:f.environment.location.href,environment:f.environment}),true);
 assert.deepEqual(f.order,['scrub']);assert.equal(f.environment.location.href,origin+path);
 assert.match(f.status.textContent,/unavailable or expired/);assert.equal(f.body.textContent,'brand preserved');
});
test('orphan callback keeps branded retry page and never delivers credentials',()=>{
 const f=fixture();f.environment.opener=null;
 assert.equal(runMatrixLoginCallbackPage({callbackHref:href,environment:f.environment}),true);
 assert.deepEqual(f.order,['scrub']);assert.match(f.status.textContent,/unavailable or expired/);
});
for(const url of ['https://other.example.test'+path,origin+'/other'])test('snapshot or current page cannot cross the fixed origin/path: '+url,()=>{
 const f=fixture(url);assert.equal(runMatrixLoginCallbackPage({callbackHref:href,environment:f.environment}),false);
 assert.deepEqual(f.order,[]);
 const exact=fixture();assert.equal(runMatrixLoginCallbackPage({callbackHref:url+'?state='+state+'&loginToken='+token,environment:exact.environment}),false);assert.deepEqual(exact.order,[]);
});
test('delivery exception is sanitized and cannot replay the credential',()=>{
 const f=fixture();let deliveries=0;
 f.environment.opener.postMessage=()=>{deliveries++;throw Error(token+' '+href)};
 assert.equal(runMatrixLoginCallbackPage({callbackHref:href,environment:f.environment}),false);
 assert.equal(f.status.textContent.includes(token),false);assert.equal(f.status.textContent.includes(href),false);
 runMatrixLoginCallbackPage({callbackHref:href,environment:f.environment});assert.equal(deliveries,1);
});
test('missing snapshot produces only a safe retry message',()=>{
 const f=fixture(origin+path);assert.equal(runMatrixLoginCallbackPage({environment:f.environment}),false);assert.deepEqual(f.order,[]);assert.match(f.status.textContent,/unavailable/);
});
test('actual HTML bootstrap scrubs before its sole module import and DOM readiness (isolated VM fixture)',async()=>{
 const html=await readFile(new URL('./login-callback.html',import.meta.url),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1],f=fixture();
 let ready,imported;f.environment.document.readyState='loading';
 f.environment.document.addEventListener=(name,fn,options)=>{assert.equal(name,'DOMContentLoaded');assert.equal(options.once,true);ready=fn};
 const context=createContext({window:f.environment,document:f.environment.document});
 new Script(script,{importModuleDynamically:async specifier=>{imported=specifier;f.order.push('import');assert.equal(f.environment.location.href,origin+path);return import('./login-callback-entry.mjs')}}).runInContext(context);
 assert.equal(f.order[0],'scrub');assert.equal(imported,'/matrix/login-callback-entry.mjs');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.order.includes('delivery'),false);
 ready();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(f.order,['scrub','import','scrub','delivery','close']);
 assert.ok(html.indexOf('<script>')<html.indexOf('<img '));
 assert.match(html,/<html lang="en">/);assert.match(html,/name="referrer" content="no-referrer"/);
 assert.match(html,/src="\/assets\/ynx-logo.png"/);assert.match(html,/href="\/" referrerpolicy="no-referrer"/);
 assert.equal(/<script[^>]+src=|<link\b|https?:\/\//.test(html),false);
});
test('bootstrap scrub failure navigates to a fixed clean URL without importing or delivering',async()=>{
 const html=await readFile(new URL('./login-callback.html',import.meta.url),'utf8');
 const f=fixture();f.environment.history.replaceState=()=>{throw Error('fixture')};let imported=false;
 new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1],{importModuleDynamically:async()=>{imported=true;return import('./login-callback-entry.mjs')}}).runInContext(createContext({window:f.environment,document:f.environment.document}));
 assert.equal(imported,false);assert.deepEqual(f.order,['navigate']);assert.equal(f.environment.location.href,origin+path);
});
test('bootstrap module failure shows a branded sanitized retry without delivery',async()=>{
 const html=await readFile(new URL('./login-callback.html',import.meta.url),'utf8'),f=fixture();f.environment.document.readyState='complete';
 new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1],{importModuleDynamically:async()=>{throw Error(token)}}).runInContext(createContext({window:f.environment,document:f.environment.document}));
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.order,['scrub']);assert.equal(f.status.textContent,'Sign-in is temporarily unavailable. Return to Social and retry.');assert.equal(f.body.textContent,'brand preserved');
});
test('callback-only build closes over two small owned modules without SDK/vendor/WASM in isolated output',async()=>{
 const output=await mkdtemp(join(tmpdir(),'ynx-social-callback-fixture-'));
 const root=fileURLToPath(new URL('../',import.meta.url));
 const result=await build({absWorkingDir:root,entryPoints:['matrix/login-callback-entry.mjs'],outfile:join(output,'matrix/login-callback-entry.mjs'),bundle:true,platform:'browser',format:'esm',target:'es2022',minify:false,metafile:true});
 assert.deepEqual(Object.keys(result.metafile.inputs).sort(),['matrix/login-callback-entry.mjs','matrix/login.mjs']);
 const bundle=await readFile(join(output,'matrix/login-callback-entry.mjs'),'utf8');
 assert.equal(/matrix-js-sdk|crypto-wasm|indexedDB|localStorage|sessionStorage|console\.|sourceMappingURL/.test(bundle),false);
 assert.ok(Buffer.byteLength(bundle)<10000);
 await cp(new URL('./login-callback.html',import.meta.url),join(output,'matrix/login-callback.html'));
 assert.ok((await stat(join(output,'matrix/login-callback.html'))).size>0);
 const contract=await readFile(new URL('../build.mjs',import.meta.url),'utf8');
 assert.ok(contract.includes("new URL('matrix/login-callback.html',out)"));assert.ok(contract.includes("entryPoints:['matrix/login-callback-entry.mjs']"));
});
