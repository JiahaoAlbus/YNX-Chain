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
test('actual Go two-browser research and confirmed schedules stay isolated through lost-return and restart',{timeout:45000},async t=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url)),work=await mkdtemp(path.join(os.tmpdir(),'ynx-quant-research-recovery-'));
  const binary=path.join(work,'ynx-quant');
  await promisify(execFile)('go',['build','-o',binary,'./apps/quant-lab/server'],{cwd:root,timeout:20000});
  let negativeTape=false;
  const tape=createServer((request,response)=>{
    if(request.url!=='/v1/market-data/trades'){response.writeHead(404).end();return;}
    const trades=Array.from({length:48},(_,i)=>({id:'controlled-tape-'+i,priceMicro:negativeTape?(i===47?200000000000:1000000000-i*1000000):1000000+i*1000,amountMicro:20000000,createdAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString()}));
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
    let otherPosts=0,otherSnapshotUnavailable=false;
    await otherContext.route('**/api/v1/backtests/from-market',async route=>{otherPosts++;const response=await route.fetch();assert.equal(response.status(),201);otherSnapshotUnavailable=true;return route.fulfill({response});});
    await otherContext.route('**/api/v1/snapshot',async route=>{
      if(otherSnapshotUnavailable===true)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'controlled history read unavailable'})});
      if(typeof otherSnapshotUnavailable==='string'){
        const response=await route.fetch();assert.equal(response.status(),200);const body=await response.json();
        if(otherSnapshotUnavailable==='failure')body.failure={code:'state_refresh_failed',message:'authoritative state is temporarily unavailable'};
        else body.sourceMetadata={...body.sourceMetadata,status:'unavailable'};
        return route.fulfill({response,json:body});
      }
      return route.continue();
    });
    await otherPage.goto(base,{waitUntil:'networkidle'});await otherPage.locator('#strategy').fill('Independent browser research');await otherPage.locator('#fee').fill('29');await otherPage.locator('#research-submit').click();
    await otherPage.waitForFunction(()=>workspaceReadUnavailable&&!researchSubmitting);
    assert.equal(otherPosts,1);assert.equal(await otherPage.locator('#latest-result').isVisible(),true);
    assert.equal(await otherPage.locator('#research-request-status').isVisible(),false);
    assert.equal(await otherPage.evaluate(()=>pendingResearchIntent),null);
    assert.equal(await otherPage.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.research.pending.v1:')).length),0);
    assert.equal(await otherPage.evaluate(()=>snapshot.paper.KillSwitch),false);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await otherPage.selectOption('#locale',language);
      assert.equal(await otherPage.locator('#paper-strategy-status').textContent(),await otherPage.evaluate(()=>t('workspaceReadUnavailable')));
      assert.equal(await otherPage.locator('#paper-submit').isDisabled(),true);
      assert.equal(await otherPage.evaluate(()=>snapshot.paper.KillSwitch),false);
    }
    await otherPage.selectOption('#locale','en');
    await otherPage.locator('nav button[data-view="paper"]').click();
    await otherPage.screenshot({path:path.join(work,'workspace-unavailable-en.png'),fullPage:true});
    otherSnapshotUnavailable=false;await otherPage.evaluate(()=>refresh());assert.equal(otherPosts,1,'history recovery must not resubmit confirmed research');
    assert.equal(await otherPage.locator('#paper-strategy-status').textContent(),'');
    await otherPage.screenshot({path:path.join(work,'workspace-recovered-en.png'),fullPage:true});
    await otherPage.selectOption('#paper-strategy',await otherPage.evaluate(()=>Object.values(snapshot.strategies)[0].StrategyHash));
    assert.equal(await otherPage.locator('#paper-submit').isEnabled(),true);
    for(const mode of ['failure','source-unavailable']){
      const verifiedBefore=await otherPage.evaluate(()=>JSON.stringify(snapshot));
      otherSnapshotUnavailable=mode;
      assert.equal(await otherPage.evaluate(()=>refresh().then(()=>null,error=>error.code)),'QUANT_SNAPSHOT_INVALID');
      assert.equal(await otherPage.evaluate(()=>JSON.stringify(snapshot)),verifiedBefore,'explicit failed-read response cannot replace confirmed state');
      for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
        await otherPage.selectOption('#locale',language);
        assert.equal(await otherPage.locator('#paper-strategy-status').textContent(),await otherPage.evaluate(()=>t('workspaceReadUnavailable')));
        assert.equal(await otherPage.locator('#paper-submit').isDisabled(),true);
        assert.equal(await otherPage.evaluate(()=>snapshot.paper.KillSwitch),false);
      }
      otherSnapshotUnavailable=false;await otherPage.evaluate(()=>refresh());
      assert.equal(await otherPage.locator('#workspace-read-status').isVisible(),false);
      assert.equal(await otherPage.locator('#paper-submit').isEnabled(),true);
      assert.equal(otherPosts,1,'failed-read recovery cannot resubmit the confirmed research');
    }
    await otherPage.selectOption('#locale','en');
    await otherPage.locator('nav button[data-view="research"]').click();
    await otherPage.waitForFunction(()=>Object.values(snapshot.experiments||{}).length===1);
    // Use the normal existing saved-strategy button and browser confirmation,
    // not a fabricated runtime, injected clock or scheduler endpoint.
    let schedulePuts=0;
    otherPage.on('request',request=>{if(request.method()==='PUT'&&new URL(request.url()).pathname.endsWith('/schedule'))schedulePuts++});
    await otherPage.locator('nav button[data-view="strategies"]').click();
    const cancelScheduleDialog=otherPage.waitForEvent('dialog'),cancelScheduleClick=otherPage.locator('#strategy-rows .schedule-toggle').click();
    const cancelledSchedule=await cancelScheduleDialog;assert.match(cancelledSchedule.message(),/29/);await cancelledSchedule.dismiss();await cancelScheduleClick;
    assert.equal(schedulePuts,0,'cancelled schedule confirmation must not reach the original Go service');
    const scheduleDialog=otherPage.waitForEvent('dialog'),scheduleClick=otherPage.locator('#strategy-rows .schedule-toggle').click();
    const scheduleConfirmation=await scheduleDialog;assert.match(scheduleConfirmation.message(),/29/);await scheduleConfirmation.accept();await scheduleClick;
    await otherPage.waitForFunction(()=>Object.values(snapshot.strategies).length===1&&Object.values(snapshot.strategies)[0].Runtime.enabled===true&&scheduleWrites.size===0);
    const configuredSchedule=await otherPage.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime);
    assert.equal(schedulePuts,1);assert.equal(configuredSchedule.lastRunStatus,'scheduled');assert.equal(configuredSchedule.running,false);assert.equal(configuredSchedule.intervalSeconds,60);assert.equal(configuredSchedule.assumptions.FeeBPS,29);
    assert.match(await otherPage.locator('#strategy-rows').textContent(),/Waiting for the next research run/);
    await page.evaluate(()=>refresh());assert.equal(await page.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime.enabled),false,'other browser schedule cannot enable this strategy');
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
    // Open the actual history action after cold reload. This reads the exact
    // persisted engine result and must not rerun research or request a proof.
    const otherRequestsBefore=otherPosts;
    await otherPage.locator('nav button[data-view="experiments"]').click();
    await otherPage.locator('#experiment-rows .experiment-open').click();
    assert.equal(await otherPage.evaluate(()=>latestResearchResult.id),otherBefore.experiments[0].id);
    assert.deepEqual(await otherPage.evaluate(()=>latestResearchResult),otherBefore.experiments[0]);
    assert.equal(await otherPage.locator('#research-fee').textContent(),'29');
    assert.equal(await otherPage.locator('#research-result-id').textContent(),otherBefore.experiments[0].id);assert.equal(await otherPage.locator('#research-result-name').textContent(),'Independent browser research');
    assert.equal(await otherPage.locator('#equity-figure').isVisible(),true);
    assert.equal(otherPosts,otherRequestsBefore);
    await otherPage.locator('nav button[data-view="strategies"]').click();
    assert.match(await otherPage.locator('#strategy-rows').textContent(),/Stop schedule/);
    const stopScheduleDialog=otherPage.waitForEvent('dialog'),stopScheduleClick=otherPage.locator('#strategy-rows .schedule-toggle').click();
    await (await stopScheduleDialog).accept();await stopScheduleClick;
    await otherPage.waitForFunction(()=>Object.values(snapshot.strategies)[0].Runtime.lastRunStatus==='stopped_by_user'&&scheduleWrites.size===0);
    const stoppedSchedule=await otherPage.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime);
    assert.equal(schedulePuts,2);assert.equal(stoppedSchedule.enabled,false);assert.equal(stoppedSchedule.running,false);assert.match(stoppedSchedule.nextRunAt,/^0001-/);
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
    // Validate only local displayed copies of the actual engine receipt. No
    // persisted data, metrics, identity or extra research request is changed.
    const engineCurve=await page.evaluate(()=>Object.values(snapshot.experiments)[0].equityCurve);
    assert.ok(engineCurve.length>1);
    const researchPostsBefore=posts;
    await page.locator('nav button[data-view="experiments"]').click();await page.locator('#experiment-rows .experiment-open').click();
    assert.equal(await page.evaluate(()=>latestResearchResult.id),firstReceipt.id);
    assert.deepEqual(await page.evaluate(()=>latestResearchResult.equityCurve),engineCurve);
    assert.equal(await page.locator('#research-result-id').textContent(),firstReceipt.id);assert.equal(await page.locator('#research-result-name').textContent(),'Controlled lost-return research');
    assert.equal(posts,researchPostsBefore);assert.equal(await page.locator('#research-fee').textContent(),String(firstReceipt.assumptions.FeeBPS));
    await page.selectOption('#locale','en');
    await page.locator('#research-run-details').evaluate(details=>{details.open=true});
    await page.screenshot({path:path.join(work,'saved-experiment-reopened-en.png'),fullPage:true});
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);
      await page.locator('nav button[data-view="experiments"]').click();
      assert.equal(await page.locator('#experiment-rows .experiment-open').textContent(),await page.evaluate(()=>t('researchOpenResult')));
      await page.locator('#experiment-rows .experiment-open').click();
      assert.equal(await page.evaluate(()=>latestResearchResult.id),firstReceipt.id);assert.equal(posts,researchPostsBefore);
      for(const time of ['2026-02-30T00:00:00Z','2026-01-01T00:00:00','01/01/2026']){
        await page.evaluate(time=>{const saved=Object.values(snapshot.experiments)[0];renderResult({...saved,equityCurve:saved.equityCurve.map((point,index)=>index===0?{...point,time}:point)},true)},time);
        assert.equal(await page.locator('#equity-figure').isVisible(),false);assert.equal(await page.locator('#equity-chart').innerHTML(),'');
      }
      await page.evaluate(()=>renderResult(Object.values(snapshot.experiments)[0],true));
      assert.equal(await page.locator('#equity-figure').isVisible(),true);assert.equal(await page.locator('#equity-chart polyline').count(),2);
    }
    assert.equal(posts,researchPostsBefore);assert.deepEqual(await page.evaluate(()=>Object.values(snapshot.experiments)[0].equityCurve),engineCurve);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
    // Exercise the actual simulation engine through its normal preview UI.
    // No wallet provider, account grant or Exchange/chain write is involved.
    await page.selectOption('#locale','en');await page.locator('nav button[data-view="paper"]').click();
    await page.locator('#paper-strategy').selectOption(firstReceipt.strategy.StrategyHash);await page.locator('#paper-amount').fill('1000000');
    await page.selectOption('#paper-cost-model','v1');await page.locator('#paper-cost-fee').fill('10');await page.locator('#paper-cost-slippage').fill('5');
    let costOrderPosts=0,costOrderReceipt;const costBodies=[];
    await context.route('**/api/v1/paper/orders',async route=>{
      costOrderPosts++;costBodies.push(route.request().postData());
      const response=await route.fetch();assert.equal(response.status(),201);
      if(costOrderPosts===1){costOrderReceipt=await response.json();return route.abort('failed');}
      assert.deepEqual(await response.json(),costOrderReceipt);return route.fulfill({response});
    });
    const cashBeforeCosts=await page.evaluate(()=>snapshot.paper.Cash);
    const cancelledCostDialog=page.waitForEvent('dialog'),cancelledCostClick=page.locator('#paper-submit').click();
    await (await cancelledCostDialog).dismiss();await cancelledCostClick;assert.equal(costOrderPosts,0);
    const paperDialog=page.waitForEvent('dialog'),paperClick=page.locator('#paper-submit').click();
    const paperConfirmation=await paperDialog;assert.match(paperConfirmation.message(),/Simulation assumptions/);assert.match(paperConfirmation.message(),/Fee \(bps\): 10/);assert.match(paperConfirmation.message(),/Slippage \(bps\): 5/);await paperConfirmation.accept();await paperClick;
    await page.waitForFunction(()=>pendingPaperIntent!==null&&!paperSubmitting);
    assert.equal(costOrderPosts,1);assert.equal(costOrderReceipt.CostPolicy,'adverse_price_ceil_fee_micro_v1');
    assert.equal(costOrderReceipt.ExecutionPriceMicro,1047524);assert.equal(costOrderReceipt.FeeMicro,1048);
    await page.reload({waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();
    assert.equal(await page.locator('#paper-cost-model').inputValue(),'v1');assert.equal(await page.locator('#paper-cost-fee').inputValue(),'10');
    await page.locator('#paper-cost-fee').fill('11');await page.locator('#paper-submit').click();assert.equal(costOrderPosts,1,'changed assumption cannot replay unknown outcome');
    await page.locator('#paper-cost-fee').fill('10');const recoveryDialog=page.waitForEvent('dialog'),recoveryClick=page.locator('#paper-submit').click();await (await recoveryDialog).accept();await recoveryClick;
    await page.waitForFunction(()=>pendingPaperIntent===null&&!paperSubmitting);assert.equal(costOrderPosts,2);assert.equal(costBodies[0],costBodies[1]);
    await page.waitForFunction(()=>snapshot.paper?.Orders?.length===1);
    const paperBefore=await page.evaluate(()=>snapshot.paper);
    assert.equal(paperBefore.Orders[0].Amount,1000000);assert.equal(paperBefore.Orders[0].Source,'authoritative_market_adapter');
    assert.equal(paperBefore.Orders[0].StrategyHash,firstReceipt.strategy.StrategyHash);
    assert.equal(paperBefore.Cash,cashBeforeCosts-costOrderReceipt.ExecutedNotionalMicro-costOrderReceipt.FeeMicro,'original engine debits actual simulation costs exactly once');
    assert.equal(paperBefore.DailyRisk.Loss,1572,'settled fee and adverse price enter the original daily risk immediately');
    assert.deepEqual(paperBefore.Orders[0],costOrderReceipt);
    assert.match(await page.locator('#paper-record-rows').textContent(),/Fee charged \(micro\): 1048/);
    await page.screenshot({path:path.join(work,'paper-costs-recovered-en.png'),fullPage:true});
    await page.selectOption('#locale','ar');assert.ok((await page.locator('#paper-record-rows').textContent()).includes(await page.evaluate(()=>t('paperCostCharged'))));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(work,'paper-costs-recovered-ar.png'),fullPage:true});await page.selectOption('#locale','en');
    await otherPage.evaluate(()=>refresh());
    const otherPaperBefore=await otherPage.evaluate(()=>snapshot.paper);
    assert.equal(otherPaperBefore.Orders?.length??0,0);assert.equal(otherPaperBefore.KillSwitch,false);
    await page.locator('nav button[data-view="risk"]').click();
    let killRequests=0;page.on('request',request=>{if(new URL(request.url()).pathname==='/api/v1/risk/kill')killRequests++});
    for(const mutation of ['access','lane']){
      await page.evaluate(async mutation=>{
        const original=window.confirm;
        try{window.confirm=()=>{if(mutation==='access')statefulPreview=false;else riskWrites.add('reconcile');return true};await document.getElementById('kill').onclick();}
        finally{window.confirm=original;statefulPreview=true;riskWrites.delete('reconcile');renderRiskControls();}
      },mutation);
      assert.equal(killRequests,0,'retired confirmation never reaches the actual local Go kill route');
      assert.equal(await page.evaluate(()=>snapshot.paper.KillSwitch),false);
    }
    const killDialog=page.waitForEvent('dialog'),killClick=page.locator('#kill').click();await (await killDialog).accept();await killClick;
    await page.waitForFunction(()=>snapshot.paper?.KillSwitch===true);
    assert.equal(await page.locator('#paper-strategy-status').textContent(),await page.evaluate(()=>t('killActive')));
    assert.equal(killRequests,1,'fresh explicit confirmation reaches the local simulation engine exactly once');
    const killedBefore=await page.evaluate(()=>snapshot.paper);
    await stop();await start();await page.reload({waitUntil:'networkidle'});await otherPage.reload({waitUntil:'networkidle'});
    assert.deepEqual(await page.evaluate(()=>snapshot.paper),killedBefore,'Paper fill and kill latch survive another complete service stop/start');
    assert.deepEqual(await otherPage.evaluate(()=>snapshot.paper),otherPaperBefore,'one tenant Paper risk/fill cannot leak into the second browser');
    assert.deepEqual(await otherPage.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime),stoppedSchedule,'explicit stop survives another service restart without restarting or erasing history');
    assert.equal(schedulePuts,2,'reload/refresh cannot repeat schedule writes');
    // Corrupt only the local displayed readback copy, not server storage or
    // authority: an unconfirmed completion must not turn into return history.
    for(const status of [null,'running','failed']){
      await page.evaluate(status=>{const completed=Object.values(snapshot.experiments)[0];snapshot.experiments.unconfirmed={...completed,id:'unconfirmed-local-copy',status,strategy:{...completed.strategy,Name:'Unconfirmed local readback'},metrics:{...completed.metrics,ReturnBPS:9876}};render()},status);
      const history=await page.locator('#experiment-rows').textContent();assert.match(history,/Controlled lost-return research/);assert.doesNotMatch(history,/9876 bps|Unconfirmed local readback/);assert.match(history,/unconfirmed/i);
    }
    await page.evaluate(()=>{delete snapshot.experiments.unconfirmed;render()});
    await page.locator('nav button[data-view="paper"]').click();await page.locator('#paper-strategy').selectOption(firstReceipt.strategy.StrategyHash);assert.equal(await page.locator('#paper-submit').isDisabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(otherErrors,[]);assert.equal(posts,2);
    // Actual engine, controlled falling tape then adverse short mark. Never
    // replace stored results with a fabricated curve or start capital trading.
    negativeTape=true;otherSnapshotUnavailable=false;
    await otherPage.locator('nav button[data-view="research"]').click();
    await otherPage.locator('#strategy').fill('Controlled short-loss research');
    await otherPage.locator('#research-submit').click();
    await otherPage.waitForFunction(()=>latestResearchResult?.strategy.Name==='Controlled short-loss research'&&!researchSubmitting);
    const signedLoss=await otherPage.evaluate(()=>latestResearchResult);
    assert.ok(signedLoss.equityCurve.at(-1).equity<0);assert.ok(signedLoss.metrics.ReturnBPS<-10000);assert.ok(signedLoss.metrics.MaxDrawdownBPS>10000);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await otherPage.selectOption('#locale',language);
      assert.equal(await otherPage.locator('#equity-figure').isVisible(),true);
      assert.equal(await otherPage.locator('#equity-chart polyline').count(),2);
      assert.equal(await otherPage.locator('#result-return').textContent(),signedLoss.metrics.ReturnBPS+' bps');
      assert.deepEqual(await otherPage.evaluate(()=>latestResearchResult),signedLoss);
    }
    otherSnapshotUnavailable=false;await otherPage.evaluate(()=>refresh());
    await stop();await start();await otherPage.reload({waitUntil:'networkidle'});
    assert.deepEqual(await otherPage.evaluate(id=>Object.values(snapshot.experiments).find(result=>result.id===id),signedLoss.id),signedLoss);
    await otherPage.evaluate(id=>renderResult(Object.values(snapshot.experiments).find(result=>result.id===id),true),signedLoss.id);
    assert.equal(await otherPage.locator('#equity-figure').isVisible(),true);assert.equal(otherPosts,2);assert.deepEqual(otherErrors,[]);

    // Reproduce the late-response race with two real tabs sharing normal
    // browser storage. Every journal is created by the original UI; neither
    // storage nor receipts are injected. Tab B first recovers A's already
    // committed request, then submits a distinct new intent while A's first
    // response is still held. Holding HTTP delivery never changes Go state.
    negativeTape=false;
    const overlapContext=await browser.newContext({viewport:{width:1280,height:800}}),tabA=await overlapContext.newPage();
    await overlapContext.route('**/*',async route=>new URL(route.request().url()).origin!==base?route.abort():route.continue());
    const overlapErrors=[];tabA.on('pageerror',error=>overlapErrors.push(error.message));
    await tabA.goto(base,{waitUntil:'networkidle'});await tabA.locator('#strategy').fill('Same-workspace late-response research');await tabA.locator('#research-submit').click();
    await tabA.waitForFunction(()=>latestResearchResult?.strategy.Name==='Same-workspace late-response research'&&!researchSubmitting);
    const overlapHash=await tabA.evaluate(()=>Object.values(snapshot.strategies)[0].StrategyHash),overlapInitialCash=await tabA.evaluate(()=>snapshot.paper.Cash);
    await tabA.locator('nav button[data-view="paper"]').click();await tabA.selectOption('#paper-strategy',overlapHash);await tabA.locator('#paper-amount').fill('1000000');
    await tabA.selectOption('#paper-cost-model','v1');await tabA.locator('#paper-cost-fee').fill('10');await tabA.locator('#paper-cost-slippage').fill('5');
    let releaseFirst,releaseNext,firstReady,nextReady,overlapPosts=0;
    const heldFirst=new Promise(resolve=>{releaseFirst=resolve}),heldNext=new Promise(resolve=>{releaseNext=resolve});
    const firstCommitted=new Promise(resolve=>{firstReady=resolve}),nextCommitted=new Promise(resolve=>{nextReady=resolve});
    const overlapBodies=[],overlapReceipts=[];
    await overlapContext.route('**/api/v1/paper/orders',async route=>{
      const index=overlapPosts++;overlapBodies[index]=route.request().postData();
      const response=await route.fetch();assert.equal(response.status(),201);overlapReceipts[index]=await response.json();
      if(index===0){firstReady();await heldFirst;}else if(index===2){nextReady();await heldNext;}
      return route.fulfill({response});
    });
    try{
      const beforeOldResponse=await tabA.locator('#toast').textContent(),firstDialog=tabA.waitForEvent('dialog'),firstClick=tabA.locator('#paper-submit').click();
      await (await firstDialog).accept();await firstClick;await firstCommitted;
      assert.equal(await tabA.evaluate(()=>paperSubmitting),true);
      const originalJournal=await tabA.evaluate(()=>localStorage.getItem(paperPendingKey));assert.ok(originalJournal);
      const tabB=await overlapContext.newPage();tabB.on('pageerror',error=>overlapErrors.push(error.message));
      await tabB.goto(base,{waitUntil:'networkidle'});await tabB.locator('nav button[data-view="paper"]').click();
      assert.equal(await tabB.evaluate(()=>localStorage.getItem(paperPendingKey)),originalJournal);
      const replayDialog=tabB.waitForEvent('dialog'),replayClick=tabB.locator('#paper-submit').click();await (await replayDialog).accept();await replayClick;
      await tabB.waitForFunction(()=>pendingPaperIntent===null&&!paperSubmitting);
      assert.equal(overlapPosts,2);assert.equal(overlapBodies[1],overlapBodies[0]);assert.deepEqual(overlapReceipts[1],overlapReceipts[0]);
      await tabB.locator('#paper-amount').fill('2000000');await tabB.locator('#paper-cost-fee').fill('20');await tabB.locator('#paper-cost-slippage').fill('10');
      const nextDialog=tabB.waitForEvent('dialog'),nextClick=tabB.locator('#paper-submit').click();await (await nextDialog).accept();await nextClick;await nextCommitted;
      const newJournal=await tabB.evaluate(()=>localStorage.getItem(paperPendingKey));assert.ok(newJournal);assert.notEqual(newJournal,originalJournal);
      releaseFirst();await tabA.waitForFunction(()=>!paperSubmitting);
      assert.equal(await tabA.evaluate(()=>localStorage.getItem(paperPendingKey)),newJournal,'late old response must preserve the new actual UI-created journal');
      assert.equal(await tabA.evaluate(()=>JSON.stringify(pendingPaperIntent)),newJournal);
      assert.equal(await tabA.locator('#toast').textContent(),beforeOldResponse,'old receipt cannot complete the new operation');
      assert.equal(await tabA.locator('#paper-amount').inputValue(),'1000000');assert.equal(await tabB.evaluate(()=>paperSubmitting),true);
      await tabA.screenshot({path:path.join(work,'same-workspace-late-old-response-en.png'),fullPage:true});
      await tabB.screenshot({path:path.join(work,'same-workspace-new-request-pending-en.png'),fullPage:true});
      releaseNext();await tabB.waitForFunction(()=>pendingPaperIntent===null&&!paperSubmitting&&snapshot.paper?.Orders?.length===2);
      const overlapPaper=await tabB.evaluate(()=>snapshot.paper);
      assert.notEqual(JSON.parse(overlapBodies[0]).IdempotencyKey,JSON.parse(overlapBodies[2]).IdempotencyKey);
      assert.equal(overlapPaper.Cash,overlapInitialCash-overlapReceipts[0].ExecutedNotionalMicro-overlapReceipts[0].FeeMicro-overlapReceipts[2].ExecutedNotionalMicro-overlapReceipts[2].FeeMicro);
      assert.deepEqual(overlapPaper.Orders,[overlapReceipts[0],overlapReceipts[2]]);
      await tabA.reload({waitUntil:'networkidle'});await tabB.reload({waitUntil:'networkidle'});
      assert.equal(await tabA.evaluate(()=>pendingPaperIntent),null);assert.equal(await tabB.evaluate(()=>pendingPaperIntent),null);
      assert.deepEqual(await tabA.evaluate(()=>snapshot.paper),overlapPaper);assert.deepEqual(await tabB.evaluate(()=>snapshot.paper),overlapPaper);
      assert.equal(overlapPosts,3,'recovery/reload cannot add another order');assert.deepEqual(overlapErrors,[]);assert.equal(overlapContext.pages().length,2);
      await tabB.locator('nav button[data-view="paper"]').click();await tabB.screenshot({path:path.join(work,'same-workspace-two-orders-reloaded-en.png'),fullPage:true});
      t.diagnostic(JSON.stringify({classification:'LOCAL_SAME_WORKSPACE_TWO_TAB_REAL_GO_LATE_RESPONSE',paperPosts:overlapPosts,committedOrders:2,distinctIntents:2,oldResponsePreservedNewJournal:true,newResponseClearedOwnJournal:true,exactCostChargedOnce:true,blankTabs:0,publicVerified:false,walletApproval:false}));
    }finally{releaseFirst();releaseNext();await overlapContext.close();}
  }finally{await browser?.close();await stop();await new Promise(resolve=>tape.close(resolve));}
  assert.equal(cleanStops,4,'all four service launches drain successfully');
  const binaryBytes=await readFile(binary);
  const screenshots=[];
  for(const name of ['workspace-unavailable-en.png','workspace-recovered-en.png','saved-experiment-reopened-en.png','paper-costs-recovered-en.png','paper-costs-recovered-ar.png','same-workspace-late-old-response-en.png','same-workspace-new-request-pending-en.png','same-workspace-two-orders-reloaded-en.png']){
    const bytes=await readFile(path.join(work,name));screenshots.push({path:path.join(work,name),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  t.diagnostic(JSON.stringify({classification:'LOCAL_BROWSER_CONTROLLED_TAPE_NOT_PUBLIC_ACCEPTANCE',retainedRoot:work,binaryBytes:binaryBytes.length,binarySha256:createHash('sha256').update(binaryBytes).digest('hex'),screenshots,independentBrowserContexts:3,sameWorkspaceTabs:2,cleanSIGTERMStops:cleanStops,publicVerified:false,walletApproval:false}));
});
