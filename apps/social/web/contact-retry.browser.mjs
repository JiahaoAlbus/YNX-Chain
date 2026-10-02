import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Bundle the unmodified production UI handler. Only its transport/storage and
// camera imports are synthetic. Dialog and retry modules remain actual source.
const stubs={
  './private-session.js':`export const SOCIAL_CHAT_SCOPES=[];export function createSocialPrivateSession(){return {}}`,
  '../src/api.ts':`export class SocialAPI{constructor(){}}`,
  '../src/durableOutbox.ts':`export class DurableOutbox{constructor(){}}`,
  './contact-camera.mjs':`export async function scanContactQR(){return 'https://social.ynxweb4.com/people/sp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}`,
  './chat-workspace.ts':`export function browserChatDevices(){return {}};export class SocialWorkspace{
    constructor(client,api,devices,outbox,identity,publish){this.publish=publish;this.generation=1;this.previewCount=0;this.sent=[];this.fail=true;this.review=null;this.current={status:'Synthetic ready',account:'synthetic-actor',profile:{handle:'alice',displayName:'Alice',bio:''},contacts:[],requests:[],conversations:[],messages:[]};window.fixture=this}
    contactContextGuard(){const generation=this.generation;return()=>this.generation===generation}
    isContactPreviewCurrent(review){return this.review===review}
    cancelContactPreview(review){if(this.review===review)this.review=null}
    async previewContact(source,value){this.previewCount++;this.review={source,value,person:{id:'sp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',handle:value==='carol'?'carol':'bob',displayName:value==='carol'?'Carol':'Bob'},idempotencyKey:'synthetic-key-'+this.previewCount};return this.review}
    async confirmContact(review,message){this.sent.push({source:review.source,value:review.value,key:review.idempotencyKey,target:review.person.id,message});if(this.fail)throw new Error('Synthetic offline: outcome unknown');this.review=null;this.publish(this.current)}
    lock(){this.generation++;this.review=null;this.current={status:'Synthetic locked'};this.publish(this.current)}
  }`
};
const compiled=await build({entryPoints:[new URL('private-session-ui.js',import.meta.url).pathname],bundle:true,platform:'browser',format:'esm',write:false,plugins:[{name:'synthetic-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'synthetic'}:undefined);builder.onLoad({filter:/.*/,namespace:'synthetic'},args=>({contents:stubs[args.path],loader:'js'}))}}]});
const bundle=compiled.outputFiles[0].contents,css=await readFile(new URL('workspace.css',import.meta.url));
const ids=['private-auth-status','private-auth-account','private-auth-open','private-auth-begin','private-auth-restore','private-auth-disconnect','chat-open-wallet','workspace-status'];
const html=`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"><body>${ids.map(id=>'<button id="'+id+'"></button>').join('')}<section id="social-workspace"><div id="workspace-content"><span id="workspace-account"></span><form id="profile-form"><input name="handle"><input name="displayName"><input name="bio"></form><form id="contact-request-form"><select name="source"><option value="handle">Username</option><option value="qr">QR</option></select><input name="handle"><button type="submit">Preview person</button><button type="button" id="contact-scan-qr">Scan QR with camera</button></form>${['contact-list','contact-request-list','conversation-list','message-list'].map(id=>'<ul id="'+id+'"></ul>').join('')}<h3 id="conversation-title"></h3><form id="conversation-form"><input name="handle"></form><form id="message-form"><input name="message"></form>${['chat-authorize','chat-restore','chat-logout','workspace-refresh','protect-chat-device','message-retry'].map(id=>'<button id="'+id+'"></button>').join('')}</div></section><script type="module">await import('/ui.js');window.fixture.publish(window.fixture.current);window.ready=true;</script></body></html>`;
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/ui.js'?'text/javascript':request.url==='/workspace.css'?'text/css':'text/html');response.end(request.url==='/ui.js'?bundle:request.url==='/workspace.css'?css:html)});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
const output=await mkdtemp(join(tmpdir(),'ynx-social-exact-retry-browser-')),errors=[],checks=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:850}});page.on('pageerror',error=>errors.push(error.message));page.on('console',item=>{if(item.type()==='error')errors.push(item.text())});
  const open=async()=>{await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready)};
  const approve=async note=>{await page.locator('dialog textarea').fill(note);await page.getByRole('button',{name:'Send request',exact:true}).click();await page.getByRole('button',{name:'Retry exact request',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#contact-request-form button[type="submit"]').disabled)};
  await open();await page.locator('#contact-request-form input').fill('bob');await page.getByRole('button',{name:'Preview person',exact:true}).click();await approve('Original reviewed note');
  assert.ok(await page.getByText(/Original message: Original reviewed note/).isVisible());await page.screenshot({path:join(output,'failed-request-390.png')});
  await page.evaluate(()=>{window.fixture.fail=false});await page.getByRole('button',{name:'Retry reviewed request',exact:true}).click();await page.waitForFunction(()=>window.fixture.sent.length===2&&!document.querySelector('#contact-request-form button[type="submit"]').disabled);
  const form=await page.evaluate(()=>({count:window.fixture.previewCount,sent:window.fixture.sent}));assert.equal(form.count,1);assert.deepEqual(form.sent[0],form.sent[1]);checks.push('actual ordinary submit retries exact target/key/note without preview');

  await open();await page.getByRole('button',{name:'Scan QR with camera',exact:true}).click();await approve('QR original note');await page.evaluate(()=>{window.fixture.fail=false});await page.getByRole('button',{name:'Retry exact request',exact:true}).click();await page.waitForFunction(()=>window.fixture.sent.length===2&&!document.querySelector('#contact-request-form button[type="submit"]').disabled);
  const qr=await page.evaluate(()=>({count:window.fixture.previewCount,sent:window.fixture.sent}));assert.equal(qr.count,1);assert.equal(qr.sent[0].source,'qr');assert.deepEqual(qr.sent[0],qr.sent[1]);checks.push('actual QR handler preserves exact failed intent');

  await open();await page.locator('#contact-request-form input').fill('bob');await page.getByRole('button',{name:'Preview person',exact:true}).click();await approve('Old Bob note');await page.locator('#contact-request-form input').fill('carol');await page.getByRole('button',{name:'Preview person',exact:true}).click();assert.equal(await page.locator('dialog textarea').inputValue(),'');await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.evaluate(()=>window.fixture.sent.length),1);checks.push('editing target requires fresh explicit review and does not resend');

  await open();await page.locator('#contact-request-form input').fill('bob');await page.getByRole('button',{name:'Preview person',exact:true}).click();await approve('Account scoped note');await page.evaluate(()=>window.fixture.lock());assert.equal(await page.getByRole('button',{name:'Retry exact request',exact:true}).isVisible(),false);assert.equal(await page.evaluate(()=>window.fixture.sent.length),1);checks.push('account lock hides and disables old intent');
  assert.deepEqual(errors,[]);
  const sourceSha256={};for(const name of ['private-session-ui.js','contact-retry.mjs','contact-review.mjs','workspace.css'])sourceSha256[name]=createHash('sha256').update(await readFile(new URL(name,import.meta.url))).digest('hex');
  const receipt={schema:'ynx-social-web-exact-retry/v1',checks,consoleErrors:errors,sourceSha256,bundleSha256:createHash('sha256').update(bundle).digest('hex'),actualUIHandler:true,syntheticWorkspace:true,syntheticCamera:true,realBackendVerified:false,hardwareVerified:false,publicRuntimeVerified:false};await writeFile(join(output,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');process.stdout.write(JSON.stringify({status:'PASS',output,checks:checks.length,consoleErrors:errors.length,publicRuntimeVerified:false})+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
