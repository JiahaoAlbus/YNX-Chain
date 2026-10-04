import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {ProductSessionGatewayHttpHandler,parseProductSessionWalletURL,signProductSessionApproval,createProductSessionReturnURL,canonicalJSON} from '../../../packages/wallet-auth/src/index.js';
import {paperSessionCopy,paperActionCopy,paperRiskCopy} from '../web/paper-session-copy.js';
import {privateSessionLocales} from '../web/private-session-copy.js';

const ORIGIN='https://quant.ynxweb4.com',AUTH='https://wallet-auth.ynxweb4.com';
const registry=JSON.parse(await readFile(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url)));
const bundle=await build({stdin:{contents:"import * as paper from './paper-session.js';import {mountPaperActions} from './paper-actions.js';window.paperQA=paper;paper.mountPaperSession();mountPaperActions();",resolveDir:fileURLToPath(new URL('../web/',import.meta.url))},bundle:true,write:false,format:'iife',platform:'browser'});
// Local controlled origin, SDK kernel and fixture approval only. Never public
// identity, installed Wallet, engine execution or real capital evidence.
test('actual Chrome Paper panel approves separately, refreshes owned snapshot, reloads, rejects and revokes without touching Standard Wallet',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{for(const reject of [false,true]){
    const context=await browser.newContext(),page=await context.newPage(),kernel=new ProductSessionGatewayHttpHandler(registry,()=>randomBytes(32).toString('base64url'));
    let approvals=0,reads=0,writes=0,backtests=0,risks=0,failOrder=false;const submittedBodies=[];
    await page.exposeFunction('fixtureApproval',async route=>{
      approvals++;const request=parseProductSessionWalletURL(registry,route);assert.deepEqual(request.scopes,['quant:paper:workspace']);
      const now=new Date(),result=reject?{result:'rejected',reason:'user_rejected'}:{result:'approved',approval:signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:new Date(now.getTime()+180000).toISOString()},now)};
      return {version:2,returnUrl:createProductSessionReturnURL(registry,request,result,now)};
    });
    await context.addInitScript(()=>{
      const provider={};window.standardFixture={status:'connected'};
      window.YNXQuantWallet={getPrivateWalletContext:()=>({provider,account:'0x'+'1'.repeat(40),chainId:'0x1917',providerKind:'ynx-wallet',revision:0,status:'connected'}),requestProductSessionV2:route=>window.fixtureApproval(route)};
      window.YNXQuantBacktestDraft=()=>({strategy:{id:'fixture-backtest',params:{fast:3,slow:8}},assumptions:{feeBPS:10,slippageBPS:5}});
    });
    await context.route('**/*',async route=>{
      const r=route.request(),url=new URL(r.url());
      if(url.origin===AUTH){
        const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'x-request-id, content-type, x-ynx-product-session-proof-v2','access-control-expose-headers':'x-request-id, cache-control'};
        if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
        const requestId=r.headers()['x-request-id'];
        if(url.pathname.endsWith('/time'))return route.fulfill({headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonicalJSON({schemaVersion:2,ok:true,requestId,result:{serverTime:new Date().toISOString()}})});
        const result=kernel.handle({requestId,method:r.method(),path:url.pathname,contentType:'application/json',body:r.postData()||'{}',proofHeader:r.headers()['x-ynx-product-session-proof-v2']||null,networkAvailable:true},new Date());
        return route.fulfill({status:result.status,headers:{...cors,...result.headers},body:result.body});
      }
      assert.equal(url.origin,ORIGIN);
      if(url.pathname.startsWith('/api/v1/wallet/paper/')){
        assert.equal(r.headers()['x-ynx-tenant-id'],undefined);
        const result=kernel.handle({requestId:'req_paper_'+randomBytes(16).toString('hex'),method:'POST',path:'/v2/product-sessions/introspect',contentType:'application/json',body:canonicalJSON({requiredScopes:['quant:paper:workspace']}),proofHeader:r.headers()['x-ynx-product-session-proof-v2'],networkAvailable:true},new Date());assert.equal(result.status,200);
        const session=JSON.parse(result.body).result.session;
        const binding={account:session.account,sessionBinding:session.sessionBinding};
        if(url.pathname.includes('/risk/')){risks++;const body=JSON.parse(r.postData());assert.equal(r.method(),'POST');assert.match(body.idempotencyKey,/^quant-native-risk-/);return route.fulfill({contentType:'application/json',body:JSON.stringify({...binding,action:url.pathname.split('/').at(-1),idempotencyKey:body.idempotencyKey,requestDigest:'d'.repeat(64),paper:{KillSwitch:true,ReconciliationDelta:0}})});}
        if(url.pathname.endsWith('/orders')){writes++;assert.equal(r.method(),'POST');submittedBodies.push(r.postData());const body=JSON.parse(r.postData());if(failOrder)return route.fulfill({status:503,contentType:'application/json',body:'{"error":"controlled_unknown"}'});return route.fulfill({contentType:'application/json',body:JSON.stringify({...binding,ID:'paper-000001',StrategyHash:body.strategyHash,Side:body.side,Amount:body.amount,IdempotencyKey:body.idempotencyKey})});}
        if(url.pathname.endsWith('/backtests/from-market')){backtests++;assert.equal(r.method(),'POST');const body=JSON.parse(r.postData());assert.equal(body.assumptions.feeBPS,10);assert.match(body.idempotencyKey,/^quant-research-/);return route.fulfill({contentType:'application/json',body:JSON.stringify({...binding,id:'fixture-experiment',status:'completed_oos',researchRequestKey:body.idempotencyKey,strategy:body.strategy})});}
        reads++;assert.equal(r.method(),'GET');return route.fulfill({contentType:'application/json',body:JSON.stringify({...binding,paper:{Cash:123,Position:7},strategies:{a:{ID:'owned',Name:'Controlled saved strategy',StrategyHash:'a'.repeat(64)},b:{ID:'other-owned',Name:'Other controlled saved strategy',StrategyHash:'b'.repeat(64)}},experiments:{},audit:[],access:{paperWorkspaceAuthorized:true,statefulPreview:false,nativeExecutionEnabled:false,scheduleAuthorized:false}})});
      }
      if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:Buffer.from(bundle.outputFiles[0].contents)});
      return route.fulfill({contentType:'text/html',body:'<select id="locale"></select><h2 id="paper-owned-title"></h2><button id="paper-authorize"></button><button id="paper-refresh"></button><button id="paper-revoke"></button><p id="paper-session-status"></p><dt data-paper-i18n="cash"></dt><dd id="paper-owned-cash"></dd><dd id="paper-owned-position"></dd><dd id="paper-owned-strategies"></dd><dd id="paper-owned-audit"></dd><button id="paper-owned-backtest" data-paper-action="backtest"></button><form id="paper-owned-form"><select id="paper-owned-strategy"></select><select id="paper-owned-side"><option value="buy">Buy</option><option value="sell">Sell</option></select><input id="paper-owned-amount" value="1000000"><button id="paper-owned-review" data-paper-action="preview"></button></form><pre id="paper-owned-result"></pre><dialog id="paper-owned-preview"><p id="paper-owned-model"></p><pre id="paper-owned-preview-text"></pre><button id="paper-owned-confirm" data-paper-action="confirm"></button><button id="paper-owned-cancel" data-paper-action="cancel"></button></dialog><script src="/bundle.js"></script>'});
    });
    try{
      await page.goto(ORIGIN);assert.equal(approvals,0);assert.equal(reads,0);
      for(const locale of privateSessionLocales){await page.evaluate(language=>{localStorage.setItem('ynx.quant.locale',language);document.getElementById('locale').dispatchEvent(new Event('change'));},locale);assert.equal(await page.locator('#paper-authorize').textContent(),paperSessionCopy(locale).authorize);assert.equal(await page.locator('[data-paper-i18n="cash"]').textContent(),paperSessionCopy(locale).cash);assert.equal(await page.locator('#paper-owned-confirm').textContent(),paperActionCopy(locale).confirm);assert.ok(paperActionCopy(locale).model);}
      await page.locator('#paper-authorize').click();
      await page.waitForFunction(()=>document.getElementById('paper-session-status').dataset.pending==='false');
      if(reject){assert.equal(reads,0);assert.equal(await page.locator('#paper-owned-cash').textContent(),'—');}
      else{
        assert.equal(await page.evaluate(()=>window.paperQA.getPaperSessionState().status),'connected',JSON.stringify({approvals,reads,state:await page.evaluate(()=>window.paperQA.getPaperSessionState())}));
        await page.waitForFunction(()=>document.getElementById('paper-owned-cash').textContent==='123');
        await page.locator('#paper-owned-backtest').click();assert.equal(backtests,0);assert.match(await page.locator('#paper-owned-preview-text').textContent(),/feeBPS/);await page.locator('#paper-owned-cancel').click();assert.equal(backtests,0);
        await page.locator('#paper-owned-backtest').click();await page.locator('#paper-owned-confirm').click();await page.waitForFunction(()=>!document.getElementById('paper-owned-preview').open);assert.equal(backtests,1);
        await page.locator('#paper-owned-review').click();assert.equal(writes,0);await page.locator('#paper-owned-cancel').click();assert.equal(writes,0);
        await page.locator('#paper-owned-review').click();await page.evaluate(()=>{const input=document.getElementById('paper-owned-amount');input.value='2000000';input.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('#paper-owned-preview').evaluate(dialog=>dialog.open),false);assert.equal(writes,0);
        await page.locator('#paper-owned-review').click();await page.locator('#paper-owned-confirm').click();await page.waitForFunction(()=>!document.getElementById('paper-owned-preview').open);assert.equal(writes,1);
        await page.waitForFunction(()=>!document.getElementById('paper-owned-review').disabled);await page.locator('#paper-owned-strategy').selectOption('b'.repeat(64));await page.locator('#paper-owned-amount').fill('3000000');failOrder=true;
        await page.locator('#paper-owned-review').click();await page.locator('#paper-owned-confirm').click();await page.waitForFunction(()=>document.getElementById('paper-owned-result').textContent.includes('PAPER_SERVICE_UNAVAILABLE'));assert.equal(writes,2);
        await page.reload();await page.waitForFunction(()=>window.paperQA.getPaperSessionState().status==='connected');await page.locator('#paper-refresh').click();await page.waitForFunction(()=>!document.getElementById('paper-owned-review').disabled);
        assert.equal(await page.locator('#paper-owned-strategy').inputValue(),'b'.repeat(64));assert.equal(await page.locator('#paper-owned-amount').inputValue(),'3000000');failOrder=false;
        await page.locator('#paper-owned-review').click();await page.locator('#paper-owned-confirm').click();await page.waitForFunction(()=>!document.getElementById('paper-owned-preview').open);assert.equal(writes,3);assert.equal(submittedBodies[1],submittedBodies[2]);
        const refreshed=page.waitForResponse(response=>response.url()===ORIGIN+'/api/v1/wallet/paper/snapshot');await page.locator('#paper-refresh').click();await refreshed;assert.ok(reads>=2);
        await page.reload();await page.waitForFunction(()=>window.paperQA.getPaperSessionState().status==='connected');assert.equal(approvals,1);
        await page.locator('#paper-refresh').click();await page.waitForFunction(()=>document.getElementById('paper-owned-position').textContent==='7');
        await page.locator('#paper-native-reason').fill('Controlled user confirmed native halt');await page.locator('#paper-native-kill').click();assert.equal(risks,0);assert.equal(await page.locator('#paper-owned-model').textContent(),paperRiskCopy(await page.evaluate(()=>localStorage.getItem('ynx.quant.locale')||'en')).boundary);await page.locator('#paper-owned-cancel').click();assert.equal(risks,0);
        await page.locator('#paper-native-kill').click();await page.locator('#paper-owned-confirm').click();await page.waitForFunction(()=>!document.getElementById('paper-owned-preview').open);assert.equal(risks,1);
        await page.locator('#paper-native-reconcile').click();assert.equal(risks,1);assert.equal(await page.locator('#paper-owned-preview').evaluate(dialog=>dialog.open),false);
        await page.locator('#paper-native-cash').fill('123');await page.locator('#paper-native-position').fill('7');await page.locator('#paper-native-reconcile').click();await page.locator('#paper-owned-cancel').click();assert.equal(risks,1);
        await page.locator('#paper-native-reconcile').click();await page.locator('#paper-owned-confirm').click();await page.waitForFunction(()=>!document.getElementById('paper-owned-preview').open);assert.equal(risks,2);
        await page.locator('#paper-revoke').click();await page.waitForFunction(()=>window.paperQA.getPaperSessionState().status==='disconnected');assert.equal(await page.locator('#paper-owned-cash').textContent(),'—');
      }
      assert.equal(await page.evaluate(()=>window.standardFixture.status),'connected');assert.equal(context.pages().length,1);assert.equal(page.url(),ORIGIN+'/');
    }finally{await context.close();}
  }}finally{await browser.close();}
});
