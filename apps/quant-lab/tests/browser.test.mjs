import test from 'node:test';import assert from'node:assert/strict';import{spawn}from'node:child_process';import{mkdtemp,mkdir,readFile}from'node:fs/promises';import net from'node:net';import os from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{chromium}from'playwright';
const repo=fileURLToPath(new URL('../../../',import.meta.url));let server,browser,evidence,base;
async function reserveLoopbackPort(){return await new Promise((resolve,reject)=>{const listener=net.createServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const address=listener.address();if(!address||typeof address==='string'){listener.close();reject(new Error('Unable to reserve a loopback port for Quant browser tests.'));return}listener.close(error=>error?reject(error):resolve(address.port))})})}
test.before(async()=>{const work=await mkdtemp(path.join(os.tmpdir(),'ynx-quant-'));const port=await reserveLoopbackPort();base=`http://127.0.0.1:${port}`;evidence=path.join(repo,'tmp','quant-lab-evidence');await mkdir(evidence,{recursive:true});server=spawn('go',['run','./apps/quant-lab/server'],{cwd:repo,detached:true,env:{...process.env,YNX_QUANT_HTTP_ADDR:`127.0.0.1:${port}`,YNX_QUANT_STATE_PATH:path.join(work,'state.json')},stdio:['ignore','pipe','pipe']});let err='';server.stderr.on('data',d=>err+=d);for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,200));if(i===149)throw new Error(err||'Quant browser test server did not become healthy.')}browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})},{timeout:30_000});test.after(async()=>{await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM')}catch{}});
test('actual Chrome translates research fields and experiment columns in every locale without destroying draft inputs or submitting',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const page=await context.newPage();let writes=0;page.on('request',request=>{if(request.method()==='POST')writes++});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#strategy').fill('Preserved research draft');await page.locator('#fee').fill('34');
    const sourceSnapshot=await page.evaluate(()=>JSON.stringify(snapshot));
    const keys=['researchBoundary','researchName','fastWindow','slowWindow','created','tradeCount','partialFills','sensitivity','dataGaps','netPnl','realized','unrealized','tradingFee','researchSharpe','strategyLifecycle','strategyName','strategyFamily','strategyStage','strategySourceHash','strategyLicense','strategySchedule'];
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);
      const result=await page.evaluate(keys=>({lang:document.documentElement.lang,dir:document.documentElement.dir,labels:keys.map(key=>({key,expected:window.QuantI18n.catalogs[document.documentElement.lang][key],actual:[...document.querySelectorAll(`[data-i18n="${key}"]`)].map(node=>node.textContent)}))}),keys);
      assert.equal(result.lang,language);assert.equal(result.dir,language==='ar'?'rtl':'ltr');
      for(const label of result.labels){assert.ok(label.expected,label.key);assert.ok(label.actual.length,label.key);assert.ok(label.actual.every(value=>value===label.expected),label.key)}
      assert.equal(await page.locator('#strategy').inputValue(),'Preserved research draft');assert.equal(await page.locator('#fee').inputValue(),'34');
      assert.equal(await page.locator('#backtest input').count(),6);
      assert.equal(await page.evaluate(()=>JSON.stringify(snapshot)),sourceSnapshot);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    assert.equal(writes,0);assert.equal(context.pages().length,1);
  }finally{await context.close()}
});
test('actual Chrome renders service-bound metric formulas in all locales and preserves unknown source text',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let posts=0;
    const respond=async route=>{
      posts++;const submitted=route.request().postDataJSON();
      const metricDefinitions={returnBPS:'(ending equity - starting equity) / starting equity × 10,000',buyHoldBPS:'(ending close - starting close) / starting close × 10,000',maxDrawdownBPS:'maximum peak-to-trough equity loss / prior peak × 10,000',sharpeMilli:'mean OOS period return / sample standard deviation of OOS period returns × sqrt(number of periods) × 1,000; risk-free rate is assumed zero',volatilityBPS:'sample standard deviation of OOS period returns × 10,000; not annualized'};
      if(posts===2)metricDefinitions.maxDrawdownBPS='Unknown historical formula <script>not executed</script>';
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'controlled-formulas-'+posts,researchRequestKey:submitted.idempotencyKey,status:'completed_oos',strategy:{ID:submitted.strategy.id,Name:submitted.strategy.name,Family:submitted.strategy.family,Seed:submitted.strategy.seed,Params:submitted.strategy.params},assumptions:Object.fromEntries(Object.entries(submitted.assumptions).map(([key,value])=>[key[0].toUpperCase()+key.slice(1),value])),metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:54,SharpeMilli:1500,VolatilityBPS:7,Trades:1,PartialFills:0,DataGaps:0},metricDefinitions,attribution:posts===1?{costRoundingPolicy:'independent_cost_component_floor_micro_v1'}:undefined})});
    };
    await context.route('**/api/v1/**/backtests/from-market',respond);await context.route('**/api/v1/backtests/from-market',respond);
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('#research-submit').click();
    await page.locator('#result-drawdown').getByText('54 bps',{exact:true}).waitFor();
    await page.locator('#research-run-details summary').click();
    await page.evaluate(()=>{latestResearchResult.attribution.currency='YUSD_TEST_MICRO';latestResearchResult.attribution.averageIdleCapital=99998989487;latestResearchResult.attribution.idleCapitalSamplingPolicy='observed_bar_cash_mean_truncate_micro_v1';renderRunDetails()});
    const englishIdle=await page.locator('#research-idle-cash-rule').textContent();assert.match(englishIdle,/Not time-weighted/);
    assert.match(await page.locator('#research-idle-cash').textContent(),/YUSD_TEST/);
    const english=await page.locator('#research-metric-definitions dd').allTextContents();
    const englishRounding=await page.locator('#research-cost-rounding').textContent();assert.match(englishRounding,/separately rounded down/);
    assert.equal(english.length,5);assert.match(english[3],/sample standard deviation/);assert.match(english[4],/not annualized/);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);
      const text=await page.locator('#research-metric-definitions dd').allTextContents();
      assert.equal(text.length,5);assert.ok(text.every(value=>value.length>20));
      if(language==='en')assert.deepEqual(text,english);else for(let i=0;i<5;i++)assert.notEqual(text[i],english[i],language);
      assert.equal(await page.locator('#result-sharpe').textContent(),'1.500');assert.equal(posts,1);
      const rounding=await page.locator('#research-cost-rounding').textContent();assert.ok(rounding.length>30);if(language!=='en')assert.notEqual(rounding,englishRounding);
      const idle=await page.locator('#research-idle-cash-rule').textContent();assert.ok(idle.length>30);if(language!=='en')assert.notEqual(idle,englishIdle);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    await page.locator('#research-submit').click();await page.locator('#research-metric-definitions dd').nth(2).getByText('Unknown historical formula <script>not executed</script>',{exact:true}).waitFor();
    assert.equal(await page.locator('#research-metric-definitions script').count(),0);assert.equal(context.pages().length,1);assert.equal(posts,2);
    assert.equal(await page.locator('#research-cost-rounding').textContent(),'—');
    assert.equal(await page.locator('#research-idle-cash').textContent(),'—');assert.equal(await page.locator('#research-idle-cash-rule').textContent(),'—');
    await page.screenshot({path:path.join(evidence,'research-localized-service-formulas.png'),fullPage:true});
  }finally{await context.close()}
});

