import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';

const fixture=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
import {encryptAttachment} from 'matrix-encrypt-attachment';
import {getHttpUriForMxc} from 'matrix-js-sdk/lib/content-repo.js';
import {MatrixSocialTransport} from './web/matrix/transport.mjs';
import {RestrictedMoments} from './web/matrix/restricted-moments.mjs';
import {mountRestrictedFeed} from './web/matrix/restricted-feed-ui.mjs';
const original=new TextEncoder().encode('Original mounted feed attachment');
const encrypted=await encryptAttachment(original.buffer);
const owner='@original:fixture.invalid';
const audience={protocol:'ynx-social-matrix-moment/v1',kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner,members:[owner]};
const index={audience,eventId:'$original',sender:owner,transactionId:'original_transaction_123'};
const content={msgtype:'m.file',body:'original.txt',file:{...encrypted.info,url:'mxc://media.fixture.invalid/original'},'com.ynx.social.moment':{protocol:audience.protocol,kind:'moment',audience:audience.kind,revision:audience.revision,owner,author:owner,text:'Original caption'}};
const record={id:index.eventId,sender:owner,encrypted:true,verification:{shieldColour:0},content};
const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
window.created=0;window.revoked=0;URL.createObjectURL=blob=>{window.created++;return create(blob)};URL.revokeObjectURL=url=>{window.revoked++;return revoke(url)};
window.setup=async(mode='valid')=>{
  window.view?.destroy();document.querySelector('main').replaceChildren();window.created=0;window.revoked=0;window.finished=false;window.authorized=true;window.release=null;
  let generation=1;
  const transport=new MatrixSocialTransport({fetcher:async()=>{
    if(mode==='pending')return new Promise(resolve=>{window.release=()=>resolve(new Response(encrypted.data))});
    if(mode==='account-change')generation++;
    if(mode==='revoke')window.authorized=false;
    if(mode==='oversize')return new Response(encrypted.data,{headers:{'content-length':String(25*1024*1024+1)}});
    if(mode==='hash-damaged'){const bytes=new Uint8Array(encrypted.data.slice(0));bytes[0]^=1;return new Response(bytes)};
    return new Response(encrypted.data);
  }});
  transport.binding={homeserver:'https://hs.fixture.invalid/',accessToken:'isolated-software-qa-not-a-real-token',userId:owner,deviceId:'original-device'};
  transport.client={mxcUrlToHttp:(uri,...args)=>getHttpUriForMxc(transport.binding.homeserver,uri,...args),getRoom:()=>({getMembers:()=>[{userId:owner,membership:'join'}]}),stopClient(){}};
  transport.messages=async()=>[structuredClone(record)];
  const consumer=new RestrictedMoments({transport,authorize:async()=>{if(!window.authorized)throw Error('revoked');return structuredClone(audience)}});
  const assertCurrent=binding=>{if(binding!==generation)throw Error('stale account view')};
  window.view=mountRestrictedFeed({root:document.querySelector('main'),consumer,loadIndexes:async()=>({indexes:[structuredClone(index)]}),capture:()=>generation,assertCurrent,downloadAttachment:async({index,attachment,binding,guard})=>{
    try{return await consumer.downloadAttachment(index,attachment,{assertCurrent:()=>{guard();assertCurrent(binding)},validateIdentity:async()=>{assertCurrent(binding);if(!window.authorized)throw Error('BrowserSSO revoked')}})}finally{window.finished=true}
  }});
  await window.view.reload();
};
await window.setup();window.ready=true;
`},bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'});
const browser=await chromium.launch({headless:true});
const results=[],consoleErrors=[];
try{
  const page=await browser.newPage({acceptDownloads:true});
  page.on('pageerror',error=>consoleErrors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())});
  await page.route('**/*',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><main></main><script type="module" src="/fixture.mjs"></script>'});
    if(path==='/fixture.mjs')return route.fulfill({contentType:'text/javascript',body:fixture.outputFiles[0].text});
    return route.abort();
  });
  await page.goto('https://feed-media-fixture.invalid/');await page.waitForFunction(()=>window.ready);
  const tabsBefore=page.context().pages().length,urlBefore=page.url();
  const button=()=>page.getByRole('button',{name:'Download encrypted attachment',exact:true});
  const [download]=await Promise.all([page.waitForEvent('download'),button().click()]);
  assert.equal(download.suggestedFilename(),'original.txt');assert.equal(readFileSync(await download.path(),'utf8'),'Original mounted feed attachment');
  await page.waitForFunction(()=>document.querySelector('main').textContent.includes('verified and downloaded'));
  assert.deepEqual(await page.evaluate(()=>({created,revoked})),{created:1,revoked:1});
  results.push({name:'actual mounted feed button downloads SDK-decrypted original bytes and revokes object URL',status:'PASS'});
  for(const mode of ['hash-damaged','revoke','account-change','oversize']){
    await page.evaluate(mode=>window.setup(mode),mode);await button().click();await page.waitForFunction(()=>window.finished);
    await page.waitForFunction(()=>document.querySelector('main').textContent.includes('No plaintext fallback'));
    assert.equal(await page.evaluate(()=>window.created),0);assert.equal(await page.locator('article').count(),0);
    results.push({name:mode+' yields no Blob or stale plaintext feed',status:'PASS'});
  }
  await page.evaluate(()=>window.setup('pending'));await button().click();await page.waitForFunction(()=>typeof window.release==='function');
  await page.evaluate(()=>{window.view.lock();window.release()});await page.waitForFunction(()=>window.finished);
  assert.equal(await page.evaluate(()=>window.created),0);assert.equal(await page.locator('article').count(),0);
  results.push({name:'lock while original media fetch pending prevents late Blob creation',status:'PASS'});
  assert.equal(page.url(),urlBefore);assert.equal(page.context().pages().length,tabsBefore);
  results.push({name:'stable URL and one tab, no blank page',status:'PASS'});
  assert.deepEqual(consoleErrors,[]);results.push({name:'console and page errors zero',status:'PASS'});
  console.log(JSON.stringify({qualification:'isolated real browser mounted feed/SDK/WebCrypto/stream/download; controlled session and authority, not normal live login or public/installed HS proof',results},null,2));
}finally{await browser.close()}
