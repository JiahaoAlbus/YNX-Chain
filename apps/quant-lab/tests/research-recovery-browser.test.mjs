import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';

// Controlled local tape -> actual Go research engine -> actual browser. This is
// intentionally not a public market, real account, Relay or transaction proof.
test('actual Go two-browser saved research stays isolated through lost-return and restart',{timeout:45000},async t=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url)),work=await mkdtemp(path.join(os.tmpdir(),'ynx-quant-research-recovery-'));
  const binary=path.join(work,'ynx-quant');
  await promisify(execFile)('go',['build','-o',binary,'./apps/quant-lab/server'],{cwd:root,timeout:20000});
  const tape=createServer((request,response)=>{
    if(request.url!=='/v1/market-data/trades'){response.writeHead(404).end();return;}
    const trades=Array.from({length:48},(_,i)=>({id:'controlled-tape-'+i,priceMicro:1000000+i*1000,amountMicro:20000000,createdAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString()}));
    response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({market:'YNXT-YUSD_TEST',source:'persisted deterministic matching-engine fills only',externalPrice:false,trades}));
  });
  await new Promise(resolve=>tape.listen(0,'127.0.0.1',resolve));
  const tapeURL=`http://127.0.0.1:${tape.address().port}`;
  const reservation=net.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const base=`http://127.0.0.1:${port}`;let child,browser,firstReceipt,posts=0,cleanStops=0;
  async function start(){
    child=spawn(binary,[],{cwd:root,env:{...process.env,YNX_QUANT_HTTP_ADDR:`127.0.0.1:${port}`,YNX_QUANT_STATE_PATH:path.join(work,'state.json'),YNX_QUANT_EXCHANGE_URL:tapeURL},stdio:'ignore'});
    let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('Research process exited before readiness');try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
    assert.equal(ready,true,'local research service startup');
  }
  async function stop(){
    if(child&&child.exitCode===null){
      let timer;
      const done=new Promise((resolve,reject)=>{
        timer=setTimeout(()=>reject(Error('Local Quant did not drain after SIGTERM')),12000);
        child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal});});
      });
      assert.equal(child.kill('SIGTERM'),true);
      const terminal=await done;
      assert.deepEqual(terminal,{code:0,signal:null},'normal shutdown must run lifecycle defers');
      cleanStops++;
    }
  }
  try{
    await start();browser=await chromium.launch(await financeBrowserLaunchOptions());const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const errors=[],bodies=[];page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{if(new URL(route.request().url()).origin!==base)return route.abort();return route.continue()});
    await context.route('**/api/v1/backtests/from-market',async route=>{
      posts++;bodies.push(route.request().postData());
      if(posts===1){const response=await route.fetch();assert.equal(response.status(),201);firstReceipt=await response.json();return route.abort('failed');}
      const response=await route.fetch();assert.equal(response.status(),201);assert.deepEqual(await response.json(),firstReceipt);return route.fulfill({response});
    });
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('#strategy').fill('Controlled lost-return research');await page.locator('#fee').fill('17');await page.locator('#research-submit').click();
    await page.locator('#toast').filter({hasText:'Request outcome is unconfirmed'}).waitFor();assert.equal(posts,1);assert.equal(await page.locator('#latest-result').isVisible(),false);assert.equal(await page.locator('#research-submit').isEnabled(),true);
    assert.match(firstReceipt.researchRequestKey,/^quant-research-/);assert.equal(firstReceipt.status,'completed_oos');assert.equal(firstReceipt.assumptions.FeeBPS,17);
    await page.locator('#fee').fill('18');await page.locator('#research-submit').click();await page.locator('#toast').filter({hasText:'Restore its original inputs'}).waitFor();assert.equal(posts,1);
    // A second normal browser profile uses its own generated local-preview
    // binding. Do not inject an identity, tenant header or saved result.
    const otherContext=await browser.newContext({viewport:{width:1280,height:800}}),otherPage=await otherContext.newPage();
    await otherContext.route('**/*',async route=>new URL(route.request().url()).origin!==base?route.abort():route.continue());
    const otherErrors=[];otherPage.on('pageerror',error=>otherErrors.push(error.message));
    await otherPage.goto(base,{waitUntil:'networkidle'});await otherPage.locator('#strategy').fill('Independent browser research');await otherPage.locator('#fee').fill('29');await otherPage.locator('#research-submit').click();
    await otherPage.waitForFunction(()=>Object.values(snapshot.experiments||{}).length===1);
    const otherBefore=await otherPage.evaluate(()=>({tenant:localStorage.getItem('ynx.quant.tenant.v1'),experiments:Object.values(snapshot.experiments),strategies:Object.values(snapshot.strategies)}));
    assert.equal(otherBefore.experiments[0].strategy.Name,'Independent browser research');assert.equal(otherBefore.experiments[0].assumptions.FeeBPS,29);
    assert.notEqual(otherBefore.tenant,await page.evaluate(()=>localStorage.getItem('ynx.quant.tenant.v1')));
    // Experiment IDs are scoped sequence numbers, not global user identities.
    assert.notEqual(otherBefore.experiments[0].researchRequestKey,firstReceipt.researchRequestKey);assert.equal(otherBefore.strategies.length,1);
    await stop();await start();await page.reload({waitUntil:'networkidle'});
    await otherPage.reload({waitUntil:'networkidle'});
    await otherPage.waitForFunction(()=>Object.values(snapshot.experiments||{}).length===1);
    const otherAfter=await otherPage.evaluate(()=>({tenant:localStorage.getItem('ynx.quant.tenant.v1'),experiments:Object.values(snapshot.experiments),strategies:Object.values(snapshot.strategies)}));
    assert.deepEqual(otherAfter,otherBefore,'second browser reads only its exact persisted experiment and strategy after restart');
    assert.equal(await page.locator('#strategy').inputValue(),'Controlled lost-return research');assert.equal(await page.locator('#fee').inputValue(),'17');assert.equal(await page.locator('#research-request-status').isVisible(),true);
    await page.selectOption('#locale','ar');await page.locator('#research-submit').click();await page.waitForFunction(()=>document.getElementById('latest-result').hidden===false&&document.getElementById('backtest').ariaBusy==='false');
    assert.equal(posts,2);assert.equal(bodies[1],bodies[0]);assert.equal(await page.locator('#research-request-status').isVisible(),false);assert.equal(context.pages().length,1);
    const stored=await page.evaluate(()=>({pending:Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.research.pending.v1:')),experiments:Object.values(snapshot.experiments),strategies:Object.values(snapshot.strategies)}));
    assert.equal(stored.pending.length,0);assert.equal(stored.experiments.length,1);assert.equal(stored.strategies.length,1);assert.equal(stored.experiments[0].id,firstReceipt.id);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
    await page.reload({waitUntil:'networkidle'});assert.equal(posts,2);assert.match(await page.locator('#experiment-rows').textContent(),/Controlled lost-return research/);
    assert.doesNotMatch(await page.locator('#experiment-rows').textContent(),/Independent browser research/);
    assert.doesNotMatch(await otherPage.locator('#experiment-rows').textContent(),/Controlled lost-return research/);
    assert.deepEqual(otherErrors,[]);assert.equal(otherContext.pages().length,1);
  }finally{await browser?.close();await stop();await new Promise(resolve=>tape.close(resolve));}
  assert.equal(cleanStops,2,'both first and second service launches drain successfully');
  const binaryBytes=await readFile(binary);
  t.diagnostic(JSON.stringify({classification:'LOCAL_BROWSER_CONTROLLED_TAPE_NOT_PUBLIC_ACCEPTANCE',retainedRoot:work,binaryBytes:binaryBytes.length,binarySha256:createHash('sha256').update(binaryBytes).digest('hex'),independentBrowserContexts:2,cleanSIGTERMStops:cleanStops,publicVerified:false,walletApproval:false}));
});