test('actual Chrome rejects a declared mismatched research receipt without replacing the prior result or auto-retrying',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let posts=0;
    const respond=async route=>{
      posts++;const submitted=route.request().postDataJSON();
      const assumptions=Object.fromEntries(Object.entries(submitted.assumptions).map(([key,value])=>[key[0].toUpperCase()+key.slice(1),value]));
      if(posts===2)assumptions.FeeBPS++;
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'controlled-receipt-'+posts,researchRequestKey:submitted.idempotencyKey,status:'completed_oos',strategy:{ID:posts===3?'ma-other-request':submitted.strategy.id,Name:submitted.strategy.name,Family:submitted.strategy.family,Seed:submitted.strategy.seed,Params:submitted.strategy.params},assumptions,metrics:{ReturnBPS:posts===1?120:999,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:0}})});
    };
    await context.route('**/api/v1/**/backtests/from-market',respond);await context.route('**/api/v1/backtests/from-market',respond);
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('#research-submit').click();
    await page.locator('#result-return').getByText('120 bps',{exact:true}).waitFor();assert.equal(posts,1);
    assert.equal(await page.locator('#result-sharpe').textContent(),'1.500');
    assert.equal(await page.locator('#experiments th').nth(5).textContent(),'Sharpe ratio');
    await page.locator('#research-submit').click();await page.locator('#toast').filter({hasText:'Research result is unconfirmed'}).waitFor();
    assert.equal(posts,2);assert.equal(await page.locator('#result-return').textContent(),'120 bps');assert.equal(await page.locator('#research-submit').isEnabled(),true);assert.equal(await page.locator('#backtest').getAttribute('aria-busy'),'false');
    await page.waitForTimeout(150);assert.equal(posts,2);
    const thirdResponse=page.waitForResponse(response=>response.url().endsWith('/backtests/from-market')&&response.request().method()==='POST');
    await page.locator('#research-submit').click();await thirdResponse;await page.waitForFunction(()=>document.querySelector('#backtest').getAttribute('aria-busy')==='false');
    assert.equal(posts,3);assert.match(await page.locator('#toast').textContent(),/Research result is unconfirmed/);assert.equal(await page.locator('#result-return').textContent(),'120 bps');assert.equal(await page.locator('#research-submit').isEnabled(),true);assert.equal(context.pages().length,1);
    await page.screenshot({path:path.join(evidence,'research-declared-receipt-mismatch.png'),fullPage:true});
  }finally{await context.close()}
});
test('actual Chrome rejects ambiguous research costs/windows without HTTP and preserves explicit zero input on source failure',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const bodies=[];
    await context.route('**/api/v1/**/backtests/from-market',async route=>{bodies.push(route.request().postDataJSON());await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Controlled source unavailable; no backtest result"}'})});
    // The actual tenant route has no intervening public/research path segments.
    await context.route('**/api/v1/backtests/from-market',async route=>{bodies.push(route.request().postDataJSON());await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Controlled source unavailable; no backtest result"}'})});
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#fee').fill('');await page.locator('#research-submit').click();await page.locator('#toast').filter({hasText:'safe whole-number'}).waitFor();assert.equal(bodies.length,0);
    await page.locator('#fee').fill('0');await page.locator('#fast').fill('8');await page.locator('#slow').fill('8');
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);await page.locator('#research-submit').click();
      assert.ok((await page.locator('#toast').textContent()).length>30);assert.equal(bodies.length,0);assert.equal(await page.locator('#research-submit').isEnabled(),true);
    }
    await page.selectOption('#locale','en');await page.locator('#fast').fill('3');await page.locator('#slow').fill('8');await page.locator('#seed').fill('0');await page.locator('#slippage').fill('0');await page.locator('#research-submit').click();
    await page.locator('#toast').filter({hasText:'Controlled source unavailable'}).waitFor();assert.equal(bodies.length,1);
    assert.equal(bodies[0].assumptions.feeBPS,0);assert.equal(bodies[0].assumptions.slippageBPS,0);assert.equal(bodies[0].strategy.seed,0);assert.deepEqual(bodies[0].strategy.params,{fast:3,slow:8});
    assert.equal(await page.locator('#fee').inputValue(),'0');assert.equal(await page.locator('#research-submit').isEnabled(),true);assert.equal(context.pages().length,1);
    await page.screenshot({path:path.join(evidence,'research-input-guard-source-unavailable.png'),fullPage:true});
  }finally{await context.close()}
});
test('actual Chrome reuses saved MA parameters only as a draft, preserves costs and resets stale selection on refresh',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let present=true,posts=0;
    const strategy={ID:'saved-ma',Name:'Saved MA',Family:'transparent',StrategyHash:'d'.repeat(64),Seed:0,Params:{fast:4,slow:12}};
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.strategies=present?{saved:strategy}:{};await route.fulfill({response,json:body})});
    const page=await context.newPage();page.on('request',r=>{if(r.method()==='POST')posts++});await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('#fee').fill('34');await page.locator('#slippage').fill('17');
    await page.selectOption('#research-saved-strategy','saved-ma:'+strategy.StrategyHash);await page.locator('#research-reuse').click();
    assert.equal(await page.locator('#strategy').inputValue(),'Saved MA');assert.equal(await page.locator('#seed').inputValue(),'0');assert.equal(await page.locator('#fast').inputValue(),'4');assert.equal(await page.locator('#slow').inputValue(),'12');assert.equal(await page.locator('#fee').inputValue(),'34');assert.equal(await page.locator('#slippage').inputValue(),'17');assert.equal(posts,0);
    await page.selectOption('#locale','ar');assert.match(await page.locator('#research-reuse').textContent(),/مسودة/);assert.equal(await page.locator('#research-saved-strategy').inputValue(),'saved-ma:'+strategy.StrategyHash);
    present=false;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#research-reuse').disabled);assert.equal(await page.locator('#research-saved-strategy').inputValue(),'');assert.equal(await page.locator('#strategy').inputValue(),'Saved MA');
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#research-reuse').isDisabled(),true);assert.equal(posts,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }finally{await context.close()}
});
test('actual Chrome recovers saved research history after malformed readback without script injection or new requests',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let malformed=true,posts=0;
    const good={id:'verified-history',createdAt:'2026-10-03T00:00:00Z',strategy:{Name:'Verified history'},metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:0},sensitivitySpreadBPS:2};
    await context.route('**/api/v1/snapshot',async route=>{
      const response=await route.fetch(),body=await response.json();
      body.experiments=malformed?{good,bad:{...good,id:'bad-history',metrics:{...good.metrics,ReturnBPS:'<img src=x onerror="window.injected=true">'}},missing:null}:{good};
      await route.fulfill({response,json:body});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts++});
    await page.goto(base,{waitUntil:'networkidle'});
    assert.match(await page.locator('#experiment-rows').textContent(),/Verified history/);
    assert.equal(await page.locator('#experiment-rows td[colspan="16"]').count(),2);assert.equal(await page.locator('#experiment-rows img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
    await page.selectOption('#locale','ar');assert.doesNotMatch(await page.locator('#experiment-rows').textContent(),/Research result is unconfirmed/);
    malformed=false;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#experiment-rows').querySelectorAll('tr').length===1);
    await page.reload({waitUntil:'networkidle'});assert.match(await page.locator('#experiment-rows').textContent(),/Verified history/);
    assert.equal(await context.pages().length,1);assert.equal(posts,0);assert.deepEqual(errors,[]);
  }finally{await context.close()}
});
test('actual Chrome distinguishes unknown Testnet execution from venue readback across locales and reload without writes',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const good={id:'testnet-000001',market:'YNXT-YUSD_TEST',side:'buy',amount:12,status:'submitted_testnet',venueOrderId:'controlled-venue-order',venueStatus:'filled',authorizationDigest:'a'.repeat(64),brokerProof:'controlled-readback-only'};
    const records={good,reserved:{...good,id:'testnet-000002',status:'reserved_outcome_unknown'},malformed:null,unsafe:{...good,id:'testnet-000003',amount:Number.MAX_SAFE_INTEGER+1}};
    let writes=0;const errors=[];
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.testnetOrders=records;await route.fulfill({response,json:body})});
    context.on('request',request=>{if(['POST','PUT','DELETE'].includes(request.method()))writes++});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});
    const original=JSON.stringify(records);
    for(const language of await page.locator('#locale option').evaluateAll(options=>options.map(option=>option.value))){
      await page.selectOption('#locale',language);
      const text=await page.locator('#testnet-execution-rows').textContent();
      assert.equal((text.match(/controlled-venue-order/g)||[]).length,1);assert.equal((text.match(/filled/g)||[]).length,1);
      assert.ok(text.includes(await page.evaluate(()=>t('executionOutcomeUnknown'))));
      assert.ok(text.includes(await page.evaluate(()=>t('executionRecordsUnavailable'))));
      assert.match(text,/12 YNXT_MICRO/);assert.doesNotMatch(text,/9007199254740992/);
      assert.equal(await page.evaluate(()=>JSON.stringify(snapshot.testnetOrders)),original);
    }
    await page.locator('#refresh').click();await page.reload({waitUntil:'networkidle'});
    assert.equal(await page.locator('#testnet-execution-rows tr').count(),4);
    assert.equal(writes,0);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
  }finally{await context.close()}
});
test('actual Chrome reads controlled persisted Paper records without creating orders or horizontal page overflow',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let posts=0;
    await context.route('**/api/v1/snapshot',async route=>{
      const response=await route.fetch(),body=await response.json();
      body.paper.Orders=[{ID:'paper-000042',StrategyHash:'e'.repeat(64),Side:'sell',Status:'filled',Price:9007199254740991,Amount:12,Filled:12,Source:'authoritative_market_adapter',CreatedAt:'2026-10-03T00:00:00Z'}];
      await route.fulfill({response,json:body});
    });
    const page=await context.newPage();page.on('request',r=>{if(r.method()==='POST')posts++});
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();
    assert.match(await page.locator('#paper-record-rows').textContent(),/9007199254740991 \/ 12 \/ 12/);
    assert.equal(await page.locator('#paper-record-status').textContent(),'');
    await page.locator('#refresh').click();assert.match(await page.locator('#paper-record-rows').textContent(),/paper-000042/);
    await page.reload({waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();await page.selectOption('#locale','ar');
    assert.match(await page.locator('[data-business-i18n="paperRecordsLead"]').textContent(),/ليست أوامر/);
    const size=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert.ok(size[0]<=size[1],size.join('/'));
    assert.equal(posts,0);await page.screenshot({path:path.join(evidence,'paper-records-controlled-local.png'),fullPage:true});
  }finally{await context.close()}
});
test('actual Chrome requires explicit Paper preview confirmation and preserves an uncertain confirmed intent',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const hash='d'.repeat(64);let posts=0;
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.strategies={saved:{Name:'Controlled saved strategy',StrategyHash:hash}};await route.fulfill({response,json:body})});
    await context.route('**/api/v1/paper/orders',async route=>{posts++;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Controlled uncertain service outcome"}'})});
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();await page.selectOption('#paper-strategy',hash);await page.selectOption('#side','sell');await page.locator('#paper-amount').fill('1234567');
    const dialogPromise=page.waitForEvent('dialog'),cancelClick=page.locator('#paper-submit').click();const dialog=await dialogPromise;
    assert.equal(dialog.type(),'confirm');assert.ok(dialog.message().includes(hash));assert.match(dialog.message(),/1234567/);assert.match(dialog.message(),/10%/);assert.match(dialog.message(),/does not deduct commission\/gas or model slippage/);
    await dialog.dismiss();await cancelClick;assert.equal(posts,0);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.paper.pending')).length),0);
    const confirmed=page.waitForEvent('dialog'),confirmClick=page.locator('#paper-submit').click();await (await confirmed).accept();await confirmClick;
    await page.getByText('Controlled uncertain service outcome',{exact:true}).waitFor();assert.equal(posts,1);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.paper.pending')).length),1);
    await page.selectOption('#locale','ar');const retry=page.waitForEvent('dialog'),retryClick=page.locator('#paper-submit').click();const retryDialog=await retry;assert.match(retryDialog.message(),/تأكيد/);await retryDialog.dismiss();await retryClick;assert.equal(posts,1);
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.paper.pending')).length),1);
  }finally{await context.close()}
});
test('actual Chrome localizes a daily-loss rejection and refreshes the persisted risk without resubmission',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const hash='d'.repeat(64);let posts=0;
    await context.route('**/api/v1/snapshot',async route=>{
      const response=await route.fetch(),body=await response.json();body.strategies={saved:{Name:'Controlled saved strategy',StrategyHash:hash}};
      if(posts)body.paper.DailyRisk={Policy:'utc_first_mark_equity_loss_micro_v1',Day:'2026-10-03',Loss:1000000000,Limit:1000000000,Breached:true};
      await route.fulfill({response,json:body});
    });
    await context.route('**/api/v1/paper/orders',async route=>{posts++;await route.fulfill({status:403,contentType:'application/json',body:'{"error":"paper_daily_loss_limit","errorId":"controlled-daily-error"}'})});
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();await page.selectOption('#paper-strategy',hash);
    const dialog=page.waitForEvent('dialog'),click=page.locator('#paper-submit').click();await (await dialog).accept();await click;
    await page.waitForFunction(()=>document.querySelector('#paper-state').textContent.includes('1000000000 / 1000000000'));
    assert.equal(posts,1);assert.match(await page.locator('#toast').textContent(),/first accepted market mark/);
    assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith('ynx.quant.paper.pending'))),false);
    await page.selectOption('#locale','ar');assert.match(await page.locator('#toast').textContent(),/خسارة/);
    await page.reload({waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();assert.ok((await page.locator('#paper-state').textContent()).includes('1000000000 / 1000000000'));assert.equal(posts,1);
  }finally{await context.close()}
});

