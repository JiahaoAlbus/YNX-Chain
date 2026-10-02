import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const fixture=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
import {MatrixEvent} from 'matrix-js-sdk/lib/models/event.js';
import {encryptAttachment} from 'matrix-encrypt-attachment';
import {MatrixSocialTransport} from './web/matrix/transport.mjs';
import {createRestrictedMomentsUI} from './web/matrix/restricted-moments-ui.mjs';
import {matrixCryptoStore} from './web/matrix/crypto-store.mjs';
import {openProtectedMomentDrafts} from './web/matrix/protected-drafts.mjs';
const account='ynx1'+'a'.repeat(38),owner='@original:fixture.invalid',protocol='ynx-social-matrix-moment/v1';
const wrapped=await matrixCryptoStore(account);wrapped.storageKey.fill(0);
const vaultArgs={account,deviceId:wrapped.deviceId};
let vault=await openProtectedMomentDrafts(vaultArgs);
const audience={protocol,kind:'private',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner,members:[owner]};
const transactionId='original_transaction_123';
const codec=await encryptAttachment(new TextEncoder().encode('Original file').buffer);
const prepared={msgtype:'m.file',body:'original.txt',file:{...codec.info,url:'mxc://media.fixture.invalid/original'},info:{size:codec.data.byteLength,mimetype:'text/plain'}};
window.setup=async(mode)=>{
  const prior=await vault.load();if(prior)await vault.clearConfirmed(prior.transactionId);
  document.querySelector('main').replaceChildren();window.completed=false;window.sends=0;window.uploads=0;window.indexes=0;
  const original={status:'delivery-unknown',transactionId,text:'Original text',selection:{kind:'private'},file:mode==='file'?{name:'original.txt',type:'text/plain',base64:btoa('Original file')}:null,audience};
  if(mode==='file')original.preparedAttachment=prepared;
  await vault.save(original);vault.close();vault=await openProtectedMomentDrafts(vaultArgs);
  window.originalJSON=JSON.stringify(await vault.load());
  const content={msgtype:'m.text',body:original.text,'com.ynx.social.moment':{protocol,kind:'moment',audience:audience.kind,revision:audience.revision,owner,author:owner}};
  if(mode==='file'){content.msgtype='m.file';content.body=prepared.body;content.file=prepared.file;content.info=prepared.info;content['com.ynx.social.moment'].text=original.text}
  const event=new MatrixEvent({type:'m.room.message',event_id:'$original',room_id:audience.roomId,sender:owner,content,unsigned:{transaction_id:transactionId}});
  event.makeEncrypted('m.room.encrypted',{algorithm:'m.megolm.v1.aes-sha2',ciphertext:'isolated-sdk-event-not-runtime'},'isolated-curve','isolated-sign');
  const transport=new MatrixSocialTransport();transport.binding={account,userId:owner,deviceId:wrapped.deviceId};
  transport.client={getRoom:()=>({getMembers:()=>[{userId:owner,membership:'join'}],getLiveTimeline:()=>({getEvents:()=>mode==='missing'?[]:[event]})}),decryptEventIfNeeded:async()=>{},getCrypto:()=>({getEncryptionInfoForEvent:async()=>({shieldColour:0})}),sendMessage:async()=>{window.sends++;throw Error('no recovery send')},uploadContent:async()=>{window.uploads++;throw Error('no recovery upload')}};
  const capture=()=>({operation:transport.capture()}),guard=view=>transport.guard(view.operation);
  window.ui=createRestrictedMomentsUI({container:document.querySelector('main'),transport,capture,guard,identity:async view=>guard(view),work:async action=>{try{await action()}catch{}finally{window.completed=true}},resolveAudience:async()=>audience,authorize:async(_expected,action)=>{if(action.action==='index')window.indexes++;else if(mode==='late-revoke'&&window.indexes)throw Error('revoked');return structuredClone(audience)},drafts:{load:async view=>{guard(view);return vault.load(()=>guard(view))},clearConfirmed:async(view,txn)=>vault.clearConfirmed(txn,()=>guard(view))}});
};
window.saved=()=>vault.load();window.ready=true;
`},bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'});
const browser=await chromium.launch({headless:true});const results=[],errors=[];
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><main></main><script type="module" src="/fixture.mjs"></script>'});if(path==='/fixture.mjs')return route.fulfill({contentType:'text/javascript',body:fixture.outputFiles[0].text});return route.abort()});
  await page.goto('https://publication-recovery-fixture.invalid/');await page.waitForFunction(()=>window.ready);
  for(const mode of ['text','file','missing','late-revoke']){
    await page.evaluate(mode=>window.setup(mode),mode);
    await page.getByRole('button',{name:'Verify original publication without resending',exact:true}).click();await page.waitForFunction(()=>window.completed);
    const state=await page.evaluate(async()=>({saved:await window.saved(),originalJSON,sends,uploads,indexes,text:document.querySelector('main').textContent}));
    assert.equal(state.sends,0);assert.equal(state.uploads,0);
    if(['text','file'].includes(mode)){assert.equal(state.saved,null);assert.equal(state.indexes,1);assert.ok(state.text.includes('No resend or upload performed'))}
    else{assert.equal(JSON.stringify(state.saved),state.originalJSON);assert.ok(state.text.includes('Protected intent retained'))}
    results.push({name:mode+' original cold protected-vault recovery via actual composer button',status:'PASS',sends:state.sends,uploads:state.uploads,indexCommits:state.indexes});
  }
  assert.deepEqual(errors,[]);results.push({name:'console/page errors zero',status:'PASS'});
  console.log(JSON.stringify({qualification:'real browser/IndexedDB/protected original wrapping key reopened and actual composer/transport; controlled MatrixEvent decrypt/trust/authority, not live business acceptance',results},null,2));
}finally{await browser.close()}
