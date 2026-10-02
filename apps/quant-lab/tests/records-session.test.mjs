import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {ProductSessionGatewayHttpHandler,parseProductSessionWalletURL,signProductSessionApproval,createProductSessionReturnURL,canonicalJSON} from '../../../packages/wallet-auth/src/index.js';
import {privateSessionCopy,privateSessionLocales} from '../web/private-session-copy.js';

// Real Chromium WebCrypto/IndexedDB and official current SDK/Gateway kernel.
// The selected-provider facade/native scalar and owned HTTP payload are local
// fixtures, not installed Wallet, real business state or public acceptance.
const ORIGIN='https://quant.ynxweb4.com',AUTH='https://wallet-auth.ynxweb4.com';
const registry=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url)));
const bundled=await build({stdin:{contents:"import * as records from './records-session.js';window.recordsQA=records;records.mountRecordsSession();",resolveDir:fileURLToPath(new URL('../web/',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser'});
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
test.after(()=>browser.close());
async function setup(mode='approve'){
  const context=await browser.newContext(),kernel=new ProductSessionGatewayHttpHandler(registry,()=>randomBytes(32).toString('base64url'));
  let approvals=0,proofs=0,unavailable=false,releaseRead=null,releaseApproval=null,completions=0,queueReads=false;
  const queuedReads=[],readEvents=[];
  const page=await context.newPage();
  await page.exposeFunction('qaReadPending',()=>typeof releaseRead==='function');
  await page.exposeFunction('qaNativeReturn',async route=>{
    approvals++;const request=parseProductSessionWalletURL(registry,route);
    if(mode==='deferred'){const held=new Promise(resolve=>{releaseApproval=resolve;});await page.evaluate(()=>{window.nativeApprovalPendingQA=true;});await held;}
    assert.deepEqual(request.scopes,['quant:records:read']);assert.match(request.purpose,/No creation, execution, revocation, Paper or tenant permission/);
    const now=new Date(),result=mode==='reject'?{result:'rejected',reason:'user_rejected'}:{result:'approved',approval:signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:new Date(now.getTime()+180000).toISOString()},now)};
    return {version:2,returnUrl:createProductSessionReturnURL(registry,request,result,now)};
  });
  await context.addInitScript(()=>{
    let provider={},revision=0,account='0x'+'1'.repeat(40),status='connected';
    window.identityQA={signedIn:true};
    window.YNXQuantWallet={getPrivateWalletContext:()=>({provider,revision,account,chainId:'0x1917',providerKind:'ynx-wallet',status}),requestProductSessionV2:route=>window.qaNativeReturn(route)};
    window.switchContextQA=()=>{revision++;provider={};account='0x'+'2'.repeat(40);status='connected';window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:true}}));};
    window.disconnectContextQA=()=>{revision++;provider=null;status='disconnected';window.dispatchEvent(new CustomEvent('ynx:quant-wallet-context',{detail:{identityChanged:false}}));};
    window.localeQA=value=>{localStorage.setItem('ynx.quant.locale',value);document.getElementById('locale').dispatchEvent(new Event('change'));};
  });
  await context.route('**/*',async route=>{
    const r=route.request(),url=new URL(r.url());
    if(url.origin===AUTH){
      const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'x-request-id, content-type, x-ynx-product-session-proof-v2','access-control-expose-headers':'x-request-id, cache-control'};
      if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      const requestId=r.headers()['x-request-id'];
      if(url.pathname.endsWith('/complete'))completions++;
      if(url.pathname.endsWith('/time'))return route.fulfill({headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonicalJSON({schemaVersion:2,ok:true,requestId,result:{serverTime:new Date().toISOString()}})});
      const result=kernel.handle({requestId,method:r.method(),path:url.pathname,contentType:'application/json',body:r.postData()||'{}',proofHeader:r.headers()['x-ynx-product-session-proof-v2']||null,networkAvailable:true},new Date());
      return route.fulfill({status:result.status,headers:{...cors,...result.headers},body:result.body});
    }
    assert.equal(url.origin,ORIGIN);
    if(url.pathname==='/api/v1/wallet/private-records'){
      proofs++;
      const result=kernel.handle({requestId:'req_records_'+randomBytes(16).toString('hex'),method:'POST',path:'/v2/product-sessions/introspect',contentType:'application/json',body:canonicalJSON({requiredScopes:['quant:records:read']}),proofHeader:r.headers()['x-ynx-product-session-proof-v2'],networkAvailable:true},new Date());
      assert.equal(result.status,200);const session=JSON.parse(result.body).result.session;
      const response=queueReads?await new Promise(resolve=>{readEvents.push({phase:'queued',index:queuedReads.length});queuedReads.push(resolve);}):{};
      if(queueReads)readEvents.push({phase:'released',status:response.status||200,id:response.id});
      if(releaseRead)await new Promise(resolve=>{releaseRead=resolve;});
      if(unavailable||response.status>=400)return route.fulfill({status:response.status||503,contentType:'application/json',body:'{"error":"fixture-unavailable"}'});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({account:session.account,sessionBinding:session.sessionBinding,nativeExecutionEnabled:false,paperWorkspaceLinked:false,records:{mandates:[{digest:'qa-owned-mandate',market:'QA-owned-market',maxDailyLoss:100,expiresAt:session.expiresAt}],executions:[{id:response.id||'qa-owned-execution',venueOrderId:'qa-venue-order',market:'QA-owned-market',status:'accepted',createdAt:'2026-10-01T00:00:00.000Z'}]}})});
    }
    if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:Buffer.from(bundled.outputFiles[0].contents)});
    return route.fulfill({contentType:'text/html',body:'<select id="locale"></select><button id="records-authorize"></button><button id="records-read"></button><button id="records-revoke"></button><small id="records-status"></small><ul id="records-owned"></ul><script src="/bundle.js"></script>'});
  });
  await page.goto(ORIGIN);await page.waitForFunction(()=>!!window.recordsQA);
  const waitQueued=async count=>{const deadline=Date.now()+4000;while(queuedReads.length<count){assert.ok(Date.now()<deadline,'records request did not reach isolated HTTP boundary');await new Promise(resolve=>setTimeout(resolve,10));}};
  return {context,page,approvals:()=>approvals,proofs:()=>proofs,completions:()=>completions,readEvents:()=>readEvents,queueReads:()=>{queueReads=true;},waitQueued,releaseQueued:(index,result)=>{assert.equal(typeof queuedReads[index],'function');queuedReads[index](result);},releaseApproval:()=>{const done=releaseApproval;releaseApproval=null;done?.();},unavailable:value=>{unavailable=value;},hold:()=>{releaseRead=true;},release:()=>{const done=releaseRead;releaseRead=null;if(typeof done==='function')done();for(const resolve of queuedReads)resolve({status:503});}};
}
test('a newer verified records read survives older success, unavailable and authorization responses',async()=>{
  for(const oldStatus of [200,503,401]){
    const f=await setup();try{
      await f.page.evaluate(()=>window.recordsQA.beginRecordsSession());f.queueReads();
      await f.page.evaluate(()=>{window.oldReadQA=window.recordsQA.readPrivateRecords().then(()=>null,error=>error.code);});
      await f.waitQueued(1);
      await f.page.evaluate(()=>{window.newReadQA=window.recordsQA.readPrivateRecords();});
      await f.waitQueued(2);
      f.releaseQueued(1,{id:'newer-owned-record'});await f.page.evaluate(()=>window.newReadQA).catch(error=>{throw new Error(JSON.stringify(f.readEvents()),{cause:error});});
      assert.match(await f.page.locator('#records-owned').textContent(),/newer-owned-record/);
      f.releaseQueued(0,{status:oldStatus,id:'older-owned-record'});
      assert.equal(await f.page.evaluate(()=>window.oldReadQA),'PRIVATE_OPERATION_SUPERSEDED');
      assert.match(await f.page.locator('#records-owned').textContent(),/newer-owned-record/);
      assert.doesNotMatch(await f.page.locator('#records-owned').textContent(),/older-owned-record/);
      assert.match(await f.page.locator('#records-status').textContent(),/ynx1/);
      assert.equal(f.approvals(),1);assert.equal(f.proofs(),2);
    }finally{f.release();await f.context.close();}
  }
});
test('the current read still clears private records when its authorization is rejected',async()=>{
  const f=await setup();try{
    await f.page.evaluate(()=>window.recordsQA.beginRecordsSession());
    await f.page.evaluate(()=>window.recordsQA.readPrivateRecords());
    assert.equal(await f.page.locator('#records-owned li').count(),2);
    f.queueReads();
    await f.page.evaluate(()=>{window.currentReadQA=window.recordsQA.readPrivateRecords().then(()=>null,error=>error.code);});
    await f.waitQueued(1);f.releaseQueued(0,{status:401});
    assert.equal(await f.page.evaluate(()=>window.currentReadQA),'PRIVATE_AUTHORIZATION_REJECTED');
    assert.equal(await f.page.locator('#records-owned li').count(),0);
    assert.doesNotMatch(await f.page.locator('#records-status').textContent(),/ynx1/);
    assert.equal(await f.page.evaluate(()=>window.recordsQA.readPrivateRecords().catch(error=>error.code)),'PRIVATE_SIGN_IN_REQUIRED');
    assert.equal(f.approvals(),1);assert.equal(f.proofs(),2);
  }finally{f.release();await f.context.close();}
});
test('explicit records uses its own SDK scope, one pending intent, fresh reads and restore without re-sign',async()=>{
  const f=await setup();try{
    assert.equal(f.approvals(),0);
    for(const locale of privateSessionLocales){await f.page.evaluate(value=>window.localeQA(value),locale);assert.equal(await f.page.locator('#records-authorize').textContent(),privateSessionCopy(locale).recordsAuthorize);assert.ok(privateSessionCopy(locale).recordsBoundary);}
    const same=await f.page.evaluate(async()=>{const a=window.recordsQA.beginRecordsSession(),b=window.recordsQA.beginRecordsSession();const same=a===b;await a;return same;});
    assert.equal(same,true);assert.equal(f.approvals(),1);
    const read=()=>f.page.evaluate(()=>window.recordsQA.readPrivateRecords('e'.repeat(64)));
    await read();assert.equal(await f.page.locator('#records-owned li').count(),2);assert.match(await f.page.locator('#records-status').textContent(),/ynx1/);assert.match(await f.page.locator('#records-owned').textContent(),/qa-owned-execution.*qa-venue-order/);
    f.unavailable(true);await assert.rejects(read());assert.equal(await f.page.locator('#records-owned li').count(),0);
    f.unavailable(false);await read();assert.equal(f.approvals(),1);assert.equal(f.proofs(),3);
    await f.page.reload();await f.page.waitForFunction(()=>document.getElementById('records-status').textContent.includes('ynx1'));
    await read();assert.equal(f.approvals(),1);
    f.hold();const lateTransport=read();await f.page.waitForFunction(()=>window.qaReadPending());await f.page.evaluate(()=>window.disconnectContextQA());f.release();await assert.rejects(lateTransport);assert.equal(await f.page.locator('#records-owned li').count(),0);
    await read();assert.equal(f.approvals(),1);assert.equal(await f.page.locator('#records-owned li').count(),2);
    f.hold();const late=read();await f.page.waitForFunction(()=>window.qaReadPending());await f.page.evaluate(()=>window.switchContextQA());f.release();await assert.rejects(late);assert.equal(await f.page.locator('#records-owned li').count(),0);
    assert.equal(await f.page.evaluate(()=>window.identityQA.signedIn),true);
  }finally{f.release();await f.context.close();}
});
test('records rejection does not log out the independent identity or create granted records',async()=>{
  const f=await setup('reject');try{
    await f.page.evaluate(()=>window.recordsQA.beginRecordsSession());
    assert.equal(f.approvals(),1);assert.equal(await f.page.evaluate(()=>window.identityQA.signedIn),true);
    await assert.rejects(f.page.evaluate(()=>window.recordsQA.readPrivateRecords('e'.repeat(64))));
    assert.equal(f.proofs(),0);assert.equal(await f.page.locator('#records-owned li').count(),0);
  }finally{await f.context.close();}
});