test('actual Chrome keeps a malformed Paper receipt pending and retries only the same confirmed intent',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const hash='d'.repeat(64),bodies=[];let recorded=null;
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.strategies={saved:{Name:'Controlled saved strategy',StrategyHash:hash}};body.paper.Orders=recorded?[recorded]:[];await route.fulfill({response,json:body})});
    await context.route('**/api/v1/paper/orders',async route=>{
      const submitted=route.request().postDataJSON();bodies.push(submitted);
      const receipt={ID:'paper-000042',...submitted,Price:1200000,Filled:submitted.Amount,Status:'filled',Source:'authoritative_market_adapter',CreatedAt:'2026-10-03T00:00:00Z'};
      if(bodies.length===1)receipt.Filled=submitted.Amount+1;else recorded=receipt;
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(receipt)});
    });
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click();await page.selectOption('#paper-strategy',hash);await page.selectOption('#side','buy');await page.locator('#paper-amount').fill('100');
    for(let attempt=0;attempt<2;attempt++){
      const dialog=page.waitForEvent('dialog'),click=page.locator('#paper-submit').click();await (await dialog).accept();await click;
      if(attempt===0){await page.locator('#toast').filter({hasText:'unknown outcome'}).waitFor();assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.paper.pending')).length),1);assert.doesNotMatch(await page.locator('#toast').textContent(),/Simulated order recorded/);await page.reload({waitUntil:'networkidle'});await page.locator('nav button[data-view="paper"]').click()}
    }
    await page.getByText('Simulated order recorded',{exact:true}).waitFor();assert.deepEqual(bodies[1],bodies[0]);assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx.quant.paper.pending')).length),0);
    assert.match(await page.locator('#paper-record-rows').textContent(),/1200000 \/ 100 \/ 100/);assert.equal(await page.locator('#paper-record-status').textContent(),'');
  }finally{await context.close()}
});
test('actual Chrome binds research schedule receipts, pending rerenders and confirmed stop without execution claims',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const strategy={ID:'controlled-saved-research',Name:'Controlled saved research',Family:'transparent',License:'test-only',Stage:'Backtest',StrategyHash:'d'.repeat(64),Runtime:{enabled:false,running:false,intervalSeconds:0}};
    let puts=0,release;const gate=new Promise(resolve=>release=resolve);
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.strategies={saved:strategy};await route.fulfill({response,json:body})});
    await context.route('**/api/v1/strategies/controlled-saved-research/schedule',async route=>{
      puts++;const body=route.request().postDataJSON();if(body.enabled)await gate;
      strategy.Runtime=body.enabled?{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:'scheduled',assumptions:Object.fromEntries(Object.entries(body.assumptions).map(([key,value])=>[key[0].toUpperCase()+key.slice(1),value]))}:{...strategy.Runtime,enabled:false,running:false,lastRunStatus:'stopped_by_user'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(strategy)});
    });
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="strategies"]').click();const start=page.waitForEvent('dialog'),startClick=page.locator('.schedule-toggle').click();const startDialog=await start;assert.ok(startDialog.message().includes(strategy.StrategyHash));assert.match(startDialog.message(),/No Paper or Testnet order/);await startDialog.accept();await startClick;
    await page.getByText('Schedule request pending',{exact:true}).waitFor();await page.selectOption('#locale','ar');assert.equal(await page.locator('.schedule-toggle').isDisabled(),true);assert.equal(await page.locator('.schedule-toggle').getAttribute('aria-busy'),'true');assert.equal(puts,1);
    release();await page.locator('#toast').filter({hasText:'التنفيذ غير مثبت'}).waitFor();await page.waitForFunction(()=>document.querySelector('.schedule-toggle')?.disabled===false);assert.equal(await page.locator('.schedule-toggle').isDisabled(),false);
    assert.equal(await page.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime.lastRunStatus),'scheduled');
    assert.ok((await page.locator('#strategy-rows').textContent()).includes(await page.evaluate(()=>t('scheduleQueued'))));
    assert.doesNotMatch(await page.locator('#strategy-rows').textContent(),/scheduled/);
    const stop=page.waitForEvent('dialog'),stopClick=page.locator('.schedule-toggle').click();const stopDialog=await stop;assert.match(stopDialog.message(),/إيقاف/);await stopDialog.dismiss();await stopClick;assert.equal(puts,1);
    const accepted=page.waitForEvent('dialog'),acceptedClick=page.locator('.schedule-toggle').click();await (await accepted).accept();await acceptedClick;
    await page.waitForFunction(()=>Object.values(snapshot.strategies)[0]?.Runtime.lastRunStatus==='stopped_by_user'&&document.querySelector('#strategy-rows').textContent.includes(t('scheduleStopped')));assert.equal(puts,2);
    await page.reload({waitUntil:'networkidle'});await page.locator('nav button[data-view="strategies"]').click();
    assert.equal(await page.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime.lastRunStatus),'stopped_by_user');
    assert.ok((await page.locator('#strategy-rows').textContent()).includes(await page.evaluate(()=>t('scheduleStopped'))));
    assert.doesNotMatch(await page.locator('#strategy-rows').textContent(),/stopped_by_user/);assert.equal(puts,2);
  }finally{await context.close()}
});
test('actual Chrome blocks stale schedule starts but keeps confirmed stop and explicit recovery available',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const baseStrategy={Family:'transparent',License:'test-only',Stage:'Backtest',StrategyHash:'d'.repeat(64)};
    const strategies={start:{...baseStrategy,ID:'stale-start',Name:'Start fixture',Runtime:{enabled:false,running:false,intervalSeconds:0}},stop:{...baseStrategy,ID:'stale-stop',Name:'Stop fixture',Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:'scheduled'}}};
    let stale=false,puts=0;const errors=[];
    await context.route('**/api/v1/snapshot',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stale?null:{access:{statefulPreview:true},strategies})}));
    await context.route('**/api/v1/strategies/stale-stop/schedule',async route=>{
      puts++;assert.equal(route.request().postDataJSON().enabled,false);
      strategies.stop.Runtime={enabled:false,running:false,intervalSeconds:0,lastRunStatus:'stopped_by_user'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(strategies.stop)});
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="strategies"]').click();
    const start=page.locator('.schedule-toggle[data-strategy-id="stale-start"]'),stop=page.locator('.schedule-toggle[data-strategy-id="stale-stop"]');
    assert.equal(await start.isEnabled(),true);stale=true;await page.locator('#refresh').click();await page.locator('#workspace-read-status').waitFor({state:'visible'});
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);assert.equal(await start.isDisabled(),true);assert.equal(await stop.isEnabled(),true);
    }
    const dialog=page.waitForEvent('dialog'),click=stop.click();await (await dialog).accept();await click;
    await page.waitForFunction(()=>Object.values(snapshot.strategies).find(s=>s.ID==='stale-stop').Runtime.lastRunStatus==='stopped_by_user');
    assert.equal(puts,1);assert.equal(await start.isDisabled(),true);
    stale=false;await page.locator('#refresh').click();await page.locator('#workspace-read-status').waitFor({state:'hidden'});
    assert.equal(await start.isEnabled(),true);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
  }finally{await context.close()}
});
test('actual Chrome keeps impossible schedule timestamps unavailable across locales and reload without writes',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let writes=0;const errors=[];
    const strategy={ID:'invalid-time',Name:'Controlled invalid timestamp',Family:'transparent',License:'test-only',Stage:'Backtest',StrategyHash:'d'.repeat(64),Runtime:{enabled:true,running:false,intervalSeconds:60,lastRunStatus:'scheduled',nextRunAt:'2026-02-30T00:00:00Z',lastRunAt:'0'}};
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.strategies={saved:strategy};await route.fulfill({response,json:body})});
    context.on('request',request=>{if(['POST','PUT','DELETE'].includes(request.method()))writes++});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="strategies"]').click();
    for(const language of await page.locator('#locale option').evaluateAll(options=>options.map(option=>option.value))){
      await page.selectOption('#locale',language);
      assert.equal(await page.locator('.schedule-toggle').isDisabled(),true);
      assert.ok((await page.locator('#strategy-rows').textContent()).includes(await page.evaluate(()=>t('scheduleUnknown'))));
      assert.ok((await page.locator('#strategy-rows').textContent()).includes('— / —'));
    }
    await page.reload({waitUntil:'networkidle'});await page.locator('nav button[data-view="strategies"]').click();
    assert.equal(await page.locator('.schedule-toggle').isDisabled(),true);
    assert.equal(await page.evaluate(()=>Object.values(snapshot.strategies)[0].Runtime.nextRunAt),strategy.Runtime.nextRunAt);
    assert.equal(writes,0);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
  }finally{await context.close()}
});
test('actual Chrome localizes unconfirmed schedule recovery and keeps retry fenced until readback',async t=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const screenshots=await mkdtemp(path.join(evidence,'schedule-recovery-'));
    const strategy={ID:'controlled-schedule-outage',Name:'Controlled schedule outage',Family:'transparent',License:'test-only',Stage:'Backtest',StrategyHash:'d'.repeat(64),Runtime:{enabled:false,running:false,intervalSeconds:0}};
    let puts=0;const errors=[];
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.strategies={saved:strategy};await route.fulfill({response,json:body})});
    await context.route('**/api/v1/strategies/controlled-schedule-outage/schedule',route=>{puts++;return route.abort('failed')});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="strategies"]').click();
    const confirmation=page.waitForEvent('dialog'),click=page.locator('.schedule-toggle').click();await (await confirmation).accept();await click;
    await page.waitForFunction(()=>document.querySelector('#toast').textContent===t('scheduleUnknown'));
    await page.screenshot({path:path.join(screenshots,'schedule-unconfirmed-en.png'),fullPage:true});
    const locales=await page.locator('#locale option').evaluateAll(options=>options.map(option=>option.value));assert.equal(locales.length,12);
    for(const language of locales){
      await page.selectOption('#locale',language);
      assert.equal(await page.locator('#toast').textContent(),await page.evaluate(()=>t('scheduleUnknown')));
      assert.equal(await page.locator('.schedule-toggle').isDisabled(),true);
      if(language==='ar')await page.screenshot({path:path.join(screenshots,'schedule-unconfirmed-ar.png'),fullPage:true});
    }
    assert.equal(puts,1);await page.evaluate(()=>refresh());assert.equal(await page.locator('.schedule-toggle').isEnabled(),true);
    assert.equal(puts,1);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
    t.diagnostic(JSON.stringify({classification:'LOCAL_CONTROLLED_SCHEDULE_READBACK_NOT_PUBLIC',screenshots,publicVerified:false}));
  }finally{await context.close()}
});

