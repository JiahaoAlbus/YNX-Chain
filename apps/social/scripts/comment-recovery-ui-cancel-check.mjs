import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const bundle=await build({stdin:{resolveDir:fileURLToPath(new URL('../',import.meta.url)),contents:`
import {MatrixEvent} from 'matrix-js-sdk/lib/models/event.js';
import {MatrixSocialTransport} from './web/matrix/transport.mjs';
import {RestrictedMoments} from './web/matrix/restricted-moments.mjs';
import {mountRestrictedFeed} from './web/matrix/restricted-feed-ui.mjs';
import {createSocialAudienceHTTPClient} from './web/matrix/audience-client.mjs';
import {matrixCryptoStore} from './web/matrix/crypto-store.mjs';
import {openProtectedMomentDrafts} from './web/matrix/protected-drafts.mjs';
const account='ynx1'+'b'.repeat(38),owner='@owner:fixture.invalid',sender='@peer:fixture.invalid',protocol='ynx-social-matrix-moment/v1';
const wrapped=await matrixCryptoStore(account);wrapped.storageKey.fill(0);const vault=await openProtectedMomentDrafts({account,deviceId:wrapped.deviceId});
const audience={protocol,kind:'contacts',revision:'a'.repeat(64),roomId:'!original:fixture.invalid',owner,members:[owner,sender]};
const index={audience,eventId:'$parent',transactionId:'original_parent_txn_001',sender:owner},parent={protocol,roomId:audience.roomId,revision:audience.revision,owner,eventId:'$parent'};
const intent={status:'delivery-unknown',transactionId:'original_comment_txn_001',text:'Original retained comment',selection:{kind:'contacts'},file:null,comment:{author:sender,index,parent}};
function event(id,author,text,txn,isComment){const content={msgtype:'m.text',body:text,'com.ynx.social.moment':{protocol,kind:isComment?'comment':'moment',audience:'contacts',revision:audience.revision,owner,author}};if(isComment)content['m.relates_to']={rel_type:'m.reference',event_id:'$parent'};const result=new MatrixEvent({type:'m.room.message',event_id:id,room_id:audience.roomId,sender:author,content,unsigned:{transaction_id:txn}});result.makeEncrypted('m.room.encrypted',{algorithm:'m.megolm.v1.aes-sha2',ciphertext:'controlled-sdk-event'},'fixture-curve','fixture-sign');return result}
const parentEvent=event('$parent',owner,'Original parent',index.transactionId,false),commentEvent=event('$comment',sender,intent.text,intent.transactionId,true);
window.setup=async mode=>{
  window.view?.destroy();const prior=await vault.load();if(prior)await vault.clearConfirmed(prior.transactionId);await vault.save(intent);window.originalJSON=JSON.stringify(await vault.load());document.querySelector('main').replaceChildren();window.release=null;window.stage='';window.fetches=0;window.clears=0;window.sends=0;window.uploads=0;window.recovering=false;
  const transport=new MatrixSocialTransport();window.transport=transport;transport.binding={account,userId:sender,deviceId:wrapped.deviceId};transport.client={getRoom:()=>({getMembers:()=>audience.members.map(userId=>({userId,membership:'join'})),getLiveTimeline:()=>({getEvents:()=>[parentEvent,commentEvent]})}),decryptEventIfNeeded:async event=>{if(mode==='read'&&window.recovering&&event.getId()==='$comment'){window.stage='read';await new Promise(resolve=>{window.release=resolve})}},getCrypto:()=>({getEncryptionInfoForEvent:async()=>({shieldColour:0})}),stopClient(){},sendMessage:()=>{window.sends++;throw Error('no send')},uploadContent:()=>{window.uploads++;throw Error('no upload')}};
  const consumer=new RestrictedMoments({transport,authorize:async()=>structuredClone(audience)}),capture=()=>({account,operation:transport.capture()}),guard=view=>transport.guard(view.operation);
  const scopes=['social.contacts','social.feed','social.messaging','social.profile'],session={current:{status:'connected',session:{scopes}},restore:async()=>({status:'connected',session:{account,scopes}}),proof:async()=>({proofHeader:'controlled-original-proof'})};
  const row=(isComment)=>({...audience,actor:account,eventId:isComment?'$comment':'$parent',transactionId:isComment?intent.transactionId:index.transactionId,sender:isComment?sender:owner,...(isComment?{parentEventId:'$parent'}:{})});
  const http=createSocialAudienceHTTPClient({session,capture,guard,fetcher:async(_url,options)=>{window.fetches++;if(window.fetches>1&&mode==='fetch'){window.stage='fetch';window.fetchSignal=options.signal;return new Promise(resolve=>{window.release=()=>resolve(new Response(JSON.stringify({indexes:[row(true)]})))})}return new Response(JSON.stringify({indexes:[row(window.fetches>1)]}))}});
  window.view=mountRestrictedFeed({root:document.querySelector('main'),consumer,loadIndexes:(after,options)=>{if(window.fetches)window.recovering=true;return http.indexes(after,options)},capture,assertCurrent:guard,commentSender:async()=>{if(mode==='sender'){window.stage='sender';await new Promise(resolve=>{window.release=resolve})}return sender},commentDrafts:{load:()=>vault.load(),clearConfirmed:async(txn,_view,current)=>{if(mode==='clear'){window.stage='clear';await new Promise(resolve=>{window.release=resolve})}await vault.clearConfirmed(txn,current);window.clears++}}});await window.view.reload();window.saved=()=>vault.load();
};window.ready=true;
`},bundle:true,format:'esm',platform:'browser',write:false,logLevel:'silent'});
const browser=await chromium.launch({headless:true});const results=[],errors=[];
try{
  const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.route('**/*',route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><main></main><script type="module" src="/fixture.mjs"></script>'});if(path==='/fixture.mjs')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles[0].text});return route.abort()});
  await page.goto('https://comment-recovery-cancel.fixture.invalid/');await page.waitForFunction(()=>window.ready);
  for(const mode of ['sender','fetch','read','clear']){
    await page.evaluate(mode=>window.setup(mode),mode);await page.getByRole('button',{name:'Verify original pending comment',exact:true}).click();await page.waitForFunction(mode=>window.stage===mode,mode);
    await page.evaluate(()=>{window.view.lock();window.transport.stop();window.release()});await page.waitForFunction(()=>window.transport.downloads.size===0);
    await page.waitForTimeout(30);const state=await page.evaluate(async()=>({saved:JSON.stringify(await saved()),originalJSON,clears,sends,uploads,articles:document.querySelectorAll('article').length,status:document.querySelector('[role=status]').textContent,fetchAborted:window.fetchSignal?.aborted}));
    assert.equal(state.saved,state.originalJSON);assert.equal(state.clears,0);assert.equal(state.sends,0);assert.equal(state.uploads,0);assert.equal(state.articles,0);assert.equal(state.status,'Encrypted moments locked.');if(mode==='fetch')assert.equal(state.fetchAborted,true);
    results.push({name:mode+' original recovery stop/late result retains actual protected record',status:'PASS'});
  }
  await page.evaluate(()=>window.setup('success'));await page.getByRole('button',{name:'Verify original pending comment',exact:true}).click();await page.waitForFunction(()=>window.clears===1);
  const success=await page.evaluate(async()=>({saved:await saved(),sends,uploads,status:document.querySelector('[role=status]').textContent}));assert.equal(success.saved,null);assert.equal(success.sends,0);assert.equal(success.uploads,0);assert.ok(success.status.includes('No resend performed'));results.push({name:'current indexed original comment still clears only after confirmation',status:'PASS'});
  assert.deepEqual(errors,[]);results.push({name:'console/page errors zero',status:'PASS'});
  console.log(JSON.stringify({qualification:'actual browser feed recovery button, owned HTTP client, SDK MatrixEvent/consumer and real protected vault; controlled SSO/proof/HS crypto, no public acceptance',results},null,2));
}finally{await browser.close()}