test('approval pending transport loss clears SDK pending and rejects a cold late callback without completing',async()=>{
  const f=await setup('deferred');try{
    await f.page.evaluate(()=>{window.pendingQA=window.recordsQA.beginRecordsSession().then(()=>false,()=>true);});
    await f.page.waitForFunction(()=>window.nativeApprovalPendingQA===true);
    assert.equal(f.approvals(),1);
    await f.page.evaluate(()=>window.disconnectContextQA());
    f.releaseApproval();assert.equal(await f.page.evaluate(()=>window.pendingQA),true);
    assert.equal(f.completions(),0);assert.equal(f.proofs(),0);
    await f.page.reload();await f.page.waitForFunction(()=>document.getElementById('records-status').dataset.pending==='false');
    assert.doesNotMatch(await f.page.locator('#records-status').textContent(),/ynx1/);
    await assert.rejects(f.page.evaluate(()=>window.recordsQA.readPrivateRecords()));
    assert.equal(f.completions(),0);assert.equal(f.approvals(),1);
  }finally{f.releaseApproval();await f.context.close();}
});

test('pagehide/pageshow cannot adopt or clean up a newer deferred client initialization',async()=>{
  // Lifecycle-only factory replacement; the two protocol tests above retain
  // the real SDK. No fixture factory is included in the production bundle.
  const lifecycle=await build({stdin:{contents:"import * as records from './records-session.js';window.recordsQA=records;records.mountRecordsSession();",resolveDir:fileURLToPath(new URL('../web/',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'deferred-browser-factory-only',setup(b){b.onLoad({filter:/\/product-session-browser\.js$/},()=>({loader:'js',contents:`export function createBrowserProductSessionClient(){return new Promise(resolve=>{window.factoriesQA??=[];window.factoriesQA.push(account=>{const client={current:{status:'connected',session:{account,sessionBinding:account}},restore:async()=>client.current};resolve({client,close:()=>{window.closedQA??=[];window.closedQA.push(account);}});});});}` }));}}]});
  const context=await browser.newContext(),page=await context.newPage();
  try{
    await context.addInitScript(()=>localStorage.setItem('ynx.quant.records-session.v1.started','true'));
    await context.route('**/*',route=>new URL(route.request().url()).pathname==='/bundle.js'?route.fulfill({contentType:'text/javascript',body:Buffer.from(lifecycle.outputFiles[0].contents)}):route.fulfill({contentType:'text/html',body:'<small id="records-status"></small><ul id="records-owned"></ul><script src="/bundle.js"></script>'}));
    await page.goto(ORIGIN);await page.waitForFunction(()=>window.factoriesQA?.length===1);
    await page.evaluate(()=>{window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
    await page.waitForFunction(()=>window.factoriesQA.length===2);
    await page.evaluate(()=>window.factoriesQA[0]('old-native-qa'));
    await page.waitForFunction(()=>window.closedQA?.includes('old-native-qa'));
    assert.doesNotMatch(await page.locator('#records-status').textContent(),/old-native-qa/);
    await page.evaluate(()=>window.factoriesQA[1]('new-native-qa'));
    await page.waitForFunction(()=>document.getElementById('records-status').textContent.includes('new-native-qa'));
    await page.evaluate(()=>window.recordsQA.beginRecordsSession());
    assert.equal(await page.evaluate(()=>window.factoriesQA.length),2);
    assert.deepEqual(await page.evaluate(()=>window.closedQA),['old-native-qa']);
  }finally{await context.close();}
});