test('real research form coalesces a delayed request without displaying unconfirmed results',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let posts=0,complete;const gate=new Promise(resolve=>complete=resolve);
    await context.route('**/api/v1/backtests/from-market',async route=>{posts++;await gate;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Exact delayed market unavailable"}'})});
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('#research-submit').click();await page.locator('#research-request-status').waitFor({state:'visible'});
    assert.equal(await page.locator('#research-submit').isDisabled(),true);assert.equal(await page.locator('#backtest').getAttribute('aria-busy'),'true');
    await page.evaluate(()=>{document.getElementById('backtest').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
    await page.selectOption('#locale','ar');assert.match(await page.locator('#research-request-status').textContent(),/قيد الانتظار/);assert.equal(await page.locator('#latest-result').isVisible(),false);assert.equal(posts,1);
    complete();await page.getByText('Exact delayed market unavailable',{exact:true}).waitFor();assert.equal(await page.locator('#research-submit').isDisabled(),false);assert.equal(await page.locator('#backtest').getAttribute('aria-busy'),'false');assert.equal(await page.locator('#research-request-status').isVisible(),true);assert.equal(posts,1);
  }finally{await context.close()}
});
test('actual Chrome retains confirmed workspace with persistent stale warning then explicitly recovers',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const strategy={ID:'stale-paper-fixture',Name:'Saved fixture',Family:'transparent',Stage:'Backtest',License:'test-only',StrategyHash:'e'.repeat(64),Runtime:{enabled:false,running:false,intervalSeconds:0}};
    let body={access:{statefulPreview:true},paper:{Cash:777,Position:0,KillSwitch:false},strategies:{saved:strategy},experiments:{},audit:[]};
    await context.route('**/api/v1/snapshot',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)}));
    const page=await context.newPage(),errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(['POST','PUT','DELETE'].includes(request.method()))writes.push(request.url());});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.locator('nav button[data-view="paper"]').click();
    await page.locator('#paper-strategy').selectOption(strategy.StrategyHash);
    assert.equal(await page.locator('#paper-submit').isEnabled(),true);
    body=null;await page.locator('#refresh').click();await page.locator('#workspace-read-status').waitFor({state:'visible'});
    assert.match(await page.locator('#paper-state').textContent(),/777/);
    assert.equal(await page.locator('#paper-submit').isDisabled(),true);
    assert.equal(await page.evaluate(()=>statefulPreview),true);
    assert.equal(await page.locator('#reconcile').isDisabled(),true);assert.equal(await page.locator('#kill').isEnabled(),true);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);
      assert.equal(await page.locator('#workspace-read-status').textContent(),await page.evaluate(()=>t('workspaceReadUnavailable')));
      assert.equal(await page.locator('#paper-submit').isDisabled(),true);
    }
    body={access:{statefulPreview:true},paper:{Cash:888,Position:0,KillSwitch:false},strategies:{saved:strategy},experiments:{},audit:[]};
    await page.locator('#refresh').click();await page.locator('#workspace-read-status').waitFor({state:'hidden'});
    assert.match(await page.locator('#paper-state').textContent(),/888/);
    assert.equal(await page.locator('#paper-submit').isEnabled(),true);
    assert.equal(await page.locator('#reconcile').isEnabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(context.pages().length,1);
  }finally{await context.close()}
});
test('actual Chrome preserves workspace through malformed strategy readback without writes',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const page=await context.newPage(),errors=[],writes=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(['POST','PUT','DELETE'].includes(request.method()))writes.push(request.url());});
    await page.goto(base,{waitUntil:'networkidle'});
    await page.evaluate(()=>{
      snapshot.strategies={bad:null,hash:{StrategyHash:42},array:[],valid:{ID:'controlled-strategy-read',Name:'Controlled strategy read fixture',Family:'transparent',Stage:'Backtest',StrategyHash:'d'.repeat(64),Runtime:{enabled:false,running:false,intervalSeconds:0}}};
      render();
    });
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      await page.selectOption('#locale',language);
      assert.equal(await page.locator('#strategy-rows tr').count(),4);
      assert.equal(await page.locator('#strategy-rows .danger').count(),3);
      assert.ok((await page.locator('#strategy-rows').textContent()).includes(await page.evaluate(()=>t('scheduleUnknown'))));
      assert.match(await page.locator('#strategy-rows').textContent(),/Controlled strategy read fixture/);
      assert.equal(await page.locator('#paper-strategy option').count(),2);
      assert.equal(await page.locator('#mandate-strategy').inputValue(),'d'.repeat(64));
    }
    await page.evaluate(()=>{snapshot.strategies={};render();});
    assert.equal(await page.locator('#paper-strategy option').count(),1);
    assert.equal(await page.locator('#paper-submit').isDisabled(),true);
    assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.equal(context.pages().length,1);
    await page.screenshot({path:path.join(evidence,'strategy-readback-recovery.png'),fullPage:true});
  }finally{await context.close()}
});
test('actual Chrome recovers unavailable audit containers and preserves valid readback beside bad rows',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let auditFixture={};const writes=[];
    await context.route('**/api/**',route=>{const method=route.request().method();if(method!=='GET'){writes.push({method,path:new URL(route.request().url()).pathname});return route.abort('failed');}return route.continue();});
    await context.route('**/api/v1/snapshot',async route=>{const response=await route.fetch(),body=await response.json();body.audit=auditFixture;await route.fulfill({response,json:body});});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.locator('nav button[data-view="audit"]').click();
    assert.match(await page.locator('#audit-rows').textContent(),/Audit record unavailable/);
    auditFixture=[null,{Hash:7},{Action:'Controlled readback fixture',ObjectID:'<img src=x>',Hash:'a'.repeat(64),CreatedAt:'2026-10-03T00:00:00Z'}];
    await page.evaluate(()=>refresh());assert.match(await page.locator('#audit-rows').textContent(),/Controlled readback fixture/);
    assert.equal(await page.locator('#audit-rows img').count(),0);assert.equal(await page.locator('#audit-rows code').getAttribute('title'),'a'.repeat(64));
    for(const language of await page.evaluate(()=>supportedLocales)){
      await page.selectOption('#locale',language);
      assert.ok((await page.locator('#audit-rows').textContent()).includes(await page.evaluate(()=>t('auditUnavailable'))));
      assert.match(await page.locator('#audit-rows').textContent(),/Controlled readback fixture/);
    }
    auditFixture=[];await page.evaluate(()=>refresh());assert.equal(await page.locator('#audit-rows').textContent(),await page.evaluate(()=>t('auditEmpty')));
    await page.selectOption('#locale','en');await page.locator('nav button[data-view="research"]').click();await page.locator('#fee').fill('17');assert.equal(await page.locator('#fee').inputValue(),'17');
    assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
  }finally{await context.close()}
});
test('actual Chrome renders malformed Paper amount fixtures unavailable without HTML or reconciliation write',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let writes=0;await context.route('**/api/v1/paper/reconcile',route=>{writes++;return route.abort('failed');});
    await context.route('**/api/v1/snapshot',async route=>{
      const response=await route.fetch(),body=await response.json();
      body.paper={...body.paper,Cash:'<img src=x onerror="window.paperInjected=true">',Position:'0',ReconciliationDelta:Number.MAX_SAFE_INTEGER+1,KillSwitch:'false'};
      await route.fulfill({response,json:body});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Paper',exact:true}).click();
    assert.deepEqual((await page.locator('#paper-state dd').allTextContents()).slice(0,4),['—','—','—','—']);
    assert.equal(await page.locator('#paper-state img').count(),0);assert.equal(await page.locator('#paper-state .danger').count(),0);
    assert.equal(await page.evaluate(()=>window.paperInjected),undefined);
    await page.getByRole('button',{name:'Risk',exact:true}).click();await page.locator('#reconcile').click();
    await page.locator('#toast').filter({hasText:'unconfirmed'}).waitFor();assert.equal(writes,0);
    assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);
    await page.screenshot({path:path.join(evidence,'paper-source-values-unavailable.png'),fullPage:true});
  }finally{await context.close()}
});
test('actual local Go reconciliation reports a controlled stale-snapshot difference and persistent kill switch',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let writes=0,release;const gate=new Promise(resolve=>release=resolve);
    await context.route('**/api/v1/paper/reconcile',async route=>{writes++;await gate;const response=await route.fetch();await route.fulfill({response})});
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.getByRole('button',{name:'Risk',exact:true}).click();
    await page.evaluate(()=>{snapshot.paper.Cash-=1});await page.locator('#reconcile').click();
    await page.evaluate(()=>document.getElementById('reconcile').onclick());assert.equal(writes,1);assert.equal(await page.locator('#reconcile').isDisabled(),true);
    await page.selectOption('#locale','ar');assert.equal(await page.locator('#reconcile').isDisabled(),true);release();
    await page.locator('#toast').getByText(/: 1$/).waitFor();assert.doesNotMatch(await page.locator('#toast').textContent(),/zero difference/);await page.waitForFunction(()=>snapshot.paper.KillSwitch===true&&snapshot.paper.ReconciliationDelta===1);
    await page.selectOption('#locale','en');assert.equal(await page.locator('#toast').textContent(),'Reconciliation recorded a difference; kill switch is active: 1');
    await page.locator('#refresh').click();await page.waitForFunction(()=>snapshot.paper.KillSwitch===true&&snapshot.paper.ReconciliationDelta===1);assert.equal(writes,1);
  }finally{await context.close()}
});
test('actual guest research stays usable when Quant browser storage is denied',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    await context.addInitScript(()=>{for(const name of ['getItem','setItem','removeItem']){const original=Storage.prototype[name];Storage.prototype[name]=function(key,...args){if(String(key).startsWith('ynx.quant.'))throw new DOMException('Blocked storage','SecurityError');return original.call(this,key,...args)}}});
    const page=await context.newPage();const calls=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))calls.push({path:new URL(request.url()).pathname,method:request.method(),headers:request.headers()})});
    await page.goto(base,{waitUntil:'networkidle'});assert.equal(await page.locator('#workspace-storage-boundary').isVisible(),true);assert.equal(await page.locator('#locale').inputValue(),'en');
    await page.selectOption('#locale','ar');assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.match(await page.locator('#workspace-storage-boundary').textContent(),/تخزين/);
    await page.selectOption('#locale','en');await page.getByRole('button',{name:'Run out-of-sample backtest'}).click();await page.getByText('unavailable',{exact:true}).waitFor();
    assert.ok(calls.some(call=>call.path==='/api/v1/public/research/backtests/from-market'&&call.method==='POST'));
    assert.ok(calls.filter(call=>call.path.startsWith('/api/v1/')).every(call=>!call.headers['x-ynx-tenant-id']&&!call.headers['x-ynx-preview-mode']));
    await page.getByRole('button',{name:'Paper',exact:true}).click();assert.equal(await page.locator('#paper-submit').isDisabled(),true);
    await page.getByRole('button',{name:'Risk',exact:true}).click();assert.equal(await page.locator('#kill').isDisabled(),true);assert.equal(await page.locator('#reconcile').isDisabled(),true);
    assert.equal(calls.filter(call=>/\/paper\/orders|\/risk\/kill|\/paper\/reconcile/.test(call.path)).length,0);
  }finally{await context.close()}
});
test('desktop fails closed without actual matched history and captures evidence',async()=>{const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light'});await page.goto(base,{waitUntil:'networkidle'});await page.selectOption('#locale','en');await page.getByRole('button',{name:'Run out-of-sample backtest'}).click();await page.getByText('unavailable',{exact:true}).waitFor();await page.getByRole('button',{name:'Experiments'}).click();await page.getByText('No experiments. Empty means no invented performance.').waitFor();await page.screenshot({path:path.join(evidence,'desktop-light.png'),fullPage:true});await page.emulateMedia({colorScheme:'dark'});await page.screenshot({path:path.join(evidence,'desktop-dark.png'),fullPage:true})});
test('mobile Arabic risk confirmation is localized and cancellation leaves persistent risk unchanged',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
  await page.goto(base,{waitUntil:'networkidle'});await page.selectOption('#locale','ar');
  assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
  const m=await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]);assert.ok(m[0]<=m[1],m.join('/'));
  await page.screenshot({path:path.join(evidence,'mobile-arabic-rtl.png'),fullPage:true});
  const oldRisk=await page.evaluate(()=>snapshot.paper.KillSwitch);let riskWrites=0;
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/risk/kill')riskWrites++;});
  await page.locator('nav button[data-view="risk"]').click();
  const dialogPromise=page.waitForEvent('dialog'),clickPromise=page.locator('#kill').click();
  const dialog=await dialogPromise;
  assert.equal(dialog.type(),'confirm');
  assert.equal(dialog.message(),'هل تريد تفعيل مفتاح الإيقاف الدائم للمحاكاة وشبكة الاختبار؟');
  await dialog.dismiss();await clickPromise;
  assert.equal(riskWrites,0);
  await page.locator('#refresh').click();await page.evaluate(()=>refresh());
  assert.equal(await page.evaluate(()=>snapshot.paper.KillSwitch),oldRisk);
  await page.locator('nav button[data-view="paper"]').click();
  assert.match(await page.locator('#paper-state').textContent(),/النقد المحاكى.*المركز المحاكى.*المطابقة.*مفتاح الإيقاف.*جاهز/);
  await page.screenshot({path:path.join(evidence,'risk-arabic-confirmation-cancelled.png'),fullPage:true});
});
test('paper requires a saved strategy; zero reconciliation and kill switch are visible',async()=>{const page=await browser.newPage({viewport:{width:1024,height:800}});await page.goto(base);await page.selectOption('#locale','en');await page.getByRole('button',{name:'Paper',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Submit simulated signal'}).isDisabled(),true);await page.getByText('Run a backtest to save a strategy before submitting a Paper signal.').waitFor();await page.getByRole('button',{name:'Risk'}).click();await page.getByRole('button',{name:'Reconcile exact local paper state'}).click();await page.getByText('Reconciliation completed: zero difference').waitFor();page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Activate kill switch'}).click();await page.locator('#toast').filter({hasText:'Kill switch active'}).waitFor();await page.getByRole('button',{name:'Paper',exact:true}).click();await page.getByText('ACTIVE',{exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'paper-kill-switch.png'),fullPage:true})});
test('confirmed actual-service kill survives follow-up network loss and delayed pre-write snapshot',{timeout:15000},async()=>{
  // Delay a real isolated Go response, not a fabricated risk-state result.
  const context=await browser.newContext();let release;
  const held=new Promise(resolve=>{release=resolve;});let captured;
  const capture=new Promise(resolve=>{captured=resolve;});
  try{
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});
    let holdNext=true,failFollowup=true;
    await context.route('**/api/v1/snapshot',async route=>{
      if(!holdNext){if(failFollowup){failFollowup=false;return route.abort('failed');}return route.continue();}holdNext=false;
      const response=await route.fetch();captured(await response.json());
      await held;await route.fulfill({response});
    });
    await page.evaluate(()=>{window.quantSnapshotTest=refresh();});
    const before=await capture;assert.equal(before.paper.KillSwitch,false);
    await page.getByRole('button',{name:'Risk',exact:true}).click();
    page.on('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Activate kill switch',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#paper-state').textContent.includes('ACTIVE')&&riskWrites.size===0);
    assert.equal(failFollowup,false,'follow-up read really failed rather than refreshing away the display bug');
    release();await page.evaluate(()=>window.quantSnapshotTest);
    assert.match(await page.locator('#paper-state').textContent(),/ACTIVE/);
    // A declared saved-strategy UI fixture exercises selection under the real
    // service's confirmed kill. It is not engine-created research or an order.
    let paperPosts=0;await context.route('**/api/v1/paper/orders',route=>{paperPosts++;return route.abort('failed');});
    await page.evaluate(()=>{snapshot.strategies={fixture:{Name:'Controlled selection fixture',StrategyHash:'e'.repeat(64)}};render();});
    await page.getByRole('button',{name:'Paper',exact:true}).click();
    await page.selectOption('#paper-strategy','e'.repeat(64));
    assert.equal(await page.locator('#paper-submit').isDisabled(),true);
    await page.evaluate(()=>document.getElementById('paper-order').onsubmit({preventDefault(){}}));
    assert.equal(paperPosts,0);assert.match(await page.locator('#toast').textContent(),/Kill switch active/);
    assert.equal(await page.evaluate(()=>pendingPaperIntent),null);
    await page.reload({waitUntil:'networkidle'});
    assert.match(await page.locator('#paper-state').textContent(),/ACTIVE/);
    assert.equal(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'disconnected');
  }finally{release();await context.close();}
});
test('early public research retains temporary provenance in the real page through refresh and reload',{timeout:15000},async()=>{
  // Existing HTML/app with an isolated synthetic research response, not real
  // market performance. The delayed workspace snapshot comes from the local Go service.
  const context=await browser.newContext();
  let releaseSnapshot,releaseResearch,snapshotCaptured,researchStarted;
  const heldSnapshot=new Promise(resolve=>{releaseSnapshot=resolve;});
  const heldResearch=new Promise(resolve=>{releaseResearch=resolve;});
  const capturedSnapshot=new Promise(resolve=>{snapshotCaptured=resolve;});
  const startedResearch=new Promise(resolve=>{researchStarted=resolve;});
  try{
    let firstSnapshot=true;
    await context.route('**/api/v1/snapshot',async route=>{
      if(!firstSnapshot)return route.continue();firstSnapshot=false;
      const response=await route.fetch();snapshotCaptured(await response.json());
      await heldSnapshot;await route.fulfill({response});
    });
    await context.route('**/api/v1/public/research/backtests/from-market',async route=>{
      assert.equal(route.request().method(),'POST');researchStarted();await heldResearch;
      const request=route.request().postDataJSON();
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'isolated-public-ui-result',status:'completed_oos',createdAt:'2026-10-03T00:00:00Z',strategy:{ID:request.strategy.id,Name:'Isolated UI research fixture',Family:request.strategy.family,Seed:request.strategy.seed,Params:request.strategy.params,Source:'Explicit isolated UI data fixture',DataHash:'c'.repeat(64),StrategyHash:'d'.repeat(64)},assumptions:Object.fromEntries(Object.entries(request.assumptions).map(([key,value])=>[key[0].toUpperCase()+key.slice(1),value])),metricDefinitions:{sharpeMilli:'Explicit isolated UI formula: mean / sample deviation × √periods × 1,000; zero risk-free rate'},metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:1},equityCurve:[{time:'2026-10-03T00:00:00Z',equity:1000,benchmarkEquity:1000},{time:'2026-10-03T00:01:00Z',equity:1010,benchmarkEquity:1004},{time:'2026-10-03T01:00:00Z',equity:1012,benchmarkEquity:1009}],sensitivitySpreadBPS:2})});
    });
    const page=await context.newPage();await page.goto(base,{waitUntil:'domcontentloaded'});
    assert.equal((await capturedSnapshot).access.statefulPreview,true);
    await page.locator('#fee').fill('34');await page.locator('#slippage').fill('17');await page.locator('#seed').fill('0');
    await page.getByRole('button',{name:'Run out-of-sample backtest',exact:true}).click();await startedResearch;
    releaseSnapshot();await page.waitForFunction(()=>document.querySelector('#workspace-boundary').hidden);
    releaseResearch();await page.locator('#research-result-status').getByText('Temporary result on this page only — not saved or audited. Reloading the page discards it.',{exact:true}).waitFor();
    assert.equal(await page.locator('#result-sharpe').textContent(),'1.500');
    assert.equal(await page.locator('#experiments th').nth(5).textContent(),'Sharpe ratio');
    assert.equal(await page.locator('#experiment-rows tr td').nth(5).textContent(),'1.500');
    assert.match(await page.locator('#research-run-details').textContent(),/1,000/,'stored-integer formula remains explicit and separate from displayed ratio');
    assert.equal(await page.locator('#result-return').textContent(),'120 bps');
    assert.equal(await page.locator('#equity-figure').isVisible(),true);
    assert.match(await page.locator('#equity-chart .equity-line').getAttribute('points'),/^12\.00,[\d.]+ 23\.60,[\d.]+ 708\.00,[\d.]+$/);
    assert.match(await page.locator('#toast').textContent(),/not saved or audited/);
    await page.locator('#research-run-details > summary').click();
    assert.equal(await page.locator('#research-data-hash').textContent(),'c'.repeat(64));
    assert.equal(await page.locator('#research-strategy-hash').textContent(),'d'.repeat(64));
    await page.locator('#fee').fill('900');await page.locator('#slippage').fill('800');
    assert.equal(await page.locator('#research-fee').textContent(),'34');
    assert.equal(await page.locator('#research-slippage').textContent(),'17');
    assert.equal(await page.locator('#research-seed').textContent(),'0');
    assert.match(await page.locator('#research-metric-definitions').textContent(),/Explicit isolated UI formula/);
    await page.setViewportSize({width:390,height:844});await page.selectOption('#locale','ar');
    assert.equal(await page.locator('#research-run-details > summary').textContent(),'تفاصيل التشغيل والصيغ');
    assert.equal(await page.locator('#research-fee').textContent(),'34');
    assert.match(await page.locator('#toast').textContent(),/نتيجة مؤقتة/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth),false);
    await page.screenshot({path:path.join(evidence,'research-run-details-mobile-arabic.png'),fullPage:true});
    await page.selectOption('#locale','en');await page.setViewportSize({width:1280,height:720});
    await page.getByRole('button',{name:'Experiments',exact:true}).click();
    assert.match(await page.locator('#experiment-rows').textContent(),/Isolated UI research fixture.*not saved or audited/);
    assert.deepEqual((await page.locator('#experiment-rows tr').first().locator('td').allTextContents()).slice(-5),['—','—','—','—','—']);
    assert.equal(await page.locator('#paper-strategy option').count(),1);
    await page.locator('#refresh').click();await page.waitForFunction(()=>snapshotRevision>=2);
    await page.evaluate(()=>refresh());
    assert.match(await page.locator('#experiment-rows').textContent(),/Isolated UI research fixture/);
    assert.match(await page.locator('#research-result-status').textContent(),/not saved or audited/);
    assert.equal(await page.evaluate(()=>Object.keys(snapshot.experiments).length),0);
    assert.equal(await page.evaluate(()=>Object.keys(snapshot.strategies).length),0);
    await page.reload({waitUntil:'networkidle'});
    assert.doesNotMatch(await page.locator('#experiment-rows').textContent(),/Isolated UI research fixture/);
    assert.equal(await page.locator('#latest-result').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'disconnected');
  }finally{releaseSnapshot();releaseResearch();await context.close();}
});
test('account panel keeps guest research visible and supports keyboard, all locales and read-only opening',{timeout:20000},async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});
    const summary=page.locator('#account-panel > summary');
    assert.equal(await page.locator('#locale').inputValue(),'en');
    assert.equal(await page.locator('#account-panel').getAttribute('open'),null);
    const research=await page.locator('#view-title').boundingBox();assert.ok(research.y+research.height<844);
    await page.screenshot({path:path.join(evidence,'account-panel-mobile-closed.png'),fullPage:true});
    const walletBefore=await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState());
    const afterOpenRequests=[];page.on('request',request=>afterOpenRequests.push({url:request.url(),method:request.method()}));
    await summary.focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#account-panel').getAttribute('open'),'');
    for(const id of ['connect-wallet','connect-hosted','connect-metamask','private-sign-in','browser-signin','records-authorize'])assert.equal(await page.locator('#'+id).isVisible(),true,id);
    for(const id of ['wallet-details','wallet-disconnect','wallet-switch','wallet-revoke','private-open-wallet','browser-signout'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
    assert.equal(await page.locator('#browser-signin').isDisabled(),true);
    const locales=await page.locator('#locale option').evaluateAll(options=>options.map(option=>option.value));
    assert.equal(locales.length,12);
    for(const locale of locales){
      await page.selectOption('#locale',locale);
      const layout=await page.evaluate(()=>({lang:document.documentElement.lang,dir:document.documentElement.dir,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,title:document.querySelector('#account-panel summary strong').textContent,labels:[...document.querySelectorAll('#account-panel [data-business-i18n]')].map(el=>el.textContent),targets:[...document.querySelectorAll('#account-panel button:not([hidden]), #account-panel a:not([hidden])')].map(el=>el.getBoundingClientRect().height)}));
      assert.equal(layout.lang,locale);assert.equal(layout.dir,locale==='ar'?'rtl':'ltr');assert.equal(layout.overflow,false,locale);
      assert.equal(layout.labels.length,6);assert.ok(layout.labels.every(text=>text.length>0));
      assert.ok(layout.targets.every(height=>height>=44),locale);
      if(locale!=='en')assert.notEqual(layout.title,'Wallet & account',locale);
    }
    await page.selectOption('#locale','ar');
    await page.screenshot({path:path.join(evidence,'account-panel-mobile-arabic-open.png'),fullPage:true});
    await summary.focus();assert.equal(await summary.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
    await page.keyboard.press('Space');assert.equal(await page.locator('#account-panel').getAttribute('open'),null);
    await page.selectOption('#locale','en');
    await page.setViewportSize({width:1440,height:900});await summary.click();
    assert.equal(await page.locator('.account-panel-groups').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2);
    await page.screenshot({path:path.join(evidence,'account-panel-desktop-open.png'),fullPage:true});
    assert.deepEqual(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState()),walletBefore);
    assert.deepEqual(afterOpenRequests,[], 'layout and locale actions must not send product or authorization requests');
    assert.equal(context.pages().length,1);assert.equal(page.url(),base+'/');
    await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('#account-panel').getAttribute('open'),null);
  }finally{await context.close();}
});
test('browser-visible Wallet fallbacks preserve the English Quant page when no YNX or MetaMask provider is available',async()=>{const page=await browser.newPage({viewport:{width:1024,height:800}});await page.goto(base,{waitUntil:'networkidle'});assert.equal(await page.locator('#locale').inputValue(),'en');await page.locator('#account-panel > summary').click();await page.waitForTimeout(1600);await page.getByRole('button',{name:'Connect Installed YNX Wallet'}).click();await page.getByText('YNX Wallet is unavailable in this browser. This page remains available; use Download YNX Wallet or MetaMask.').waitFor({timeout:5000});await page.getByRole('button',{name:'Use MetaMask'}).click();await page.locator('#wallet-status').getByText('MetaMask is not installed. This does not affect Product Session status.').waitFor({timeout:5000});await page.screenshot({path:path.join(evidence,'wallet-fallback-browser-visible.png'),fullPage:true});assert.equal(await page.url(),base+'/')});
test('exact-origin Quant explicit Hosted action opens Wallet Web without fabricating account or leaving a blank tab',async()=>{
  const context=await browser.newContext();
  try{
    await context.route('https://quant.ynxweb4.com/**',async route=>{
      const pathname=new URL(route.request().url()).pathname;
      if(pathname.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"code":"LOCAL_SOURCE_FIXTURE_UNAVAILABLE"}'});
      const name=pathname==='/'?'index.html':pathname.slice(1);
      if(!/^[a-z0-9.-]+$/u.test(name))return route.fulfill({status:404,body:''});
      try{const body=await readFile(new URL(`../web/${name}`,import.meta.url));return route.fulfill({status:200,body,contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});}catch{return route.fulfill({status:404,body:''});}
    });
    await context.route('https://wallet.ynxweb4.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Hosted Wallet source fixture</title>'}));
    const page=await context.newPage();await page.goto('https://quant.ynxweb4.com/',{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#locale').inputValue(),'en');
    await page.locator('#account-panel > summary').click();
    for(const id of ['#connect-wallet','#connect-hosted','#connect-metamask','#install-wallet','#install-metamask'])assert.equal(await page.locator(id).isVisible(),true);
    const pending=context.waitForEvent('page');await page.locator('#connect-hosted').click();const popup=await pending;
    await popup.waitForURL(/^https:\/\/wallet\.ynxweb4\.com\/hosted\/#connect=/u);
    assert.equal(page.url(),'https://quant.ynxweb4.com/');assert.notEqual(await page.evaluate(()=>window.YNXQuantWallet.getStandardWalletState().status),'connected');
    await popup.close();await page.getByText('YNX Wallet Web approval did not complete. Research and Paper remain available.',{exact:true}).waitFor({timeout:5000});
    assert.equal(await page.locator('#wallet-details').isVisible(),false);assert.equal(context.pages().length,1);
    assert.equal(await page.locator('#install-wallet').getAttribute('href'),'https://www.ynxweb4.com/dapp/download');
    assert.equal(await page.locator('#install-metamask').getAttribute('href'),'https://metamask.io/download/');
  }finally{await context.close();}
});
