import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const [source, html, i18n] = await Promise.all(['app.js', 'index.html', 'i18n.js'].map(name => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8')));
const accountA = `0x${'a'.repeat(40)}`, accountB = `0x${'b'.repeat(40)}`;
const connected = account => ({status: 'connected', providerKind: 'metamask', chainId: '0x1917', account});
const receipt = (account, balance = '1000000000000000000') => ({...connected(account), asset: 'YNXT', decimals: 18, balanceBaseUnits: balance, blockNumber: '42', source: 'selected-wallet-provider', asOf: '2026-09-12T00:00:00.000Z'});
const deferred = () => {let resolve, reject; const promise = new Promise((done, fail) => {resolve = done; reject = fail;}); return {promise, resolve, reject};};
const settle = async () => {await new Promise(setImmediate);};
const researchFixture = (id, name = id) => ({id, status:'completed_oos',createdAt:'2026-10-03T00:00:00Z', strategy:{Name:name,Family:'transparent',Seed:7,Params:{fast:3,slow:8},StrategyHash:'e'.repeat(64)},assumptions:{FeeBPS:10,SlippageBPS:5,LatencyBars:1,ParticipationBPS:1000,TrainEnd:24,WalkForwardWindows:3,Seed:7}, metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:0}, equityCurve:[{time:'2026-10-03T00:00:00Z',equity:1000,benchmarkEquity:1000},{time:'2026-10-03T00:01:00Z',equity:1012,benchmarkEquity:1009}], sensitivitySpreadBPS:2});
const researchStatus = app => app.ids.get('latest-result').children.find(element => element.id === 'research-result-status').textContent;
const paperRecord = overrides => ({ID:'paper-000042',StrategyHash:'e'.repeat(64),Side:'buy',Status:'partially_filled',Price:9007199254740991,Amount:2000000,Filled:1000000,Source:'authoritative_market_adapter',CreatedAt:'2026-10-03T00:00:00Z',...overrides});
test('completed history opens exact saved or temporary research without rerun and fences stale rendered controls',async()=>{
  const first=researchFixture('workspace-result'),second=researchFixture('next-workspace-result');
  const app=harness({snapshot:{experiments:{first}}});await settle();
  const open=(index,epoch=vm.runInContext('experimentRenderEpoch',app.context))=>app.ids.get('experiment-rows').events.get('click')[0]({target:{closest:()=>({disabled:false,dataset:{historyIndex:String(index),historyEpoch:String(epoch)}})}});
  const before=app.calls.length;open(0);
  assert.equal(vm.runInContext('latestResearchResult.id',app.context),first.id);assert.equal(vm.runInContext('latestResearchMode',app.context),true);
  assert.equal(app.ids.get('result-return').textContent,'120 bps');assert.equal(app.ids.get('research-fee').textContent,'10');assert.equal(app.ids.get('equity-figure').hidden,false);
  assert.equal(app.ids.get('research-result-id').textContent,first.id);assert.equal(app.ids.get('research-result-name').textContent,first.strategy.Name);assert.notEqual(app.ids.get('research-result-time').textContent,'—');
  const retiredEpoch=vm.runInContext('experimentRenderEpoch',app.context);
  app.context.replacement=second;vm.runInContext('snapshot.experiments={replacement};render()',app.context);
  open(0,retiredEpoch);assert.equal(vm.runInContext('latestResearchResult.id',app.context),first.id,'old index cannot select a replacement workspace record');
  open(0);assert.equal(vm.runInContext('latestResearchResult.id',app.context),second.id);
  app.context.temporary={...researchFixture(second.id),metrics:{...second.metrics,ReturnBPS:777}};
  vm.runInContext('publicExperiments={temporary};render()',app.context);open(1);
  assert.equal(app.ids.get('result-return').textContent,'777 bps');assert.equal(vm.runInContext('latestResearchMode',app.context),false,'same ID must not collapse saved and temporary provenance');
  const chart=app.ids.get('equity-chart').innerHTML;
  for(const index of ['-1','1.5','01','9999999999999999999999','2']){open(index);assert.equal(app.ids.get('result-return').textContent,'777 bps');assert.equal(app.ids.get('equity-chart').innerHTML,chart);}
  assert.equal(app.calls.length,before);assert.equal(app.proofs(),0);
});
test('history read action localizes across twelve languages and never opens an unconfirmed experiment',async()=>{
  const valid=researchFixture('valid-history'),invalid={...researchFixture('invalid-history'),status:'running'};
  const app=harness({snapshot:{experiments:{valid,invalid}}});await settle();
  const open=index=>app.ids.get('experiment-rows').events.get('click')[0]({target:{closest:()=>({disabled:false,dataset:{historyIndex:String(index),historyEpoch:String(vm.runInContext('experimentRenderEpoch',app.context))}})}});
  const before=app.calls.length;
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    const action=vm.runInContext('t("researchOpenResult")',app.context);assert.ok(action);if(language!=='en')assert.notEqual(action,'View completed result');
    assert.ok(app.ids.get('experiment-rows').innerHTML.includes(action));assert.equal((app.ids.get('experiment-rows').innerHTML.match(/class="experiment-open"/g)||[]).length,1);
    open(0);open(1);assert.equal(vm.runInContext('latestResearchResult.id',app.context),'valid-history');
  }
  assert.equal(app.calls.length,before);assert.equal(app.proofs(),0);
});
test('saved research never displays returns for failed, running or unknown completion status',async()=>{
  for(const status of [undefined,null,'','running','failed','completed','COMPLETED_OOS']){
    const invalid={...researchFixture('unconfirmed-history'),status,metrics:{...researchFixture('base').metrics,ReturnBPS:9876}};
    const app=harness({snapshot:{experiments:{invalid,valid:researchFixture('verified-neighbor')}}});await settle();
    const rows=app.ids.get('experiment-rows').innerHTML;
    assert.match(rows,/verified-neighbor/);assert.doesNotMatch(rows,/9876 bps|unconfirmed-history/);
    assert.ok(rows.includes(vm.runInContext('safe(t("researchInvalid"))',app.context)));
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
  }
});
test('invalid completion cannot replace the last verified chart or localized result',async()=>{
  const app=harness();await settle();app.context.completedResult=researchFixture('verified-chart');
  vm.runInContext('renderResult(completedResult,false)',app.context);
  const chart=app.ids.get('equity-chart').innerHTML,previousReturn=app.ids.get('result-return').textContent;
  for(const status of [null,'running','failed']){
    app.context.invalidResult={...researchFixture('invalid-chart'),status};
    assert.throws(()=>vm.runInContext('renderResult(invalidResult,false)',app.context));
    assert.equal(app.ids.get('equity-chart').innerHTML,chart);assert.equal(app.ids.get('result-return').textContent,previousReturn);
    assert.equal(vm.runInContext('latestResearchResult.id',app.context),'verified-chart');
  }
});
const savedResearchStrategy = overrides => ({ID:'saved-research',Name:'Saved research',Stage:'Backtest',Family:'transparent',License:'test-only',StrategyHash:'d'.repeat(64),Runtime:{enabled:false,running:false,intervalSeconds:0},...overrides});

function observedOrder(app){
  for(const [id,value] of Object.entries({reference:'1000000',gas:'100',loss:'0',equity:'10000000',exposure:'1000000',peak:'10000000',current:'9900000',liquidity:'10000000',depeg:'5',concentration:'2000',orders:'10',cancels:'1','api-failures':'0',var:'100000',es:'150000'}))app.ids.get('risk-'+id).value=value;
  for(const [id,value] of Object.entries({'risk-oracle-time':new Date(Date.now()-1000).toISOString(),'risk-venue':'healthy','order-side':'buy','order-key':'controlled-order-key','order-mandate':'f'.repeat(64)}))app.ids.get(id).value=value;
}
test('Testnet risk preview never invents oracle freshness or venue health and refuses ambiguous numeric input',async()=>{
  for(const [id,value] of [['risk-oracle-time',''],['risk-oracle-time','2026-02-30T00:00:00Z'],['risk-oracle-time',new Date(Date.now()+60000).toISOString()],['risk-oracle-time',new Date(Date.now()-60000).toISOString()],['risk-venue',''],['risk-venue','unhealthy'],['risk-loss',''],['risk-loss','1e3'],['risk-gas','-1'],['risk-var','1.5'],['risk-es','9007199254740992']]){
    const app=harness();await settle();observedOrder(app);app.ids.get(id).value=value;
    await app.ids.get('preview-order').onclick();await app.submit('testnet-order-form');
    assert.equal(vm.runInContext('pendingOrder',app.context),null);assert.equal(app.proofs(),0);
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
  }
});
test('Testnet preview displays exact operator observations and changed risk or mandate requires a fresh preview before proof',async()=>{
  for(const [id,value] of [['risk-gas','101'],['order-mandate','e'.repeat(64)],['risk-oracle-time',new Date(Date.now()-2000).toISOString()],['risk-venue','unhealthy']]){
    const app=harness({confirmAction:()=>true});await settle();observedOrder(app);
    const original=app.ids.get('risk-oracle-time').value;await app.ids.get('preview-order').onclick();
    assert.equal(vm.runInContext('pendingOrder.Risk.oracleAsOf',app.context),original);
    assert.ok(app.ids.get('order-payload').textContent.includes(original));
    assert.ok(app.ids.get('order-payload').textContent.includes(vm.runInContext('t("riskOperatorObservation")',app.context)));
    app.ids.get(id).value=value;await app.submit('testnet-order-form');
    assert.equal(app.proofs(),0);assert.equal(app.calls.filter(call=>call.url.endsWith('/testnet/orders')).length,0);
  }
});
test('Testnet submission confirmation and pending proof fence exact risk data without rewriting observation time',async()=>{
  const app=harness({confirmAction:()=>true});await settle();observedOrder(app);await app.ids.get('preview-order').onclick();
  const proof=deferred();let proofCalls=0;app.context.window.YNXQuantWallet.requireProof=()=>{proofCalls++;return proof.promise};
  const submit=app.submit('testnet-order-form');await settle();assert.equal(proofCalls,1);
  app.ids.get('risk-gas').value='102';proof.resolve('controlled-not-real-proof');await submit;
  assert.equal(app.calls.filter(call=>call.url.endsWith('/testnet/orders')).length,0);
  const rejected=harness({confirmAction:()=>false});await settle();observedOrder(rejected);await rejected.ids.get('preview-order').onclick();await rejected.submit('testnet-order-form');assert.equal(rejected.proofs(),0);
});
test('operator risk observation labels and rejection stay in all twelve selected languages',async()=>{
 const app=harness();await settle();
 for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
  app.ids.get('locale').onchange({target:{value:language}});await app.submit('testnet-order-form');
  assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("riskObservationInvalid")',app.context));
  for(const key of ['riskOracleTime','riskVenueObservation','riskOperatorObservation','riskOrderConfirm'])assert.ok(vm.runInContext(`t(${JSON.stringify(key)})`,app.context));
 }
});
const testnetReceipt=review=>({id:'testnet-000007',mandateDigest:review.MandateDigest,strategyHash:'e'.repeat(64),market:review.draft.Market,side:review.draft.Side,price:review.draft.Price,amount:review.draft.Amount,idempotencyKey:review.draft.IdempotencyKey,status:'submitted_testnet',createdAt:new Date().toISOString(),venueOrderId:'controlled-venue-order',venueStatus:'open',authorizationDigest:'b'.repeat(64),brokerProof:'controlled-broker-receipt-not-a-real-session'});
test('Testnet confirmation binds the signature across the asynchronous proof boundary without replacement or retry',async()=>{
 for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
  const app=harness({confirmAction:()=>true});await settle();observedOrder(app);await app.ids.get('preview-order').onclick();
  app.ids.get('locale').onchange({target:{value:language}});app.ids.get('order-signature').value='controlled-original-signature';
  const proof=deferred();let calls=0;app.context.window.YNXQuantWallet.requireProof=()=>{calls++;return proof.promise};
  const submission=app.submit('testnet-order-form');await settle();assert.equal(calls,1);
  app.ids.get('order-signature').value='controlled-replacement-signature';proof.resolve('controlled-not-real-proof');await submission;
  assert.equal(app.calls.filter(call=>call.url.endsWith('/testnet/orders')).length,0);
  assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("paperPreviewChanged")',app.context));
  assert.notEqual(vm.runInContext('pendingOrder',app.context),null);assert.equal(app.ids.get('order-signature').value,'controlled-replacement-signature');
  assert.equal(app.ids.get('testnet-order-submit').disabled,false);
 }
});
test('Testnet malformed or foreign 201 receipt never claims success or clears exact preview/signature',async()=>{
 for(const patch of [null,[],{}, {id:'foreign'},{mandateDigest:'a'.repeat(64)},{market:'OTHER'},{side:'sell'},{price:999},{amount:999},{idempotencyKey:'other-key'},{status:'reserved_outcome_unknown'},{venueStatus:'rejected'},{venueOrderId:''},{brokerProof:''},{authorizationDigest:'bad'},{createdAt:'2026-02-30T00:00:00Z'},{strategyHash:null}]){
  let returned=null;const app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{}:url.endsWith('/testnet/orders')?returned:{payload:'Controlled local preview',digest:'f'.repeat(64)}});await settle();observedOrder(app);await app.ids.get('preview-order').onclick();
  const review=vm.runInContext('pendingOrder',app.context);returned=patch===null||Array.isArray(patch)?patch:{...testnetReceipt(review),...patch};
  if(patch&&Object.keys(patch).length===0)returned={};
  app.context.window.YNXQuantWallet.requireProof=async()=> 'controlled-test-proof';app.ids.get('order-signature').value='controlled-signature';
  await app.submit('testnet-order-form');
  assert.notEqual(vm.runInContext('pendingOrder',app.context),null);assert.equal(app.ids.get('order-signature').value,'controlled-signature');
  assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("executionOutcomeUnknown")',app.context));assert.equal(app.ids.get('testnet-order-submit').disabled,false);
  assert.equal(app.calls.filter(call=>call.url.endsWith('/testnet/orders')).length,1);
 }
});
test('exact confirmed Testnet receipt alone clears preview and double submit shares one proof/request lane',async()=>{
 let returned;const confirmation=deferred(),app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{}:url.endsWith('/testnet/orders')?returned:{payload:'Controlled local preview',digest:'f'.repeat(64)}});await settle();observedOrder(app);await app.ids.get('preview-order').onclick();returned=testnetReceipt(vm.runInContext('pendingOrder',app.context));
 let proofCalls=0;app.context.window.YNXQuantWallet.requireProof=()=>{proofCalls++;return confirmation.promise};app.ids.get('order-signature').value='controlled-signature';
 const first=app.submit('testnet-order-form');await settle();await app.submit('testnet-order-form');assert.equal(proofCalls,1);assert.equal(app.ids.get('testnet-order-submit').disabled,true);
 confirmation.resolve('controlled-test-proof');await first;
 assert.equal(app.calls.filter(call=>call.url.endsWith('/testnet/orders')).length,1);assert.equal(vm.runInContext('pendingOrder',app.context),null);assert.equal(app.ids.get('order-signature').value,'');assert.equal(app.ids.get('testnet-order-submit').disabled,false);
 assert.equal(JSON.parse(app.calls.find(call=>call.url.endsWith('/testnet/orders')).options.body).WalletSignature,'controlled-signature');
 assert.ok(app.ids.get('toast').textContent.includes('Venue status is not a settlement'));assert.doesNotMatch(app.ids.get('toast').textContent,/controlled-broker-receipt/);
 for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){app.ids.get('locale').onchange({target:{value:language}});assert.ok(app.ids.get('toast').textContent.startsWith(vm.runInContext('t("executionReceiptConfirmed")',app.context)));}
});

test('configured research split never claims a fixed 50 percent and follows every selected language',async()=>{
  assert.doesNotMatch(html,/First 50%|Held-out 50%/);
  const app=harness();await settle();
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.equal(app.ids.get('research-configured-training').textContent,'24');
    const copy=vm.runInContext('t("runEvaluationRemainder")',app.context);
    assert.ok(copy&&copy!=='runEvaluationRemainder');
    assert.equal(app.ids.get('research-held-out').textContent,copy);
  }
  await app.submit('backtest');
  const post=app.calls.find(call=>call.url.endsWith('/backtests/from-market'));
  assert.ok(post);assert.equal(JSON.parse(post.options.body).assumptions.trainEnd,24);
});

test('service failures localize in every language without exposing arbitrary error payloads or retrying',async()=>{
  for(const [status,error,key] of [[400,'invalid_json','apiInputsRejected'],[401,'unrecognized-secret-message','apiAccessRejected'],[403,'forbidden','apiAccessRejected'],[409,'conflict','apiStateConflict'],[429,'busy','apiServiceUnavailable'],[503,'unavailable','apiServiceUnavailable'],[404,{secret:'not-for-ui'},'apiFailureUnknown']]){
    const app=harness({apiStatus:url=>url.endsWith('/snapshot')?200:status,apiResponse:url=>url.endsWith('/snapshot')?{}:{error}});await settle();
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});
      await assert.rejects(vm.runInContext('api("/v1/paper/orders",{method:"POST",body:"{}"})',app.context),value=>{
        assert.equal(value.status,status);assert.equal(value.localeKey,key);assert.equal(value.message,vm.runInContext(`t(${JSON.stringify(key)})`,app.context));assert.doesNotMatch(value.message,/secret|not-for-ui|HTTP 404/);
        return true;
      });
    }
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,12);assert.equal(app.proofs(),0);
  }
});

test('unknown HTTP rejection preserves exact research intent instead of assuming definitive refusal',async()=>{
  const app=harness({apiStatus:url=>url.endsWith('/snapshot')?200:400,apiResponse:url=>url.endsWith('/snapshot')?{}:{error:'unknown-internal-value'}});await settle();
  await app.submit('backtest');const key=[...app.storage.keys()].find(key=>key.startsWith('ynx.quant.research.pending')),raw=app.storage.get(key);
  assert.ok(raw);assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("apiInputsRejected")',app.context));
  app.ids.get('locale').onchange({target:{value:'ar'}});assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("apiInputsRejected")',app.context));
  assert.equal(app.storage.get(key),raw);assert.equal(app.calls.filter(call=>call.options.method==='POST').length,1);
  await app.submit('backtest');assert.equal(app.storage.get(key),raw);
  const posts=app.calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);
});

test('unknown or status-mismatched Paper failures retain one exact intent without automatic retry or risk refresh',async()=>{
  const hash='d'.repeat(64);
  for(const [status,error] of [[400,'internal-secret'],[503,'paper_daily_loss_limit'],[401,{secret:'hidden'}]]){
    const app=harness({snapshot:{strategies:{one:{Name:'Saved choice',StrategyHash:hash}}},confirmAction:()=>true,apiStatus:url=>url.endsWith('/snapshot')?200:status,apiResponse:url=>url.endsWith('/snapshot')?{strategies:{one:{Name:'Saved choice',StrategyHash:hash}}}:{error}});await settle();
    app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';await app.submit('paper-order');
    const key=[...app.storage.keys()].find(key=>key.startsWith('ynx.quant.paper.pending')),raw=app.storage.get(key);assert.ok(raw);
    assert.equal(app.calls.filter(call=>call.url.endsWith('/snapshot')).length,1);
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,1);
    await app.submit('paper-order');const posts=app.calls.filter(call=>call.options.method==='POST');
    assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);assert.equal(app.storage.get(key),raw);assert.equal(app.proofs(),0);
  }
});

test('Testnet execution readback never promotes reserved or malformed rows to a venue fill',async()=>{
  const app=harness();await settle();
  const good={id:'testnet-000001',market:'YNXT-YUSD_TEST',side:'buy',amount:12,status:'submitted_testnet',venueOrderId:'venue-controlled',venueStatus:'filled',authorizationDigest:'a'.repeat(64),brokerProof:'controlled-proof'};
  app.context.executionFixture={good,missing:null,bad:{...good,id:'testnet-000002',amount:'12'},reserved:{...good,id:'testnet-000003',status:'reserved_outcome_unknown'}};
  vm.runInContext('snapshot.testnetOrders=executionFixture;render()',app.context);
  const rows=app.ids.get('testnet-execution-rows').innerHTML;
  assert.equal((rows.match(/venue-controlled/g)||[]).length,1);
  assert.equal((rows.match(/filled/g)||[]).length,1);
  assert.match(rows,/12 YNXT_MICRO/);
  for(const override of [{authorizationDigest:'bad'},{brokerProof:''},{venueOrderId:null},{venueStatus:'complete'},{status:'reserved'},{amount:0},{amount:Number.MAX_SAFE_INTEGER+1},{market:'BTC-USD'}]){
    app.context.badExecution={...good,...override};vm.runInContext('renderTestnetExecutions({bad:badExecution})',app.context);
    assert.ok(app.ids.get('testnet-execution-rows').innerHTML.includes(vm.runInContext('safe(t("executionRecordsUnavailable"))',app.context)));
  }
  vm.runInContext('render()',app.context);
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.ok(app.ids.get('testnet-execution-rows').innerHTML.includes(vm.runInContext('safe(t("executionOutcomeUnknown"))',app.context)));
  }
  app.context.executionFixture=null;vm.runInContext('snapshot.testnetOrders=executionFixture;render()',app.context);
  assert.ok(app.ids.get('testnet-execution-rows').innerHTML.includes(vm.runInContext('safe(t("executionRecordsUnavailable"))',app.context)));
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
});

test('schedule observations reject normalized invalid dates without inventing a runnable schedule',async()=>{
  const app=harness();await settle();
  for(const value of ['2026-02-30T00:00:00Z','0','2026-10-03','0001-01-01T00:00:00Z',null,undefined]){
    app.context.scheduleFixture=savedResearchStrategy({Runtime:{enabled:true,running:false,intervalSeconds:60,lastRunStatus:'scheduled',nextRunAt:value}});
    assert.equal(vm.runInContext('observedSchedule(scheduleFixture)',app.context),null);
    assert.equal(vm.runInContext('scheduleTime(scheduleFixture.Runtime.nextRunAt)',app.context),'—');
    vm.runInContext('snapshot.strategies={saved:scheduleFixture};render()',app.context);
    assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);
  }
  for(const value of ['2024-02-29T00:00:00Z','2026-10-03T09:00:00+09:00']){
    app.context.scheduleFixture=savedResearchStrategy({Runtime:{enabled:true,running:false,intervalSeconds:60,lastRunStatus:'scheduled',nextRunAt:value}});
    assert.ok(vm.runInContext('observedSchedule(scheduleFixture)',app.context));
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});
      assert.notEqual(vm.runInContext('scheduleTime(scheduleFixture.Runtime.nextRunAt)',app.context),'—');
    }
  }
  assert.equal(app.calls.filter(call=>call.options.method==='PUT'||call.options.method==='POST').length,0);
});

test('lifecycle advancement reports its real stopped schedule in every language without offering restart',async()=>{
  const strategy=savedResearchStrategy({Stage:'Walk-forward',Runtime:{enabled:false,running:false,intervalSeconds:60,lastRunStatus:'stopped_stage_advanced',nextRunAt:'0001-01-01T00:00:00Z'}});
  const app=harness({snapshot:{strategies:{saved:strategy}}});await settle();
  app.context.advancedStrategy=strategy;
  assert.ok(vm.runInContext('observedSchedule(advancedStrategy)',app.context));
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});
    const copy=vm.runInContext('t("scheduleStageAdvanced")',app.context);
    assert.notEqual(copy,'scheduleStageAdvanced');
    assert.ok(app.ids.get('strategy-rows').innerHTML.includes(vm.runInContext('safe(t("scheduleStageAdvanced"))',app.context)));
    assert.ok(!app.ids.get('strategy-rows').innerHTML.includes(vm.runInContext('safe(t("scheduleUnknown"))',app.context)));
    assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);
  }
  assert.equal(app.calls.filter(c=>['PUT','POST'].includes(c.options.method)).length,0);assert.equal(app.proofs(),0);
});

test('idle cash amount stays source-bound and only known sampling policy receives localized explanation',async()=>{
  const result=researchFixture('idle-cash-receipt');result.attribution={currency:'YUSD_TEST_MICRO',averageIdleCapital:99998989487,idleCapitalSamplingPolicy:'observed_bar_cash_mean_truncate_micro_v1'};
  const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{}:result});await settle();await app.submit('backtest');
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.equal(app.ids.get('research-idle-cash-rule').textContent,vm.runInContext('t("runIdleCashRule")',app.context));
    assert.match(app.ids.get('research-idle-cash').textContent,/YUSD_TEST/);
  }
  for(const idleCapitalSamplingPolicy of [undefined,null,'fill_only_old','<script>']){
    result.attribution.idleCapitalSamplingPolicy=idleCapitalSamplingPolicy;await app.submit('backtest');
    assert.equal(app.ids.get('research-idle-cash-rule').textContent,'—');assert.match(app.ids.get('research-idle-cash').textContent,/YUSD_TEST/);
  }
  for(const amount of [undefined,null,NaN,Infinity,'99998989487',0.5,Number.MAX_SAFE_INTEGER+1]){
    result.attribution.averageIdleCapital=amount;await app.submit('backtest');assert.equal(app.ids.get('research-idle-cash').textContent,'—');
  }
  for(const amount of [0,-7]){
    result.attribution.averageIdleCapital=amount;await app.submit('backtest');assert.notEqual(app.ids.get('research-idle-cash').textContent,'—');
  }
});

test('Paper daily loss shows only source-reported risk and explains the UTC first-mark model in all locales',async()=>{
  const app=harness();await settle();
  app.context.dailyFixture={Policy:'utc_first_mark_equity_loss_micro_v1',Day:'2026-10-03',Loss:1000000000,Limit:1000000000,Breached:true};
  vm.runInContext('snapshot.paper={DailyRisk:dailyFixture};render()',app.context);
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    const text=app.ids.get('paper-state').innerHTML;
    assert.ok(text.includes(vm.runInContext('safe(t("paperDailyLoss"))',app.context)));
    assert.ok(text.includes('1000000000 / 1000000000 YUSD_TEST_MICRO'));
    assert.ok(vm.runInContext('t("paperExecutionBoundary")',app.context).includes(vm.runInContext('t("paperDailyLossLead")',app.context)));
  }
  for(const risk of [undefined,{...app.context.dailyFixture,Policy:'old_unknown'},{...app.context.dailyFixture,Loss:NaN},{...app.context.dailyFixture,Day:'<script>'}]){
    app.context.dailyFixture=risk;vm.runInContext('snapshot.paper={DailyRisk:dailyFixture};render()',app.context);
    assert.ok(!app.ids.get('paper-state').innerHTML.includes('1000000000 / 1000000000'));
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
});

test('Paper daily risk rejects impossible calendar dates and threshold contradictions but preserves a latched breach',async()=>{
  const app=harness();await settle();
  const base={Policy:'utc_first_mark_equity_loss_micro_v1',Day:'2026-10-04',Loss:100,Limit:100,Breached:true};
  for(const patch of [{Day:'2026-02-29'},{Day:'2026-04-31'},{Day:'0000-01-01'},{Day:'2026-13-01'},{Breached:false},{Loss:101,Breached:false}]){
    app.context.dailyFixture={...base,...patch};vm.runInContext('snapshot.paper={DailyRisk:dailyFixture};render()',app.context);
    assert.ok(!app.ids.get('paper-state').innerHTML.includes('100 / 100 YUSD_TEST_MICRO'));
    assert.ok(!app.ids.get('paper-state').innerHTML.includes('101 / 100 YUSD_TEST_MICRO'));
  }
  for(const patch of [{Day:'2024-02-29'},{Loss:0,Breached:true},{Loss:99,Breached:false}]){
    app.context.dailyFixture={...base,...patch};vm.runInContext('snapshot.paper={DailyRisk:dailyFixture};render()',app.context);
    assert.ok(app.ids.get('paper-state').innerHTML.includes(`${app.context.dailyFixture.Loss} / 100 YUSD_TEST_MICRO`));
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
});

test('Paper amounts reject injected, missing and unsafe source values while preserving exact signed zero',async()=>{
  const app=harness();await settle();
  for(const value of [undefined,null,'0','<img src=x onerror=alert(1)>',{},[],true,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1]){
    app.context.paperFixture={Cash:value,Position:value,ReconciliationDelta:value,KillSwitch:'false'};
    vm.runInContext('snapshot.paper=paperFixture;render()',app.context);
    const html=app.ids.get('paper-state').innerHTML;
    assert.deepEqual([...html.matchAll(/<dd(?: class="[^"]*")?>(.*?)<\/dd>/g)].slice(0,4).map(m=>m[1]),['—','—','—','—']);
    assert.doesNotMatch(html,/<img|class="danger"/);
  }
  app.context.paperFixture={Cash:0,Position:-123,ReconciliationDelta:0,KillSwitch:false};vm.runInContext('snapshot.paper=paperFixture;render()',app.context);
  assert.deepEqual([...app.ids.get('paper-state').innerHTML.matchAll(/<dd(?: class="[^"]*")?>(.*?)<\/dd>/g)].slice(0,3).map(m=>m[1]),['0','-123','0']);
  assert.equal(app.calls.filter(c=>c.options.method==='POST').length,0);
});

test('reconciliation cannot substitute missing or malformed observed amounts with service defaults',async()=>{
  for(const paper of [{},{Cash:'0',Position:0},{Cash:0,Position:null},{Cash:Number.MAX_SAFE_INTEGER+1,Position:0},{Cash:0,Position:'<img>'}]){
    const app=harness({snapshot:{paper}});await settle();await app.ids.get('reconcile').onclick();
    assert.equal(app.calls.filter(c=>c.options.method==='POST').length,0);
    assert.match(app.ids.get('toast').textContent,/unconfirmed/);
  }
});

test('malformed audit rows cannot crash the workspace, forge empty history or erase valid rows',async()=>{
  const app=harness();await settle();
  const valid={Action:'controlled_audit',ObjectID:'fixture-object',CreatedAt:'2026-10-03T00:00:00Z',Hash:'a'.repeat(64)};
  for(const audit of [null,{},'bad',[null,{},valid],[{...valid,Hash:7},valid],[{...valid,CreatedAt:'2026-02-30T00:00:00Z'},valid]]){
    app.context.auditFixture=audit;
    assert.doesNotThrow(()=>vm.runInContext('snapshot.audit=auditFixture;render()',app.context));
    const html=app.ids.get('audit-rows').innerHTML;
    assert.doesNotMatch(html,/No audited actions yet/);
    if(Array.isArray(audit))assert.match(html,/controlled_audit/);
    assert.equal(app.calls.filter(c=>c.options.method==='POST').length,0);
  }
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.ok(app.ids.get('audit-rows').innerHTML.includes(vm.runInContext('safe(t("auditUnavailable"))',app.context)));
    assert.match(app.ids.get('audit-rows').innerHTML,/controlled_audit/);
  }
  vm.runInContext('snapshot.audit=[];render()',app.context);
  assert.equal(app.ids.get('audit-rows').innerHTML,vm.runInContext('`<li>${safe(t("auditEmpty"))}</li>`',app.context));
});

test('completed research must bind the exact submitted strategy ID, not another run with identical parameters',async()=>{
  const app=harness();await settle();
  const submitted={strategy:{id:'ma-current-request',name:'run-receipt',family:'transparent',seed:7,params:{fast:3,slow:8}},assumptions:{feeBPS:10,slippageBPS:5,latencyBars:1,participationBPS:1000,trainEnd:24,walkForwardWindows:3,seed:7}};
  const result=researchFixture('run-receipt');result.strategy.ID=submitted.strategy.id;
  app.context.matchResult=result;app.context.matchSubmitted=submitted;
  assert.equal(vm.runInContext('researchRequestMatches(matchResult,matchSubmitted)',app.context),true);
  for(const id of [undefined,null,'','ma-other-request']){
    result.strategy.ID=id;
    assert.equal(vm.runInContext('researchRequestMatches(matchResult,matchSubmitted)',app.context),false);
  }
});

test('known service metric formulas follow all languages without rewriting unknown or missing definitions',async()=>{
  const app=harness();await settle();
  app.context.reportedFormula='maximum peak-to-trough equity loss / prior peak × 10,000';
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    const text=vm.runInContext('researchMetricDefinition({metricDefinitions:{maxDrawdownBPS:reportedFormula}},"maxDrawdownBPS")',app.context);
    assert.equal(text,vm.runInContext('t("formulaMaxDrawdownBPS")',app.context));
    if(language!=='en')assert.notEqual(text,app.context.reportedFormula);
    assert.equal(vm.runInContext('researchMetricDefinition({metricDefinitions:{maxDrawdownBPS:"Different historical formula <script>"}},"maxDrawdownBPS")',app.context),'Different historical formula <script>');
    assert.equal(vm.runInContext('researchMetricDefinition({},"maxDrawdownBPS")',app.context),'—');
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
});
test('translated metric registry matches the actual current Go research definitions exactly',async()=>{
  const go=await readFile(new URL('../../../internal/quantlab/service.go',import.meta.url),'utf8');
  const app=harness();await settle();
  const definitions=JSON.parse(vm.runInContext('JSON.stringify(reportedMetricDefinitions)',app.context));
  assert.equal(Object.keys(definitions).length,5);
  for(const [key,text] of Object.entries(definitions)){
    const literal=go.match(new RegExp('"'+key+'"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")'))?.[1];
    assert.ok(literal,key);assert.equal(JSON.parse(literal),text,key);
  }
});
test('reported new cost rounding policy is localized but old and unknown receipts never inherit it',async()=>{
  const result=researchFixture('rounded-cost-receipt');result.attribution={costRoundingPolicy:'independent_cost_component_floor_micro_v1'};
  const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:result});await settle();await app.submit('backtest');
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.equal(app.ids.get('research-cost-rounding').textContent,vm.runInContext('t("runCostRoundingRule")',app.context));
  }
  for(const costRoundingPolicy of [undefined,null,'combined_cost_old','<script>']){
    result.attribution={costRoundingPolicy};await app.submit('backtest');assert.equal(app.ids.get('research-cost-rounding').textContent,'—');
  }
});

test('typed research HTTP rejection preserves prior results and localizes through all 12 languages without retry',async()=>{
  let rejected=false;
  const app=harness({apiStatus:url=>rejected&&!url.endsWith('/snapshot')?400:200,apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:rejected?{error:'invalid_research_parameters',errorId:'fixture-error-id'}:researchFixture('confirmed')});
  await settle();await app.submit('backtest');rejected=true;
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});await app.submit('backtest');
    assert.equal(app.ids.get('toast').textContent,vm.runInContext(`businessCopy[${JSON.stringify(language)}].researchInputInvalid`,app.context));
    assert.equal(app.ids.get('result-return').textContent,'120 bps');assert.equal(app.ids.get('research-submit').disabled,false);
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,13);
  app.ids.get('locale').onchange({target:{value:'en'}});assert.equal(app.ids.get('toast').textContent,vm.runInContext('businessCopy.en.researchInputInvalid',app.context));
});

test('a research response with different or missing declared costs/windows is not the submitted completed run',async()=>{
  let response=researchFixture('good-run');const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:response});await settle();await app.submit('backtest');
  const good=response;
  const cases=[{status:'running'},{assumptions:undefined},...Object.keys(good.assumptions).map(key=>({assumptions:{...good.assumptions,[key]:good.assumptions[key]+1}})),{strategy:{...good.strategy,Params:{fast:4,slow:8}}},{strategy:{...good.strategy,Params:{fast:3,slow:8,hidden:1}}},{strategy:{...good.strategy,Seed:8}},{strategy:{...good.strategy,Family:'other-engine'}}];
  for(const change of cases){response={...good,...change,id:'unbound-run',metrics:{...good.metrics,ReturnBPS:999}};await app.submit('backtest');assert.equal(app.ids.get('result-return').textContent,'120 bps');assert.match(app.ids.get('toast').textContent,/unconfirmed/);assert.equal(app.ids.get('research-submit').disabled,false);}
});

test('research rejects empty, unsafe, fractional and reordered parameters before HTTP without silently using zero or engine defaults',async()=>{
  for(const [id,value] of [['strategy',''],['strategy','   '],['strategy','x'.repeat(81)],['seed',''],['seed','1.5'],['seed','9007199254740992'],['fee',''],['fee','-1'],['fee','1.5'],['fee','9007199254740992'],['slippage',''],['slippage','-1'],['fast',''],['fast','1'],['fast','8'],['slow',''],['slow','3'],['slow','3.5']]){
    const app=harness();await settle();app.ids.get(id).value=value;await app.submit('backtest');
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0,`${id}=${value}`);
    assert.equal(app.ids.get('research-submit').disabled,false);
    assert.equal(app.ids.get('backtest').ariaBusy,'false');
  }
});

test('research input errors follow all 12 languages and explicit zero costs and zero seed remain exact',async()=>{
  const zero=researchFixture('zero-cost');zero.strategy.Seed=0;Object.assign(zero.assumptions,{FeeBPS:0,SlippageBPS:0,Seed:0});
  const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:zero});await settle();
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});app.ids.get('fee').value='';await app.submit('backtest');
    assert.equal(app.ids.get('toast').textContent,vm.runInContext(`businessCopy[${JSON.stringify(language)}].researchInputInvalid`,app.context));
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
  for(const id of ['fee','slippage','seed'])app.ids.get(id).value='0';await app.submit('backtest');
  const request=JSON.parse(app.calls.find(call=>call.options.method==='POST').options.body);
  assert.equal(request.assumptions.feeBPS,0);assert.equal(request.assumptions.slippageBPS,0);assert.equal(request.strategy.seed,0);assert.equal(request.assumptions.seed,0);
  assert.equal(app.ids.get('result-return').textContent,'120 bps');
});

test('research schedule never treats blank costs as zero, including changes during explicit confirmation',async()=>{
  const strategy=savedResearchStrategy();
  for(const id of ['fee','slippage','seed']){
    const app=harness({snapshot:{strategies:{saved:strategy}},confirmAction:()=>true});await settle();app.ids.get(id).value='';await app.schedule(strategy,true);
    assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
  }
  const app=harness({snapshot:{strategies:{saved:strategy}},confirmAction:()=>{app.ids.get('fee').value='';return true}});await settle();app.ids.get('fee').value='0';await app.schedule(strategy,true);
  assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
});

test('Paper records preserve exact service quantities and do not depend on the selected wallet',async()=>{
  const records=[paperRecord()];const app=harness({snapshot:{paper:{Orders:records}}});await settle();
  const rendered=app.ids.get('paper-record-rows').innerHTML;
  assert.match(rendered,/9007199254740991 \/ 2000000 \/ 1000000/);assert.match(rendered,/authoritative_market_adapter/);assert.match(rendered,/partially_filled/);assert.equal(app.ids.get('paper-record-status').textContent,'');
  app.wallet(connected(accountA));app.wallet(connected(accountB));await settle();assert.equal(app.ids.get('paper-record-rows').innerHTML,rendered);assert.equal(records[0].ID,'paper-000042');
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
});

test('Paper market attribution preserves escaped source and exact observation independently of execution time',async()=>{
  const fields={MarketSource:'fixture://market/<script>x</script>',MarketPriceMicro:9007199254740991,MarketVolumeMicro:20000000,MarketObservedAt:'2026-10-02T23:59:59.123456789+02:00'};
  const app=harness({snapshot:{paper:{Orders:[paperRecord(fields)]}}});await settle();
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    const rendered=app.ids.get('paper-record-rows').innerHTML;
    assert.ok(rendered.includes(fields.MarketObservedAt));assert.match(rendered,/fixture:\/\/market\/&lt;script&gt;x&lt;\/script&gt;/);assert.doesNotMatch(rendered,/<script>|href=/);
    assert.ok(rendered.includes(vm.runInContext('t("observed")',app.context)));assert.equal(app.ids.get('paper-record-status').textContent,'');
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
  for(const changes of [{MarketObservedAt:''},{MarketObservedAt:'2026-02-30T00:00:00Z'},{MarketPriceMicro:1},{MarketVolumeMicro:0},{MarketSource:''}]){
    const invalid=harness({snapshot:{paper:{Orders:[paperRecord({...fields,...changes})]}}});await settle();
    assert.match(invalid.ids.get('paper-record-rows').innerHTML,/Observed: —/);assert.equal(invalid.ids.get('paper-record-status').textContent,'');
  }
});

test('Paper records reject normalized impossible dates and non-RFC timestamps',async()=>{
  for(const CreatedAt of ['0','2026-02-30T00:00:00Z','2026-10-03','2026-10-03T00:00:00','0000-01-01T00:00:00Z']){
    const app=harness({snapshot:{paper:{Orders:[paperRecord({CreatedAt})]}}});await settle();
    assert.equal(app.ids.get('paper-record-status').textContent,vm.runInContext('businessCopy.en.paperRecordsUnknown',app.context));
    assert.match(app.ids.get('paper-record-rows').innerHTML,/class="danger"/);
  }
  for(const CreatedAt of ['2024-02-29T23:59:59.123456789Z','2026-10-03T09:00:00+09:00']){
    const app=harness({snapshot:{paper:{Orders:[paperRecord({CreatedAt})]}}});await settle();
    assert.equal(app.ids.get('paper-record-status').textContent,'');
    assert.ok(app.ids.get('paper-record-rows').innerHTML.includes(CreatedAt));
  }
});
test('Paper record missing, empty, duplicate and malformed receipts cannot become confirmed fills',async()=>{
  for(const Orders of [undefined,[],[paperRecord({Filled:2000001})],[paperRecord({Status:'filled'})],[paperRecord({Source:'<script>fabricated</script>'})],[paperRecord(),paperRecord()],Array.from({length:101},(_,i)=>paperRecord({ID:`paper-${i}`})),[null], [paperRecord({Price:9007199254740992})]]){
    const app=harness({snapshot:{paper:{Orders}}});await settle();
    assert.match(app.ids.get('paper-record-status').textContent,Array.isArray(Orders)&&Orders.length===0?/No recorded/:/unavailable or unverified/);
    assert.doesNotMatch(app.ids.get('paper-record-rows').innerHTML,/<script>/);
    app.ids.get('locale').onchange({target:{value:'ar'}});assert.equal(app.ids.get('paper-record-status').textContent,vm.runInContext(`businessCopy.ar.${Array.isArray(Orders)&&Orders.length===0?'paperRecordsEmpty':'paperRecordsUnknown'}`,app.context));
  }
});

// Execute the shipped app with a small DOM/HTTP boundary. Provider lifecycles are
// independently exercised in the actual-browser suite; these are local fixtures.
class Element {
  constructor(tag = 'div', attrs = '') {
    this.tagName = tag; this.dataset = {}; this.value = ''; this.textContent = ''; this.hidden = /\bhidden\b/.test(attrs); this.disabled = /\bdisabled\b/.test(attrs); this.children = []; this.events = new Map(); this._html = '';
    this.classes = new Set((attrs.match(/class="([^"]*)"/)?.[1] || '').split(/\s+/));
    this.classList = {add: name => this.classes.add(name), remove: name => this.classes.delete(name), toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)};
    for (const [, key, value] of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
      else if (key === 'value' || key === 'id') this[key] = value;
    }
  }
  get innerHTML() {return this.textContent ? this.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : this._html;}
  set innerHTML(value) {this._html = value; this.textContent = '';}
  addEventListener(type, listener) {this.events.set(type, [...(this.events.get(type) || []), listener]);}
  emit(type) {for (const listener of this.events.get(type) || []) listener({target: this});}
  append(...elements) {this.children.push(...elements);}
  replaceChildren(...elements) {this.children = elements;}
}
function harness({snapshot = {}, portfolioRead, apiResponse, rawSnapshot = false, apiStatus = () => 200, savedStorage, storageBoundary, confirmAction = () => false} = {}) {
  snapshot = {access: {statefulPreview: true}, ...snapshot};
  const ids = new Map(), elements = [];
  for (const [, tag, attrs] of html.matchAll(/<([a-z]+)\b([^>]*?)>/g)) {
    const element = new Element(tag, attrs); elements.push(element); if (element.id) ids.set(element.id, element);
  }
  const nav = elements.filter(element => element.tagName === 'button' && element.dataset.view), views = elements.filter(element => element.tagName === 'section' && element.classes.has('view'));
  const formInputs = id => [...html.match(new RegExp(`<form id="${id}"[\\s\\S]*?</form>`))[0].matchAll(/<(?:input|select)\b[^>]*id="([^"]+)"/g)].map(([, key]) => ids.get(key));
  const document = {documentElement: {}, createElement: tag => new Element(tag), querySelector: selector => selector === 'nav button.active' ? nav.find(element => element.classes.has('active')) : ids.get(selector.slice(1)), querySelectorAll: selector => {
    if (selector === 'nav button') return nav;
    if (selector === '.view') return views;
    if (selector === '.schedule-toggle[data-enabled="true"]') return [...ids.get('strategy-rows').innerHTML.matchAll(/<button\b([^>]*class="schedule-toggle"[^>]*)>/g)].map(([,attrs])=>new Element('button',attrs)).filter(element=>element.dataset.enabled==='true');
    if (selector === '[data-i18n]') return elements.filter(element => element.dataset.i18n);
    if (selector === '[data-business-i18n]') return elements.filter(element => element.dataset.businessI18n);
    if (selector.startsWith('#mandate-form')) return formInputs('mandate-form').filter(element => element.id !== 'mandate-signature');
    if (selector.startsWith('#testnet-order-form')) return formInputs('testnet-order-form').filter(element => element.id !== 'order-signature');
    throw new Error(`Unmodelled DOM selector: ${selector}`);
  }};
  const storage = new Map(savedStorage || []), calls = [], events = new Map(); let current = {status: 'disconnected'}, reads = 0, proofs = 0;
  const window = {addEventListener: (name, listener) => events.set(name, listener), YNXQuantWallet: {
    getStandardWalletState: () => current,
    readPortfolio: () => {reads++; return portfolioRead ? portfolioRead(current) : Promise.resolve(receipt(current.account));},
    requireProof: async () => {proofs++; throw new Error('PRIVATE_SERVICE_DEGRADED');},
  }};
  const context = vm.createContext({window, document, console, crypto: webcrypto, Intl, Date, BigInt, AbortController, TextEncoder, TextDecoder, setTimeout: () => 1, clearTimeout: () => {}, confirm: confirmAction,
    localStorage: {getItem: key => {storageBoundary?.('get',key);return storage.get(key) ?? null}, setItem: (key, value) => {if(storageBoundary?.('set',key)!==false)storage.set(key,value)}, removeItem: key => {if(storageBoundary?.('remove',key)!==false)storage.delete(key)}},
fetch: async (url, options) => {calls.push({url, options}); const submitted=url.endsWith('/paper/orders')?JSON.parse(options.body):null; let body = apiResponse ? await apiResponse(url, options) : url.endsWith('/snapshot') ? snapshot : submitted ? {...paperRecord({ID:'paper-000001',Price:1200000,Status:'filled',Filled:submitted.Amount}),...submitted} : {payload: 'exact-fixture-payload', digest: 'f'.repeat(64)};
    if (url.endsWith('/backtests/from-market') && body?.strategy) {
      const research=JSON.parse(options.body);
      // ID-less fixtures are response templates; bind their display name to the
      // submitted request too. Explicit IDs/names and malformed names stay raw.
      const Name=body.strategy.ID===undefined&&typeof body.strategy.Name==='string'&&body.strategy.Name.trim()?research.strategy.name:body.strategy.Name;
      body={...body,strategy:{...body.strategy,Name,ID:body.strategy.ID??research.strategy.id},researchRequestKey:body.researchRequestKey??research.idempotencyKey};
    }
    const status = apiStatus(url); return {ok: status >= 200 && status < 300, status, headers:new Headers({'content-type':'application/json'}), text:async()=>JSON.stringify(url.endsWith('/snapshot')&&!rawSnapshot ? {access: {statefulPreview: true}, ...body} : body)};},
  });
  vm.runInContext(i18n, context);
  context.QuantI18n = window.QuantI18n;
  vm.runInContext(source, context);
  return {ids, calls, storage, context, reads: () => reads, proofs: () => proofs,
    schedule: (strategy,enabled) => ids.get('strategy-rows').events.get('click')[0]({target:{closest:()=>({disabled:false,dataset:{strategyId:encodeURIComponent(strategy.ID),strategyHash:strategy.StrategyHash,enabled:String(enabled)}})}}),
    wallet: state => {current = state; events.get('ynx:quant-wallet-state')({detail: state});},
    submit: id => ids.get(id).onsubmit({preventDefault() {}}),
  };
}

test('saved research parameters fill only an explicit draft and never run, order or replace cost assumptions',async()=>{
  const strategy={...savedResearchStrategy(),Seed:0,Params:{fast:4,slow:12}},app=harness({snapshot:{strategies:{saved:strategy}}});await settle();
  const key=encodeURIComponent(strategy.ID)+':'+strategy.StrategyHash;
  assert.equal(app.ids.get('research-reuse').disabled,true);
  app.ids.get('research-saved-strategy').value=key;app.ids.get('research-saved-strategy').onchange();
  app.ids.get('fee').value='34';app.ids.get('slippage').value='17';
  app.ids.get('research-reuse').onclick();
  assert.equal(app.ids.get('strategy').value,strategy.Name);assert.equal(app.ids.get('seed').value,'0');assert.equal(app.ids.get('fast').value,'4');assert.equal(app.ids.get('slow').value,'12');assert.equal(app.ids.get('fee').value,'34');assert.equal(app.ids.get('slippage').value,'17');
  assert.match(app.ids.get('toast').textContent,/No run or order started/);
  assert.equal(app.calls.filter(call=>call.options.method==='POST'||call.options.method==='PUT').length,0);assert.equal(app.proofs(),0);
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});app.ids.get('research-reuse').onclick();
    assert.equal(app.ids.get('toast').textContent,vm.runInContext(`businessCopy[${JSON.stringify(language)}].reuseSavedDone`,app.context));
  }
});
test('saved research reuse rejects stale hashes, duplicate identities and missing or unsafe parameters without changing draft',async()=>{
  for(const invalid of [{Seed:undefined},{Family:'different_engine'},{Params:{fast:4,slow:12,other:1}},{Params:{fast:Number.MAX_SAFE_INTEGER+1,slow:12}},{Params:{fast:1,slow:12}},{Name:''}]){
    const app=harness({snapshot:{strategies:{one:{...savedResearchStrategy(),Seed:0,Params:{fast:4,slow:12},...invalid}}}});await settle();assert.equal(app.ids.get('research-saved-strategy').disabled,true);assert.equal(app.ids.get('research-reuse').disabled,true);
  }
  const strategy={...savedResearchStrategy(),Seed:0,Params:{fast:4,slow:12}};
  for(const strategies of [{one:strategy,two:strategy},{one:strategy}]){
    const app=harness({snapshot:{strategies}});await settle();app.ids.get('strategy').value='Preserve draft';app.ids.get('research-saved-strategy').value=encodeURIComponent(strategy.ID)+':'+(Object.keys(strategies).length===1?'e'.repeat(64):strategy.StrategyHash);app.ids.get('research-reuse').onclick();assert.equal(app.ids.get('strategy').value,'Preserve draft');assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
  }
});
test('malformed saved strategy rows cannot erase valid workspace or become Paper choices',async()=>{
  const valid=savedResearchStrategy();
  const app=harness();await settle();
  app.context.strategyRead={bad:null,hash:savedResearchStrategy({StrategyHash:42}),array:[],valid};
  vm.runInContext('snapshot.strategies=strategyRead;render()',app.context);
  assert.match(app.ids.get('strategy-rows').innerHTML,/Saved research/);
  assert.match(app.ids.get('strategy-rows').innerHTML,/class="danger"/);
  assert.equal(app.ids.get('paper-strategy').children.length,2);
  assert.equal(app.ids.get('paper-strategy').children[1].value,valid.StrategyHash);
  assert.equal(app.ids.get('mandate-strategy').value,valid.StrategyHash);
  assert.equal(app.calls.filter(call=>call.options.method==='POST'||call.options.method==='PUT').length,0);
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.ok(app.ids.get('strategy-rows').innerHTML.includes(vm.runInContext('safe(t("scheduleUnknown"))',app.context)));
    assert.match(app.ids.get('strategy-rows').innerHTML,/Saved research/);
  }
});
test('saved research schedules render source failures and disable unknown or ineligible runtimes',async()=>{
  for(const Runtime of [undefined,{enabled:false},{enabled:true,running:false,intervalSeconds:60,nextRunAt:'not-a-date',lastRunStatus:'scheduled'},{enabled:false,running:true,intervalSeconds:60}]){
    const strategy=savedResearchStrategy({Runtime}),app=harness({snapshot:{strategies:{saved:strategy}}});await settle();assert.match(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML,/>Stopped</);await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
  }
  const strategy=savedResearchStrategy({ID:'saved"><img src=x>',Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunAt:'2026-10-03T01:00:00Z',lastRunStatus:'failed_market_data_unavailable',lastExperiment:''}}),app=harness({snapshot:{strategies:{saved:strategy}}});await settle();const rows=app.ids.get('strategy-rows').innerHTML;assert.match(rows,/Market data unavailable/);assert.doesNotMatch(rows,/failed_market_data_unavailable|<img src=x>/);assert.match(rows,/Stop schedule/);
});

test('contradictory schedule snapshots cannot claim a run state or enable a schedule write',async()=>{
  for(const [enabled,running,lastRunStatus] of [[true,false,'running'],[true,true,'completed'],[true,true,'scheduled'],[true,false,'stopped_by_user'],[true,false,'cancelled_before_execution'],[false,false,'running'],[false,false,'completed'],[false,false,0],[false,false,null]]){
    const strategy=savedResearchStrategy({Runtime:{enabled,running,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus}});
    const app=harness({snapshot:{strategies:{saved:strategy}},confirmAction:()=>true});await settle();
    assert.match(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);
    assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);
    await app.schedule(strategy,!enabled);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
  }
});

test('schedule source states remain distinct and localize on language change without inventing completion',async()=>{
  const statuses=['scheduled','running','completed','stopped_by_user','cancelled_before_execution','failed_invalid_or_cancelled_configuration','failed_market_data_unavailable'];
  for(const status of statuses){
    const enabled=!['stopped_by_user','cancelled_before_execution'].includes(status);
    const strategy=savedResearchStrategy({Runtime:{enabled,running:status==='running',intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:status}});
    const app=harness({snapshot:{strategies:{saved:strategy}}});await settle();
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});
      const expected=vm.runInContext(`scheduleStatusText({lastRunStatus:${JSON.stringify(status)}})`,app.context);
      assert.ok(expected.length>0);assert.ok(app.ids.get('strategy-rows').innerHTML.includes(expected));assert.notEqual(expected,status);
    }
  }
  for(const status of ['unknown_future','toString','<img src=x>']){
    const strategy=savedResearchStrategy({Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:status}}),app=harness({snapshot:{strategies:{saved:strategy}}});await settle();
    assert.match(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);await app.schedule(strategy,false);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
  }
});

test('schedule configuration coalesces through rerender and binds the exact saved assumptions receipt',async()=>{
  const strategy=savedResearchStrategy(),pending=deferred();let observed=strategy,confirmations=0;
  const app=harness({confirmAction:()=>{confirmations++;return true},apiResponse:(url)=>url.endsWith('/snapshot')?{strategies:{saved:observed}}:pending.promise});await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';
  const first=app.schedule(strategy,true);await settle();vm.runInContext('render()',app.context);await app.schedule(strategy,true);assert.equal(confirmations,1);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,1);assert.match(app.ids.get('strategy-rows').innerHTML,/aria-busy="true" disabled/);
  app.ids.get('fee').value='99';const body=JSON.parse(app.calls.find(call=>call.options.method==='PUT').options.body);assert.equal(body.assumptions.feeBPS,10);
  observed={...strategy,Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:'scheduled',assumptions:{FeeBPS:10,SlippageBPS:5,Seed:42,LatencyBars:1,ParticipationBPS:1000,TrainEnd:24,WalkForwardWindows:3}}};pending.resolve(observed);await first;
  assert.match(app.ids.get('toast').textContent,/execution is not yet proved/);assert.match(app.ids.get('strategy-rows').innerHTML,/Stop schedule/);assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML,/aria-busy="true"/);assert.equal(app.proofs(),0);
});

test('schedule acknowledgement preserves already claimed and terminal enabled runs without another write',async()=>{
  for(const status of ['running','completed','failed_invalid_or_cancelled_configuration','failed_market_data_unavailable']){
    const strategy=savedResearchStrategy();let reads=0;
    const app=harness({confirmAction:()=>true,apiResponse:(url,options)=>{
      if(url.endsWith('/snapshot')){if(++reads===1)return {strategies:{saved:strategy}};throw Error('post-receipt outage')}
      const body=JSON.parse(options.body);
      return {...strategy,Runtime:{enabled:true,running:status==='running',intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:status,assumptions:Object.fromEntries(Object.entries(body.assumptions).map(([key,value])=>[key[0].toUpperCase()+key.slice(1),value]))}};
    }});await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';
    await app.schedule(strategy,true);
    assert.equal(vm.runInContext('scheduleUnconfirmed.size',app.context),0,status);
    assert.equal(vm.runInContext('snapshot.strategies.saved.Runtime.lastRunStatus',app.context),status);
    assert.match(app.ids.get('strategy-rows').innerHTML,/Stop schedule/);
    assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,1);
    assert.equal(app.proofs(),0);
  }
});

test('schedule acknowledgement rejects contradictory running or stopped states',async()=>{
  for(const [status,running] of [['running',false],['completed',true],['scheduled',true],['stopped_by_user',false],['cancelled_before_execution',false]]){
    const strategy=savedResearchStrategy();
    const app=harness({confirmAction:()=>true,apiResponse:(url,options)=>url.endsWith('/snapshot')?{strategies:{saved:strategy}}:{...strategy,Runtime:{enabled:true,running,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:status,assumptions:Object.fromEntries(Object.entries(JSON.parse(options.body).assumptions).map(([key,value])=>[key[0].toUpperCase()+key.slice(1),value]))}}});
    await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';await app.schedule(strategy,true);
    assert.equal(vm.runInContext('scheduleUnconfirmed.size',app.context),1,`${status}/${running}`);
    assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,1);
    assert.equal(app.proofs(),0);
  }
});

test('stale workspace blocks new schedules before confirmation but preserves confirmed stop',async()=>{
  for(const enabled of [false,true]){
    let confirmations=0,unavailable=false;
    const strategy=savedResearchStrategy({Runtime:enabled?{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:'scheduled'}:{enabled:false,running:false,intervalSeconds:0}});
    const app=harness({confirmAction:()=>{confirmations++;return true},apiResponse:url=>{
      if(url.endsWith('/snapshot')){if(unavailable)throw Error('offline');return {strategies:{saved:strategy}}}
      return {...strategy,Runtime:{enabled:false,running:false,intervalSeconds:0,lastRunStatus:'stopped_by_user'}};
    }});await settle();unavailable=true;await app.ids.get('refresh').onclick();
    await app.schedule(strategy,!enabled);
    assert.equal(confirmations,enabled?1:0);
    assert.equal(app.calls.filter(c=>c.options.method==='PUT').length,enabled?1:0);
    if(!enabled)assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("workspaceReadUnavailable")',app.context));
    assert.equal(vm.runInContext('statefulPreview',app.context),true);
  }
});
test('confirmed schedule start or stop survives unavailable follow-up history without becoming an unknown write',async()=>{
  for(const enabled of [true,false]){
    const strategy=savedResearchStrategy({Runtime:enabled?{enabled:false,running:false,intervalSeconds:0}:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunStatus:'scheduled'}});
    let reads=0,receipt;
    const app=harness({confirmAction:()=>true,apiResponse:(url,options)=>{
      if(url.endsWith('/snapshot')){if(++reads===1)return {strategies:{saved:strategy}};throw Error('Controlled post-receipt history outage')}
      const body=JSON.parse(options.body);
      receipt={...strategy,Runtime:{enabled:body.enabled,running:false,intervalSeconds:body.enabled?60:0,lastRunStatus:body.enabled?'scheduled':'stopped_by_user',...(body.enabled?{nextRunAt:'2026-10-03T01:01:00Z',assumptions:Object.fromEntries(Object.entries(body.assumptions).map(([k,v])=>[k[0].toUpperCase()+k.slice(1),v]))}:{})}};
      return receipt;
    }});await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';
    await app.schedule(strategy,enabled);
    assert.equal(vm.runInContext('scheduleUnconfirmed.size',app.context),0);
    assert.equal(vm.runInContext('workspaceReadUnavailable',app.context),true);
    assert.equal(vm.runInContext('snapshot.strategies.saved.Runtime.enabled',app.context),enabled);
    assert.equal(app.calls.filter(c=>c.options.method==='PUT').length,1);
    for(const language of vm.runInContext('supportedLocales',app.context)){
      app.ids.get('locale').onchange({target:{value:language}});
      assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("workspaceReadUnavailable")',app.context));
      assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML,new RegExp(vm.runInContext('t("scheduleUnknown")',app.context)));
    }
    assert.equal(app.proofs(),0);
  }
});

test('unbound schedule acknowledgements block another write until a fresh verified snapshot',async()=>{
  const strategy=savedResearchStrategy();for(const mismatch of [{ID:'foreign'},{StrategyHash:'e'.repeat(64)},{Stage:'BoundedTestnet'},{Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:00:00Z',lastRunStatus:'scheduled',assumptions:{FeeBPS:999}}}]){
    const base={...strategy,Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:00:00Z',lastRunStatus:'scheduled',assumptions:{FeeBPS:10,SlippageBPS:5,Seed:42,LatencyBars:1,ParticipationBPS:1000,TrainEnd:24,WalkForwardWindows:3}}};
    const app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{strategies:{saved:strategy}}:{...base,...mismatch}});await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';await app.schedule(strategy,true);assert.match(app.ids.get('toast').textContent,/Schedule unverified/);assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,1);await vm.runInContext('refresh()',app.context);assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);
  }
});

test('a snapshot started before an unconfirmed schedule write cannot erase its recovery boundary',async()=>{
  const strategy=savedResearchStrategy(),old=deferred();let snapshots=0;
  const app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?(++snapshots===2?old.promise:{strategies:{saved:strategy}}):{ID:'foreign'}});await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';
  const stale=vm.runInContext('refresh()',app.context);await app.schedule(strategy,true);old.resolve({strategies:{saved:strategy},access:{statefulPreview:true}});await stale;assert.match(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,1);await vm.runInContext('refresh()',app.context);assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);
});

test('schedule confirmations are localized and changed or unsafe assumptions make no write',async()=>{
  const strategy=savedResearchStrategy();let preview='';const app=harness({snapshot:{strategies:{saved:strategy}},confirmAction:message=>{preview=message;return false}});await settle();app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';
  for(const language of vm.runInContext('supportedLocales',app.context)){app.ids.get('locale').onchange({target:{value:language}});await app.schedule(strategy,true);assert.ok(preview.startsWith(vm.runInContext(`businessCopy[${JSON.stringify(language)}].scheduleConfirmStart`,app.context)));assert.ok(preview.includes(strategy.StrategyHash));assert.ok(preview.includes('10'))}
  app.context.confirm=()=>{app.ids.get('fee').value='99';return true};await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
  app.ids.get('fee').value='9007199254740992';app.context.confirm=()=>{throw Error('invalid values must not open confirmation')};await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
});

test('unconfirmed schedule failure keeps its recovery warning localized after language changes',async()=>{
  const strategy=savedResearchStrategy();
  const app=harness({snapshot:{strategies:{saved:strategy}},confirmAction:()=>true,apiResponse:url=>{if(url.endsWith('/snapshot'))return {strategies:{saved:strategy}};throw Error('internal transport detail');}});await settle();
  app.ids.get('fee').value='10';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';await app.schedule(strategy,true);
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("scheduleUnknown")',app.context));
    assert.ok(app.ids.get('strategy-rows').innerHTML.includes(vm.runInContext('safe(t("scheduleUnknown"))',app.context)));
  }
  await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,1);assert.equal(app.proofs(),0);
});

test('schedule input and typed service rejection stay distinct and localize without another write',async()=>{
  const strategy=savedResearchStrategy();
  for(const rejected of [false,true]){
    const app=harness({snapshot:{strategies:{saved:strategy}},confirmAction:()=>true,apiStatus:url=>rejected&&!url.endsWith('/snapshot')?400:200,apiResponse:url=>url.endsWith('/snapshot')?{strategies:{saved:strategy}}:{error:'invalid_research_parameters'}});await settle();
    app.ids.get('fee').value=rejected?'10':'';app.ids.get('slippage').value='5';app.ids.get('seed').value='42';await app.schedule(strategy,true);
    const key=rejected?'researchInputInvalid':'scheduleInvalid';
    for(const language of vm.runInContext('supportedLocales',app.context)){
      app.ids.get('locale').onchange({target:{value:language}});
      assert.equal(app.ids.get('toast').textContent,vm.runInContext(`t(${JSON.stringify(key)})`,app.context));
    }
    assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,rejected?1:0);assert.equal(app.proofs(),0);
  }
});

test('blocked or silent storage cannot crash public research or grant Paper authority', async () => {
  for(const mode of ['get','set','silent']){
    const app=harness({storageBoundary(operation){if(operation===mode)throw Error('Storage unavailable');if(mode==='silent'&&operation==='set')return false},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},strategies:{},experiments:{},paper:{},audit:[]}:researchFixture('storage-public')});await settle();
    assert.equal(app.ids.get('workspace-storage-boundary').hidden,false,mode);
    assert.equal(app.ids.get('kill').disabled,true);assert.equal(app.ids.get('reconcile').disabled,true);assert.equal(app.ids.get('paper-submit').disabled,true);
    await app.submit('backtest');assert.equal(app.calls.at(-1).url,'/api/v1/public/research/backtests/from-market');assert.equal(app.calls.at(-1).options.headers['x-ynx-tenant-id'],undefined);assert.equal(app.calls.at(-1).options.headers['x-ynx-preview-mode'],undefined);
    const before=app.calls.length;await app.submit('paper-order');await app.ids.get('kill').onclick();await app.ids.get('reconcile').onclick();assert.equal(app.calls.length,before);
    app.ids.get('locale').onchange({target:{value:'ar'}});assert.equal(app.context.document.documentElement.lang,'ar');assert.match(app.ids.get('workspace-storage-boundary').textContent,/تخزين/);
    assert.equal(app.proofs(),0);
  }
});

test('unreadable saved Paper intent is retained and blocks new orders until explicit local forgetting',async()=>{
  const tenant='a'.repeat(64),key='ynx.quant.paper.pending.v1:'+tenant,hash='d'.repeat(64);
  const valid={StrategyHash:hash,Side:'buy',Amount:100,IdempotencyKey:'quant-paper-12345678-1234-1234-1234-123456789abc'};
  for(const raw of ['{','null','[]',JSON.stringify(valid).replace('"Amount":100','"Amount":99,"Amount":100'),JSON.stringify({...valid,extra:true}),JSON.stringify({...valid,Amount:'100'}),JSON.stringify({...valid,IdempotencyKey:'quant-paper-'+'-'.repeat(36)}),'x'.repeat(65537)]){
    let accept=false,confirms=0;
    const app=harness({savedStorage:[["ynx.quant.tenant.v1",tenant],[key,raw]],snapshot:{strategies:{one:{Name:'Saved strategy',StrategyHash:hash}}},confirmAction:()=>{confirms++;return accept}});await settle();
    app.ids.get('paper-strategy').value=hash;app.ids.get('paper-strategy').onchange();
    assert.equal(app.storage.get(key),raw);assert.equal(app.ids.get('paper-submit').disabled,true);
    await app.submit('paper-order');assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(confirms,0);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});
      assert.equal(vm.runInContext('paperPendingStatus.textContent',app.context),vm.runInContext('t("paperPendingUnreadable")',app.context));
    }
    vm.runInContext('paperForgetButton.onclick()',app.context);assert.equal(app.storage.get(key),raw);
    accept=true;vm.runInContext('paperForgetButton.onclick()',app.context);
    assert.equal(app.storage.has(key),false);assert.equal(vm.runInContext('pendingPaperInvalid',app.context),false);
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
    assert.equal(app.ids.get('paper-submit').disabled,false);
  }
});

test('stale unreadable Paper Forget never deletes a replacement before or during confirmation',async()=>{
  const tenant='a'.repeat(64),key='ynx.quant.paper.pending.v1:'+tenant,hash='d'.repeat(64);
  const valid=JSON.stringify({StrategyHash:hash,Side:'buy',Amount:2000000,IdempotencyKey:'quant-paper-11111111-1111-1111-1111-111111111111'});
  for(const replacement of [valid,'[different unreadable bytes]'])for(const during of [false,true]){
    let confirms=0,app;
    app=harness({savedStorage:[["ynx.quant.tenant.v1",tenant],[key,'{']],snapshot:{strategies:{one:{Name:'Saved strategy',StrategyHash:hash}}},confirmAction:()=>{confirms++;if(during)app.storage.set(key,replacement);return true}});await settle();
    if(!during)app.storage.set(key,replacement);
    vm.runInContext('paperForgetButton.onclick()',app.context);
    assert.equal(app.storage.get(key),replacement);assert.equal(confirms,during?1:0);
    assert.equal(vm.runInContext('pendingPaperInvalid',app.context),replacement!==valid);
    if(replacement===valid)assert.equal(vm.runInContext('pendingPaperIntent.Amount',app.context),2000000);
    else assert.equal(vm.runInContext('pendingPaperUnreadableBytes',app.context),replacement);
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
  }
});

test('Paper journal read failure preserves current intent and fails closed without a write',async()=>{
  const tenant='a'.repeat(64),key='ynx.quant.paper.pending.v1:'+tenant,hash='d'.repeat(64);
  const raw=JSON.stringify({StrategyHash:hash,Side:'buy',Amount:100,IdempotencyKey:'quant-paper-12345678-1234-1234-1234-123456789abc'});let deny=false;
  const app=harness({savedStorage:[["ynx.quant.tenant.v1",tenant],[key,raw]],snapshot:{strategies:{one:{Name:'Saved strategy',StrategyHash:hash}}},storageBoundary(operation,k){if(deny&&operation==='get'&&k===key)throw Error('Read unavailable')}});await settle();
  deny=true;vm.runInContext('reloadPaperJournal();renderPaperSubmitControl()',app.context);
  assert.equal(vm.runInContext('pendingPaperIntent.Amount',app.context),100);assert.equal(app.storage.get(key),raw);
  assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(vm.runInContext('statefulPreview',app.context),false);
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
});

test('failed explicit Paper forgetting preserves unknown intent and disables further workspace writes',async()=>{
  const tenant='a'.repeat(64),key='ynx.quant.paper.pending.v1:'+tenant;
  const app=harness({savedStorage:[["ynx.quant.tenant.v1",tenant],[key,'{']],confirmAction:()=>true,storageBoundary(operation){if(operation==='remove')throw Error('Storage unavailable')}});await settle();
  vm.runInContext('paperForgetButton.onclick()',app.context);
  assert.equal(app.storage.get(key),'{');assert.equal(vm.runInContext('pendingPaperInvalid',app.context),true);
  assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(vm.runInContext('statefulPreview',app.context),false);
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
});

test('Paper intent persistence failure sends no order and disables durable workspace actions', async()=>{
  let denied=false;const hash='d'.repeat(64),app=harness({confirmAction:()=>true,snapshot:{strategies:{one:{Name:'Saved strategy',StrategyHash:hash}}},storageBoundary(operation,key){if(denied&&operation==='set'&&key.startsWith('ynx.quant.paper.pending'))throw Error('Quota exceeded')}});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='10';denied=true;
  await app.submit('paper-order');assert.equal(app.calls.filter(call=>call.url.endsWith('/paper/orders')).length,0);
  assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(app.ids.get('kill').disabled,true);assert.equal(app.ids.get('workspace-storage-boundary').hidden,false);
  await app.submit('backtest');assert.equal(app.calls.at(-1).url,'/api/v1/public/research/backtests/from-market');
});

test('research rejects a different returned name without clearing pending saved intent or replacing verified output',async()=>{
  let mismatch=false;
  const app=harness({apiResponse:(url,options)=>{
    if(url.endsWith('/snapshot'))return {access:{statefulPreview:true}};
    const body=JSON.parse(options.body),result=researchFixture('name-bound-result',mismatch?'Different returned name':body.strategy.name);
    if(mismatch)result.metrics.ReturnBPS=999;
    result.strategy.ID=body.strategy.id;return result;
  }});await settle();await app.submit('backtest');assert.equal(app.ids.get('result-return').textContent,'120 bps');
  mismatch=true;app.ids.get('strategy').value='  Exact submitted name  ';await app.submit('backtest');
  assert.equal(app.ids.get('result-return').textContent,'120 bps');assert.equal(app.ids.get('research-request-status').hidden,false);assert.match(app.ids.get('toast').textContent,/unconfirmed/);
  const prior=app.calls.filter(call=>call.options.method==='POST').at(-1).options.body;
  mismatch=false;await app.submit('backtest');assert.equal(app.calls.filter(call=>call.options.method==='POST').at(-1).options.body,prior);assert.equal(app.ids.get('research-request-status').hidden,true);
});
test('one in-flight research request preserves its submitted inputs and mode across double clicks and language changes',async()=>{
  for(const saved of [false,true]){
    const pending=deferred();const app=harness({snapshot:{access:{statefulPreview:saved}},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:saved},strategies:{},experiments:{},paper:{},audit:[]}:pending.promise});await settle();
    app.ids.get('strategy').value='Exact original strategy';app.ids.get('fast').value='3';app.ids.get('slow').value='8';
    const first=app.submit('backtest');await settle();assert.equal(app.ids.get('research-submit').disabled,true);assert.equal(app.ids.get('backtest').ariaBusy,'true');assert.equal(app.ids.get('research-request-status').hidden,false);
    app.ids.get('strategy').value='Edited next draft';app.ids.get('fast').value='99';await app.submit('backtest');
    app.ids.get('locale').onchange({target:{value:'ar'}});assert.match(app.ids.get('research-request-status').textContent,/قيد الانتظار/);
    const posts=app.calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].url,saved?'/api/v1/backtests/from-market':'/api/v1/public/research/backtests/from-market');
    const submitted=JSON.parse(posts[0].options.body);assert.equal(submitted.strategy.name,'Exact original strategy');assert.equal(submitted.strategy.params.fast,3);assert.match(submitted.strategy.id,/^ma-[0-9a-f-]{36}$/);
    assert.equal(app.ids.get('latest-result').hidden,true,'an in-flight request must not invent confirmed performance');
    pending.resolve(researchFixture('confirmed-single'));await first;
    assert.equal(app.ids.get('research-submit').disabled,false);assert.equal(app.ids.get('backtest').ariaBusy,'false');assert.equal(app.ids.get('research-request-status').hidden,true);
    assert.equal(app.ids.get('strategy').value,'Edited next draft');assert.equal(app.proofs(),0);
  }
});

test('failed temporary research unlocks an explicit retry without fabricating an experiment or automatic replay',async()=>{
  let posts=0;const app=harness({snapshot:{access:{statefulPreview:false}},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:(posts++,Promise.reject(Error('Exact bounded source failure')))});await settle();
  await app.submit('backtest');assert.equal(posts,1);assert.equal(app.ids.get('research-submit').disabled,false);assert.equal(app.ids.get('research-request-status').hidden,true);assert.equal(app.ids.get('latest-result').hidden,true);assert.match(app.ids.get('toast').textContent,/outcome is unconfirmed/);
  await app.submit('backtest');assert.equal(posts,2);assert.equal(app.proofs(),0);assert.equal(vm.runInContext('Object.keys(publicExperiments).length',app.context),0);
});
test('saved research retains one exact request across unknown outcome, reload, locale change and retry',async()=>{
  const failed=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true}}:Promise.reject(Error('Lost response'))});await settle();
  failed.ids.get('strategy').value='Exact saved retry';failed.ids.get('fee').value='17';await failed.submit('backtest');
  const first=failed.calls.find(call=>call.options.method==='POST'),body=JSON.parse(first.options.body);
  assert.match(body.idempotencyKey,/^quant-research-/);assert.equal(failed.ids.get('research-request-status').hidden,false);
  assert.equal(failed.calls.filter(call=>call.options.method==='POST').length,1);
  failed.ids.get('fee').value='18';await failed.submit('backtest');assert.equal(failed.calls.filter(call=>call.options.method==='POST').length,1);
  const receipt=researchFixture('same-durable-result');receipt.assumptions.FeeBPS=17;
  const retry=harness({savedStorage:failed.storage,apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true}}:receipt});await settle();
  assert.equal(retry.ids.get('strategy').value,'Exact saved retry');assert.equal(retry.ids.get('fee').value,'17');
  retry.ids.get('locale').onchange({target:{value:'ar'}});await retry.submit('backtest');
  assert.equal(retry.calls.find(call=>call.options.method==='POST').options.body,first.options.body);
  assert.equal(retry.ids.get('research-request-status').hidden,true);assert.equal(researchStatus(retry),vm.runInContext('businessCopy.ar.researchSaved',retry.context));
  assert.equal([...retry.storage.keys()].filter(key=>key.startsWith('ynx.quant.research.pending.v1:')).length,0);
  assert.equal(retry.proofs(),0);
});
test('unbound saved research key never clears an unknown request; explicit local forgetting does not change service records',async()=>{
  const app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true}}:{...researchFixture('wrong-key'),researchRequestKey:'quant-research-ffffffff-ffff-ffff-ffff-ffffffffffff'}});await settle();
  await app.submit('backtest');assert.equal(app.ids.get('latest-result').hidden,true);assert.equal(app.ids.get('research-request-status').hidden,false);
  const button=app.ids.get('backtest').children.find(item=>item.id==='research-forget-pending');assert.equal(button.hidden,false);
  const before=app.calls.length;button.onclick();assert.equal(app.calls.length,before);assert.equal(app.ids.get('research-request-status').hidden,true);
  assert.match(app.ids.get('toast').textContent,/Server records are unchanged/);
});
test('invalid persisted research intent is retained and cannot silently create a new run',async()=>{
  const id='a'.repeat(64),key='ynx.quant.research.pending.v1:'+id,raw='{"strategy":null}';
  const app=harness({savedStorage:[["ynx.quant.tenant.v1",id],[key,raw]]});await settle();await app.submit('backtest');
  assert.equal(app.storage.get(key),raw);assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.ids.get('research-request-status').hidden,false);
});
test('rewritten persisted research envelopes fail closed without discarding the exact pending bytes',async()=>{
  const original=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true}}:Promise.reject(Error('Lost response'))});await settle();await original.submit('backtest');
  const key=[...original.storage.keys()].find(key=>key.startsWith('ynx.quant.research.pending.v1:')),raw=original.storage.get(key);
  assert.ok(raw);
  const parsed=JSON.parse(raw);
  for(const changed of [raw.replace('"feeBPS":','"feeBPS":999,"feeBPS":'),raw.replace('"strategy":','"strategy":null,"strategy":'),JSON.stringify(parsed,null,2)]){
    const storage=new Map(original.storage);storage.set(key,changed);
    const app=harness({savedStorage:storage});await settle();
    assert.equal(vm.runInContext('pendingResearchInvalid',app.context),true);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});await app.submit('backtest');
      assert.equal(app.storage.get(key),changed);assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
      assert.equal(app.ids.get('research-request-status').hidden,false);
    }
    assert.equal(app.proofs(),0);
  }
});
test('real shipped Quant HTTP deadline covers non-cooperative response and body without replaying a write',async()=>{
  const app=harness();await settle();const transport=vm.runInContext('quantHTTP',app.context);
  for(const stage of ['response','body']){
    const timers=new Map();let calls=0,settled=false;const never=new Promise(()=>{});
    const options={fetchImpl:async(_path,options)=>{calls++;assert.equal(options.method,'POST');assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');return stage==='response'?never:{headers:new Headers({'content-type':'application/json'}),text:()=>never}},setTimer:(fn,ms)=>{timers.set(1,{fn,ms});return 1},clearTimer:id=>timers.delete(id)};
    const result=transport('/v1/backtests/from-market',{method:'POST',body:'{}'},options).catch(error=>{settled=true;return error});await settle();assert.equal(timers.get(1).ms,30000);timers.get(1).fn();await settle();
    assert.equal(settled,true);assert.equal((await result).code,'QUANT_API_TIMEOUT');assert.equal(calls,1);assert.equal(timers.size,0);
  }
  for(const response of [new Response('<html>fallback</html>',{headers:{'content-type':'text/html'}}),new Response('{invalid',{headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'999999999'}})]){
    await assert.rejects(transport('/v1/snapshot',{}, {fetchImpl:async()=>response}),{code:'QUANT_API_RESPONSE_INVALID'});
  }
});

test('shipped Quant HTTP streams fragmented UTF8 and cancels oversized bodies before reading the remainder',async()=>{
  const app=harness();await settle();const transport=vm.runInContext('quantHTTP',app.context),limit=8*1024*1024;
  const raw=new TextEncoder().encode(JSON.stringify({label:'日本語 العربية 😀',amount:0}));let index=0;
  const response=new Response(new ReadableStream({pull(controller){if(index===raw.length)controller.close();else controller.enqueue(raw.slice(index,index+=1));}},{highWaterMark:0}),{headers:{'content-type':'application/json'}});
  const valid=await transport('/v1/snapshot',{}, {fetchImpl:async()=>response});assert.equal(valid.body.label,'日本語 العربية 😀');assert.equal(valid.body.amount,0);
  let pulls=0,cancels=0,calls=0;
  const oversized=new Response(new ReadableStream({pull(controller){pulls++;controller.enqueue(new Uint8Array(1024*1024).fill(32));},cancel(){cancels++;}},{highWaterMark:0}),{headers:{'content-type':'application/json'}});
  await assert.rejects(transport('/v1/backtests/from-market',{method:'POST',body:'{}'},{fetchImpl:async()=>{calls++;return oversized}}),{code:'QUANT_API_RESPONSE_INVALID'});
  assert.equal(pulls,9);assert.equal(cancels,1);assert.equal(calls,1);
  const exact=await transport('/v1/snapshot',{}, {fetchImpl:async()=>new Response('"'+'a'.repeat(limit-2)+'"',{headers:{'content-type':'application/json'}})});
  assert.equal(exact.body.length,limit-2);
  await assert.rejects(transport('/v1/snapshot',{}, {fetchImpl:async()=>new Response(new Uint8Array([123,34,120,34,58,34,255,34,125]),{headers:{'content-type':'application/json'}})}),{code:'QUANT_API_RESPONSE_INVALID'});
});

test('Quant HTTP rejects duplicate or overnested financial documents without choosing a final value or retrying',async()=>{
  const app=harness();await settle();const transport=vm.runInContext('quantHTTP',app.context);
  for(const raw of ['{"paper":{"Cash":1,"Cash":999999}}','{"access":{"statefulPreview":false,"statefulPreview":true}}','{"metrics":{"ReturnBPS":-9000,"Return\\u0042PS":9000}}','{"orders":[{"IdempotencyKey":"old","IdempotencyKey":"new"}]}','['.repeat(66)+'0'+']'.repeat(66)]){
    let requests=0;
    await assert.rejects(transport('/v1/backtests/from-market',{method:'POST',body:'retained-exact-intent'},{fetchImpl:async()=>{requests++;return new Response(raw,{headers:{'content-type':'application/json'}})}}),{code:'QUANT_API_RESPONSE_INVALID'});
    assert.equal(requests,1);assert.equal(app.proofs(),0);
  }
  const raw='{"rows":[{"id":"one","label":"quote: \\\" and brackets [] {}"},{"id":"two"}],"empty":{},"negative":-2,"unicode":"測試"}';
  const result=await transport('/v1/snapshot',{}, {fetchImpl:async()=>new Response(raw,{headers:{'content-type':'application/json'}})});
  assert.equal(JSON.stringify(result.body),JSON.stringify(JSON.parse(raw)));
});

test('invalid response length declarations cancel before a body read and never replay a research request',async()=>{
  const app=harness();await settle();const transport=vm.runInContext('quantHTTP',app.context);
  for(const length of ['-1','1.5','1e3','NaN','Infinity','9007199254740993','8388609']){
    let pulls=0,cancels=0,calls=0;
    const body=new ReadableStream({pull(controller){pulls++;controller.enqueue(new TextEncoder().encode('{}'))},cancel(){cancels++}},{highWaterMark:0});
    const response=new Response(body,{headers:{'content-type':'application/json','content-length':length}});
    await assert.rejects(transport('/v1/backtests/from-market',{method:'POST',body:'exact-original-request'},{fetchImpl:async()=>{calls++;return response}}),{code:'QUANT_API_RESPONSE_INVALID'});
    assert.equal(pulls,0,length);assert.equal(cancels,1,length);assert.equal(calls,1,length);
  }
  for(const length of [null,'2','0002']){
    const headers={'content-type':'application/json'};if(length!==null)headers['content-length']=length;
    assert.deepEqual(JSON.parse(JSON.stringify((await transport('/v1/snapshot',{}, {fetchImpl:async()=>new Response('{}',{headers})})).body)),{});
  }
});

test('actual stream stalled body is cancelled at deadline with one request and no unbounded read',async()=>{
  const app=harness();await settle();const transport=vm.runInContext('quantHTTP',app.context),timers=new Map();let calls=0,cancels=0;
  const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancels++;}});
  const response=new Response(body,{headers:{'content-type':'application/json'}});
  const result=transport('/v1/backtests/from-market',{method:'POST',body:'{}'},{fetchImpl:async()=>{calls++;return response},setTimer:fn=>{timers.set(1,fn);return 1},clearTimer:id=>timers.delete(id)}).catch(error=>error);
  await settle();timers.get(1)();assert.equal((await result).code,'QUANT_API_TIMEOUT');await settle();
  assert.equal(calls,1);assert.equal(cancels,1);assert.equal(timers.size,0);
});

test('reconciliation previews exact amounts in every language and cancellation writes nothing',async()=>{
  let message='';const app=harness({snapshot:{paper:{Cash:777,Position:-2,KillSwitch:false}},confirmAction:value=>{message=value;return false}});await settle();
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});await app.ids.get('reconcile').onclick();
    assert.ok(message.startsWith(vm.runInContext('t("confirmReconciliation")',app.context)));
    assert.ok(message.includes(': 777'));assert.ok(message.includes(': -2'));
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
});
test('reconciliation refuses state or authority changes during confirmation and binds accepted exact body',async()=>{
  for(const mutation of ['snapshot.paper.Cash=778','snapshot.paper.Position=3','snapshotRevision++','workspaceReadUnavailable=true','statefulPreview=false','riskWrites.add("kill")']){
    const app=harness({snapshot:{paper:{Cash:777,Position:2,KillSwitch:false}}});await settle();
    app.context.confirm=()=>{vm.runInContext(mutation,app.context);return true};await app.ids.get('reconcile').onclick();
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
    if(mutation.includes('riskWrites'))assert.equal(vm.runInContext('riskWrites.has("kill")',app.context),true);
  }
  const receipt={Cash:777,Position:2,KillSwitch:false,ReconciliationDelta:0};
  const app=harness({snapshot:{paper:receipt},confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{paper:receipt}:receipt});await settle();await app.ids.get('reconcile').onclick();
  assert.deepEqual(JSON.parse(app.calls.find(call=>call.options.method==='POST').options.body),{Cash:777,Position:2});
});
test('kill confirmation cannot regain retired workspace access or cross an admitted risk lane',async()=>{
  for(const mutation of ['statefulPreview=false','riskWrites.add("reconcile")','riskWrites.add("kill")']){
    const app=harness({snapshot:{paper:{Cash:777,Position:2,KillSwitch:false}}});await settle();
    const revision=vm.runInContext('snapshotRevision',app.context);
    app.context.confirm=()=>{vm.runInContext(mutation,app.context);return true};
    await app.ids.get('kill').onclick();
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
    assert.equal(app.proofs(),0);assert.equal(vm.runInContext('snapshotRevision',app.context),revision);
    assert.equal(vm.runInContext('snapshot.paper.KillSwitch',app.context),false);
    assert.equal(app.ids.get('kill').disabled,true);
    assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("riskReceiptUnconfirmed")',app.context));
    if(mutation.includes('riskWrites'))assert.equal(vm.runInContext('riskWrites.size',app.context),1);
  }
  const app=harness({confirmAction:()=>false});await settle();
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});await app.ids.get('kill').onclick();
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
});
test('risk outcomes use confirmed zero or exact nonzero receipts without false zero-difference claims',async()=>{
  for(const delta of [0,1,Number.MAX_SAFE_INTEGER]){
    const receipt={Cash:1000,Position:0,ReconciliationDelta:delta,KillSwitch:delta!==0};
    const app=harness({snapshot:{paper:receipt},confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},paper:receipt}:receipt});await settle();
    await app.ids.get('reconcile').onclick();const message=app.ids.get('toast').textContent;
    if(delta===0)assert.match(message,/zero difference/);else{assert.doesNotMatch(message,/zero difference/);assert.match(message,new RegExp(': '+delta+'$'));assert.match(message,/kill switch is active/);app.ids.get('locale').onchange({target:{value:'ar'}});assert.match(app.ids.get('toast').textContent,new RegExp(': '+delta+'$'))}
    assert.equal(app.ids.get('reconcile').disabled,false);assert.equal(app.proofs(),0);
  }
});

test('risk receipt mismatch is unconfirmed and pending operations coalesce without duplicate confirmations',async()=>{
  for(const id of ['reconcile','kill']){
    let confirmations=0;const pending=deferred(),receipt={Cash:1000,Position:0,ReconciliationDelta:0,KillSwitch:id==='kill'};
    const app=harness({snapshot:{paper:receipt},confirmAction:()=>{confirmations++;return true},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},paper:receipt}:pending.promise});await settle();
    const first=app.ids.get(id).onclick();await app.ids.get(id).onclick();assert.equal(app.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(confirmations,1);assert.equal(app.ids.get(id).disabled,true);
    app.ids.get('locale').onchange({target:{value:'ar'}});assert.equal(app.ids.get(id).disabled,true);assert.equal(app.ids.get(id).ariaBusy,'true');pending.resolve(receipt);await first;assert.equal(app.ids.get(id).ariaBusy,'false');
  }
  for(const receipt of [{},{Cash:0,Position:0,ReconciliationDelta:1,KillSwitch:false},{Cash:0,Position:0,ReconciliationDelta:Number.MAX_SAFE_INTEGER+1,KillSwitch:true},{Cash:0,Position:0,ReconciliationDelta:0,KillSwitch:false}]){
    const app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},paper:{}}:receipt});await settle();await app.ids.get('kill').onclick();assert.match(app.ids.get('toast').textContent,/unconfirmed/);assert.doesNotMatch(app.ids.get('toast').textContent,/Kill switch active/);assert.equal(app.ids.get('kill').disabled,false);
  }
});

test('confirmed risk receipt survives failed follow-up read and late pre-write snapshot',async()=>{
  for(const id of ['kill','reconcile']){
    const old=deferred();let reads=0;
    const before={Cash:1000,Position:0,ReconciliationDelta:0,KillSwitch:false};
    const confirmed={Cash:950,Position:2,ReconciliationDelta:id==='kill'?0:50,KillSwitch:true};
    const app=harness({confirmAction:()=>true,apiResponse:url=>{
      if(!url.endsWith('/snapshot'))return confirmed;
      if(++reads===1)return {access:{statefulPreview:true},paper:before};
      if(reads===2)return old.promise;
      throw Error('Controlled follow-up network loss');
    }});await settle();
    const stale=vm.runInContext('refresh()',app.context);
    await app.ids.get(id).onclick();
    assert.equal(vm.runInContext('snapshot.paper.KillSwitch',app.context),true,'confirmed receipt is retained even when follow-up snapshot fails');
    assert.equal(vm.runInContext('snapshot.paper.Cash',app.context),950);
    old.resolve({access:{statefulPreview:true},paper:before});await stale;
    assert.equal(vm.runInContext('snapshot.paper.KillSwitch',app.context),true,'old pre-write read cannot re-arm displayed risk');
    assert.equal(vm.runInContext('snapshot.paper.ReconciliationDelta',app.context),confirmed.ReconciliationDelta);
    assert.equal(app.calls.filter(c=>c.options.method==='POST').length,1);
    assert.equal(app.proofs(),0);
  }
});

test('reconcile and kill share one pending risk lane so late receipts cannot cross another write',async()=>{
  for(const firstId of ['kill','reconcile']){
    const pending=deferred();let confirmations=0;
    const receipt={Cash:1000,Position:0,ReconciliationDelta:0,KillSwitch:true};
    const app=harness({confirmAction:()=>{confirmations++;return true},apiResponse:url=>url.endsWith('/snapshot')?{paper:receipt}:pending.promise});await settle();
    const first=app.ids.get(firstId).onclick();
    assert.equal(app.ids.get('kill').disabled,true);assert.equal(app.ids.get('reconcile').disabled,true);
    await app.ids.get(firstId==='kill'?'reconcile':'kill').onclick();
    assert.equal(app.calls.filter(c=>c.options.method==='POST').length,1);
    assert.equal(confirmations,1);
    pending.resolve(receipt);await first;
    assert.equal(app.ids.get('kill').disabled,false);assert.equal(app.ids.get('reconcile').disabled,false);
  }
});

test('pending or unconfirmed risk writes fence Paper until a post-write valid risk read',{timeout:3000},async()=>{
  for(const id of ['kill','reconcile']){
    const pending=deferred(),hash='e'.repeat(64),before={Cash:1000,Position:0,ReconciliationDelta:0,KillSwitch:false};
    let next={paper:before,strategies:{saved:{Name:'Controlled Paper',StrategyHash:hash}}},confirmations=0;
    const app=harness({confirmAction:()=>{confirmations++;return true},apiResponse:url=>url.endsWith('/snapshot')?next:pending.promise});await settle();
    app.ids.get('paper-strategy').value=hash;app.ids.get('paper-strategy').onchange();app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';
    assert.equal(app.ids.get('paper-submit').disabled,false);
    const risk=app.ids.get(id).onclick();await settle();
    assert.equal(app.ids.get('paper-submit').disabled,true,'admitted risk operation fences Paper immediately');
    await app.submit('paper-order');assert.equal(confirmations,1);assert.equal(app.calls.filter(c=>c.url.endsWith('/paper/orders')).length,0);
    await vm.runInContext('refresh()',app.context);assert.equal(app.ids.get('paper-submit').disabled,true,'read during pending risk cannot rearm Paper');
    pending.reject(Error('Controlled lost risk response'));await risk;
    assert.equal(app.ids.get('reconcile').disabled,true);await app.ids.get('reconcile').onclick();
    assert.equal(app.calls.filter(c=>c.options.method==='POST').length,1,'unknown reconciliation cannot reuse stale amounts');
    for(const language of vm.runInContext('supportedLocales',app.context)){
      app.ids.get('locale').onchange({target:{value:language}});await app.submit('paper-order');
      assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(app.ids.get('workspace-read-status').hidden,false);
      assert.equal(app.ids.get('workspace-read-status').textContent,vm.runInContext('t("riskReceiptUnconfirmed")',app.context));
    }
    next={paper:{KillSwitch:false},strategies:next.strategies};
    await assert.rejects(vm.runInContext('refresh()',app.context));assert.equal(app.ids.get('paper-submit').disabled,true,'incomplete snapshot cannot resolve unknown risk');
    next={paper:{...before,KillSwitch:true},strategies:next.strategies};await vm.runInContext('refresh()',app.context);
    assert.equal(app.ids.get('workspace-read-status').hidden,true);assert.equal(app.ids.get('paper-submit').disabled,true,'confirmed kill still fences new intent');
    assert.equal(app.calls.filter(c=>c.url.endsWith('/paper/orders')).length,0);assert.equal(app.proofs(),0);
    // A valid non-killed read can re-enable Paper, but never submits it.
    next={paper:before,strategies:next.strategies};await vm.runInContext('refresh()',app.context);
    assert.equal(app.ids.get('paper-submit').disabled,false);assert.equal(app.calls.filter(c=>c.options.method==='POST').length,1);
  }
});

test('snapshot admitted during a lost risk write cannot resolve its outcome on late arrival',async()=>{
  const write=deferred(),read=deferred();let reads=0;
  const paper={Cash:1000,Position:0,ReconciliationDelta:0,KillSwitch:false};
  const app=harness({confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?++reads===1?{paper}:read.promise:write.promise});await settle();
  const kill=app.ids.get('kill').onclick(),late=vm.runInContext('refresh()',app.context);
  write.reject(Error('Controlled lost response'));await kill;
  read.resolve({paper});await late;
  assert.equal(vm.runInContext('riskOutcomeUnconfirmed',app.context),true);
  assert.equal(vm.runInContext('paperFreshIntentBlockKey()',app.context),'riskReceiptUnconfirmed');
  assert.equal(app.calls.filter(c=>c.options.method==='POST').length,1);
});

test('confirmed kill blocks fresh Paper intents before confirmation and survives selection changes',async()=>{
  const strategyHash='e'.repeat(64),app=harness({snapshot:{paper:{KillSwitch:true},strategies:{saved:{Name:'Stopped Paper fixture',StrategyHash:strategyHash}}},confirmAction:()=>{throw Error('kill must block before confirmation')}});await settle();
  app.ids.get('paper-strategy').value=strategyHash;app.ids.get('paper-strategy').onchange();
  assert.equal(app.ids.get('paper-submit').disabled,true);
  app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});await app.submit('paper-order');
    assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("killActive")',app.context));
    assert.equal(app.ids.get('paper-submit').disabled,true);
  }
  assert.equal(app.calls.filter(c=>c.url.endsWith('/paper/orders')).length,0);
  assert.equal([...app.storage.keys()].some(k=>k.startsWith('ynx.quant.paper.pending.v1:')),false);
});

test('kill arriving during Paper confirmation prevents creating a new request',async()=>{
  const strategyHash='e'.repeat(64),app=harness({snapshot:{paper:{KillSwitch:false},strategies:{saved:{StrategyHash:strategyHash}}}});await settle();
  app.ids.get('paper-strategy').value=strategyHash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';
  app.context.confirm=()=>{vm.runInContext('snapshot.paper.KillSwitch=true',app.context);return true};
  await app.submit('paper-order');
  assert.equal(app.calls.filter(c=>c.url.endsWith('/paper/orders')).length,0);
  assert.equal(app.ids.get('paper-submit').disabled,true);
});

test('kill preserves an uncertain intent and permits only its confirmed same-key receipt recovery',async()=>{
  const strategyHash='e'.repeat(64),workspace={paper:{KillSwitch:false},strategies:{saved:{Name:'Saved fixture',StrategyHash:strategyHash}}};
  const app=harness({snapshot:workspace,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?workspace:Promise.reject(Error('Controlled lost response'))});await settle();
  app.ids.get('paper-strategy').value=strategyHash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';await app.submit('paper-order');
  const original=JSON.parse(app.calls.find(c=>c.url.endsWith('/paper/orders')).options.body);
  const key=[...app.storage.keys()].find(k=>k.startsWith('ynx.quant.paper.pending.v1:')),raw=app.storage.get(key);
  const killed={...workspace,paper:{KillSwitch:true}},replay=harness({snapshot:killed,savedStorage:app.storage,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?killed:{...paperRecord({Status:'filled',Filled:100,Amount:100}),...original}});await settle();
  assert.equal(replay.storage.get(key),raw);assert.equal(replay.ids.get('paper-submit').disabled,false);
  await replay.submit('paper-order');
  assert.deepEqual(JSON.parse(replay.calls.find(c=>c.url.endsWith('/paper/orders')).options.body),original);
  assert.equal(replay.storage.has(key),false);assert.equal(replay.ids.get('paper-submit').disabled,true);
  await replay.submit('paper-order');assert.equal(replay.calls.filter(c=>c.url.endsWith('/paper/orders')).length,1);
});

test('public stateless research renders measured equity without granting Paper or saved strategy authority', async () => {
  const experiment = researchFixture('public-test-result','Explicit synthetic UI fixture');
  const app = harness({apiResponse: async url => {
    if (url.endsWith('/snapshot')) return {access:{statefulPreview:false},strategies:{},experiments:{},paper:{},audit:[]};
    assert.equal(url,'/api/v1/public/research/backtests/from-market');
    return experiment;
  }});
  await settle();
  assert.equal(app.ids.get('workspace-boundary').hidden,false);
  assert.equal(app.ids.get('kill').disabled,true);
  await app.submit('backtest');
  assert.equal(app.ids.get('result-sharpe').textContent,'1.500');
  assert.equal(app.ids.get('equity-figure').hidden,false);
  assert.match(app.ids.get('equity-chart').innerHTML,/polyline/);
  assert.equal(app.ids.get('paper-submit').disabled,true);
  const before=app.calls.length;
  await app.submit('paper-order');
  assert.equal(app.calls.length,before);
  assert.match(app.ids.get('strategy-rows').innerHTML,/No strategies/);
});

test('invalid research acknowledgements cannot replace a verified result or report completion', async () => {
  let response=researchFixture('verified-before');
  const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:response});await settle();await app.submit('backtest');
  for(const invalid of [null,{}, {...response,id:''},{...response,strategy:{Name:''}},{...response,metrics:{}},{...response,metrics:{...response.metrics,ReturnBPS:Number.MAX_SAFE_INTEGER+1}},{...response,metrics:{...response.metrics,Trades:-1}}]){
    response=invalid;await app.submit('backtest');assert.match(app.ids.get('toast').textContent,/unconfirmed/);assert.equal(app.ids.get('result-return').textContent,'120 bps');assert.equal(app.ids.get('research-submit').disabled,false);
  }
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});await app.submit('backtest');assert.notEqual(app.ids.get('toast').textContent,'researchInvalid');assert.ok(app.ids.get('toast').textContent.length>20);
  }
});

test('negative measured strategy equity stays visible without changing its signed loss metrics',async()=>{
  const app=harness();await settle();const result=researchFixture('short-loss');
  result.metrics.ReturnBPS=-10100;result.metrics.MaxDrawdownBPS=10100;
  result.equityCurve[1].equity=-10;
  app.context.signedLoss=result;
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});
    vm.runInContext('renderResult(signedLoss,true)',app.context);
    assert.equal(app.ids.get('equity-figure').hidden,false);
    assert.match(app.ids.get('equity-chart').innerHTML,/equity-line/);
    assert.equal(app.ids.get('result-return').textContent,'-10100 bps');
    assert.equal(app.ids.get('result-drawdown').textContent,'10100 bps');
    assert.equal(vm.runInContext('latestResearchResult.equityCurve[1].equity',app.context),-10);
  }
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(app.proofs(),0);
});
test('malformed research curves are omitted without fabricating equity or losing valid metrics', async () => {
  for(const curve of [{length:2},[null,{}],[{equity:1,benchmarkEquity:1},{equity:Number.MAX_SAFE_INTEGER+1,benchmarkEquity:2}],[{equity:1,benchmarkEquity:1},{equity:-1,benchmarkEquity:2}],[],
    [{time:'2026-10-03T00:00:00Z',equity:1000,benchmarkEquity:1000},{time:'2026-10-03T00:01:00Z',equity:-10,benchmarkEquity:-1}],
    [{time:'2026-10-03T00:00:00Z',equity:1000,benchmarkEquity:1000},{time:'2026-10-03T00:01:00Z',equity:Number.MIN_SAFE_INTEGER-1,benchmarkEquity:1}]
  ]){
    const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:{...researchFixture('valid-metrics'),equityCurve:curve}});await settle();await app.submit('backtest');assert.equal(app.ids.get('equity-figure').hidden,true);assert.equal(app.ids.get('equity-chart').innerHTML,'');assert.equal(app.ids.get('result-return').textContent,'120 bps');assert.equal(app.ids.get('research-submit').disabled,false);
  }
});
test('research chart preserves real elapsed-time gaps and rejects missing or non-increasing observation times',async()=>{
  const result=researchFixture('timed-run');result.equityCurve=[
    {time:'2026-10-03T00:00:00Z',equity:1000,benchmarkEquity:1000},
    {time:'2026-10-03T00:01:00Z',equity:1010,benchmarkEquity:1004},
    {time:'2026-10-03T01:00:00Z',equity:1012,benchmarkEquity:1009}];
  let response=result;const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:response});await settle();await app.submit('backtest');
  assert.match(app.ids.get('equity-chart').innerHTML,/points="12\.00,[\d.]+ 23\.60,[\d.]+ 708\.00,[\d.]+"/);
  for(const times of [[undefined,'2026-10-03T00:01:00Z'],['invalid','2026-10-03T00:01:00Z'],['2026-10-03T00:01:00Z','2026-10-03T00:01:00Z'],['2026-10-03T00:02:00Z','2026-10-03T00:01:00Z'],['2026-02-30T00:00:00Z','2026-03-03T00:00:00Z'],['2026-10-03T00:00:00','2026-10-03T00:01:00'],['10/03/2026','10/04/2026']]){
    response={...result,equityCurve:times.map((time,index)=>({...result.equityCurve[index],time}))};await app.submit('backtest');
    assert.equal(app.ids.get('equity-figure').hidden,true);assert.equal(app.ids.get('equity-chart').innerHTML,'');assert.equal(app.ids.get('result-return').textContent,'120 bps');
  }
});

test('research amounts preserve measured zero, currency and unavailable attribution without inventing costs', async () => {
  const valid={currency:'YUSD_TEST_MICRO',userNetPnl:-10,userRealizedPnl:0,userUnrealizedPnl:-10,tradingFee:2,slippage:1};
  for(const [attribution,expected] of [
    [undefined,['—','—','—','—','—']],
    [valid,['-10 YUSD_TEST_MICRO','0 YUSD_TEST_MICRO','-10 YUSD_TEST_MICRO','2 YUSD_TEST_MICRO','1 YUSD_TEST_MICRO']],
    [{...valid,currency:'USD'},['—','—','—','—','—']],
    [{...valid,userNetPnl:Number.MAX_SAFE_INTEGER+1,tradingFee:'<img src=x>',slippage:NaN},['—','0 YUSD_TEST_MICRO','-10 YUSD_TEST_MICRO','—','—']],
  ]){
    const experiment={...researchFixture('attribution-boundary'),attribution};
    const app=harness({snapshot:{experiments:{one:experiment}}});await settle();
    const cells=[...app.ids.get('experiment-rows').innerHTML.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
    assert.equal(cells.length,17);
    assert.deepEqual(cells.slice(11,16),expected,'exact existing five attribution columns precede the separate local read action');
    assert.doesNotMatch(app.ids.get('experiment-rows').innerHTML,/<img/);
  }
});

test('saved research history rejects malformed metrics without dropping valid rows or injecting HTML',async()=>{
  for(const invalid of [null,{}, {...researchFixture('missing'),metrics:{}},{...researchFixture('html'),metrics:{...researchFixture('base').metrics,ReturnBPS:'<img src=x onerror=alert(1)>'}},{...researchFixture('unsafe'),metrics:{...researchFixture('base').metrics,Trades:Number.MAX_SAFE_INTEGER+1}}]){
    const app=harness({snapshot:{experiments:{invalid,valid:researchFixture('verified','Verified history')}}});await settle();
    let rows=app.ids.get('experiment-rows').innerHTML;
    assert.match(rows,/Research result is unconfirmed/);assert.match(rows,/Verified history/);assert.match(rows,/120 bps/);assert.doesNotMatch(rows,/<img/);
    for(const language of vm.runInContext('supportedLocales',app.context)){
      app.ids.get('locale').onchange({target:{value:language}});rows=app.ids.get('experiment-rows').innerHTML;
      assert.ok(rows.includes(vm.runInContext(`businessCopy[${JSON.stringify(language)}].researchInvalid`,app.context)));assert.match(rows,/Verified history/);
    }
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);
  }
});
test('missing saved read timestamps remain explicitly unavailable without breaking valid research history',async()=>{
  for(const createdAt of [undefined,null,'invalid','<img src=x>',0]){
    const app=harness({snapshot:{experiments:{one:{...researchFixture('undated'),createdAt}}}});await settle();
    assert.match(app.ids.get('experiment-rows').innerHTML,/<td>—<\/td>/);assert.match(app.ids.get('experiment-rows').innerHTML,/undated/);assert.doesNotMatch(app.ids.get('experiment-rows').innerHTML,/<img/);
  }
});
test('unverified sensitivity values cannot become HTML or a fabricated numeric spread in saved history',async()=>{
  for(const sensitivitySpreadBPS of [undefined,-1,'<img src=x>',Number.MAX_SAFE_INTEGER+1]){
    const app=harness({snapshot:{experiments:{one:{...researchFixture('safe-history'),sensitivitySpreadBPS}}}});await settle();
    const cells=[...app.ids.get('experiment-rows').innerHTML.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(match=>match[1]);
    assert.equal(cells[9],'—');assert.doesNotMatch(app.ids.get('experiment-rows').innerHTML,/<img/);assert.match(app.ids.get('experiment-rows').innerHTML,/safe-history/);
  }
});
test('run details stay bound to the returned experiment through input edits and locale changes', async () => {
  const result={...researchFixture('reported-run'),strategy:{...researchFixture('base').strategy,Name:'Reported run',Seed:0,Source:'verified-index/<img src=x>',DataHash:'a'.repeat(64),StrategyHash:'b'.repeat(64)},assumptions:{FeeBPS:34,SlippageBPS:17,LatencyBars:1,ParticipationBPS:1000,TrainEnd:24,WalkForwardWindows:3,Seed:0},metricDefinitions:{sharpeMilli:'returned Sharpe definition <script>alert(1)</script>',volatilityBPS:'sample deviation; not annualized'}};
  const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:result});await settle();
  app.ids.get('fee').value='34';app.ids.get('slippage').value='17';app.ids.get('seed').value='0';await app.submit('backtest');
  assert.equal(app.ids.get('research-fee').textContent,'34');
  assert.equal(app.ids.get('research-slippage').textContent,'17');
  assert.equal(app.ids.get('research-seed').textContent,'0');
  assert.equal(app.ids.get('research-source').textContent,result.strategy.Source);
  assert.equal(app.ids.get('research-data-hash').textContent,'a'.repeat(64));
  assert.equal(app.ids.get('research-strategy-hash').textContent,'b'.repeat(64));
  assert.match(app.ids.get('research-source').innerHTML,/&lt;img/);
  const rows=app.ids.get('research-metric-definitions').children;
  assert.equal(rows.length,5);assert.equal(rows[0].children[1].textContent,'—');
  assert.equal(rows[3].children[1].textContent,result.metricDefinitions.sharpeMilli);
  assert.match(rows[3].children[1].innerHTML,/&lt;script/);
  app.ids.get('fee').value='900';app.ids.get('slippage').value='800';
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.equal(app.ids.get('research-fee').textContent,'34');
    assert.equal(app.ids.get('research-slippage').textContent,'17');
    assert.equal(app.ids.get('research-metric-definitions').children[3].children[1].textContent,result.metricDefinitions.sharpeMilli);
    if(language!=='en')assert.notEqual(app.ids.get('research-metric-definitions').children[0].children[0].textContent,'OOS return');
  }
  assert.equal(app.proofs(),0);assert.equal(app.calls.filter(call=>!call.url.endsWith('/snapshot')).length,1);
  const absent=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:{...researchFixture('absent-run-details'),strategy:{Name:'Absent run metadata'}}});await settle();await absent.submit('backtest');
  assert.equal(absent.ids.get('latest-result').hidden,true);assert.match(absent.ids.get('toast').textContent,/unconfirmed/);
  for(const id of ['source','data-hash','strategy-hash','fee','slippage','latency','participation','training','windows','seed'])assert.equal(absent.ids.get('research-'+id).textContent,'—');
});

test('early public research stays temporary beside saved history after the initial workspace arrives', async () => {
  const initialSnapshot = deferred(), research = deferred(); let snapshots = 0;
  const publicResult = researchFixture('same-result-id', 'Public unsaved fixture');
  const savedResult = researchFixture('same-result-id', 'Saved workspace fixture');
  const savedStrategy = {ID:'saved-strategy', Name:'Only saved strategy', StrategyHash:'d'.repeat(64)};
  const workspace = {access:{statefulPreview:true}, strategies:{saved:savedStrategy}, experiments:{saved:savedResult}, paper:{}, audit:[]};
  const app = harness({apiResponse: url => {
    if (url.endsWith('/snapshot')) return ++snapshots === 1 ? initialSnapshot.promise : workspace;
    assert.equal(url, '/api/v1/public/research/backtests/from-market');
    return research.promise;
  }});
  app.ids.get('strategy').value=publicResult.strategy.Name;
  const submitted = app.submit('backtest');
  initialSnapshot.resolve(workspace); await settle();
  research.resolve(publicResult); await submitted;
  assert.equal(snapshots, 1, 'a public result must not take the saved-workspace completion branch');
  assert.match(app.ids.get('toast').textContent, /not saved or audited/);
    assert.match(researchStatus(app), /not saved or audited/);
  const rows = app.ids.get('experiment-rows').innerHTML;
  assert.equal((rows.match(/<tr>/g) || []).length, 2, 'same IDs cannot let public results replace saved results');
  assert.match(rows, /Saved workspace fixture<\/td>/);
  assert.match(rows, /Public unsaved fixture<small>Temporary result/);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(snapshot.experiments)', app.context)), workspace.experiments);
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(snapshot.strategies)', app.context)), workspace.strategies);
  assert.deepEqual(app.ids.get('paper-strategy').children.map(option => option.value), ['', savedStrategy.StrategyHash]);
  assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML, /Public unsaved fixture/);
  await app.ids.get('refresh').onclick();
  assert.match(app.ids.get('experiment-rows').innerHTML, /Public unsaved fixture/);
  assert.match(researchStatus(app), /not saved or audited/);
  app.ids.get('locale').onchange({target:{value:'zh-CN'}});
  assert.match(researchStatus(app), /未保存、未审计/);
  assert.match(app.ids.get('experiment-rows').innerHTML, /未保存、未审计/);
  const reloaded = harness({snapshot:workspace, savedStorage:app.storage}); await settle();
  assert.doesNotMatch(reloaded.ids.get('experiment-rows').innerHTML, /Public unsaved fixture/);
  assert.match(reloaded.ids.get('experiment-rows').innerHTML, /Saved workspace fixture/);
  assert.equal(reloaded.ids.get('latest-result').hidden, true);
  assert.equal(vm.runInContext('Object.keys(publicExperiments).length', reloaded.context), 0);
  assert.equal(app.proofs(), 0);
});

test('research completion keeps its submitted mode for stable public, stable saved and changed access', async () => {
  for (const [startedSaved, finishedSaved] of [[false,false], [true,true], [true,false]]) {
    const result = researchFixture('mode-fixture'), research = deferred(); let completed = false, snapshots = 0;
    const app = harness({apiResponse: url => {
      if (url.endsWith('/snapshot')) {
        const saved = ++snapshots === 1 ? startedSaved : finishedSaved;
        return {access:{statefulPreview:saved}, strategies:{}, experiments:saved && completed ? {saved:result} : {}};
      }
      assert.equal(url, startedSaved ? '/api/v1/backtests/from-market' : '/api/v1/public/research/backtests/from-market');
      return research.promise;
    }});
    await settle();
    const submitted = app.submit('backtest');
    if (startedSaved !== finishedSaved) await app.ids.get('refresh').onclick();
    completed = true; research.resolve(result); await submitted;
    const key = startedSaved ? 'researchSaved' : 'researchTemporary';
    const copy = vm.runInContext(`businessCopy.en.${key}`, app.context);
    assert.equal(app.ids.get('toast').textContent, copy);
    assert.equal(researchStatus(app), copy);
    assert.equal(vm.runInContext('Object.keys(publicExperiments).length', app.context), startedSaved ? 0 : 1);
    assert.equal(vm.runInContext('Object.keys(snapshot.experiments).length', app.context), startedSaved && finishedSaved ? 1 : 0);
    assert.equal(snapshots, !startedSaved ? 1 : finishedSaved ? 2 : 3);
  }
});

test('temporary research provenance stays visible in all supported languages after rendering and refresh', async () => {
  const result = researchFixture('localized-public-result');
  const app = harness({apiResponse: url => url.endsWith('/snapshot') ? {access:{statefulPreview:false}, experiments:{}, strategies:{}} : result});
  await settle(); await app.submit('backtest');
  for (const language of vm.runInContext('supportedLocales', app.context)) {
    app.ids.get('locale').onchange({target:{value:language}});
    await app.ids.get('refresh').onclick();
    const copy = vm.runInContext(`businessCopy[${JSON.stringify(language)}].researchTemporary`, app.context);
    assert.ok(copy);
    assert.equal(researchStatus(app), copy);
    assert.ok(app.ids.get('experiment-rows').innerHTML.includes(copy));
    assert.equal(vm.runInContext('Object.keys(snapshot.experiments).length', app.context), 0);
  }
});

test('workspace malformed or failed refresh preserves confirmed readback with a persistent localized warning and recovers explicitly',async()=>{
  let next={paper:{Cash:777,Position:0,KillSwitch:true},strategies:{},experiments:{},audit:[]};
  const app=harness({rawSnapshot:true,apiResponse:()=>{if(next instanceof Error)throw next;return next;}});await settle();
  for(const invalid of [null,[], 'not a snapshot',42,{paper:[]}, {strategies:[]},
    {paper:{Cash:999,Position:0,KillSwitch:false},strategies:{},experiments:{},audit:[],failure:{code:'state_refresh_failed',message:'authoritative state is temporarily unavailable'}},
    {paper:{Cash:999,Position:0,KillSwitch:false},strategies:{},experiments:{},audit:[],sourceMetadata:{status:'unavailable'}},new Error('offline')]){
    next=invalid;await app.ids.get('refresh').onclick();
    assert.match(app.ids.get('paper-state').innerHTML,/777/);
    assert.equal(vm.runInContext('snapshot.paper.KillSwitch',app.context),true);
    assert.equal(app.ids.get('workspace-read-status').hidden,false);
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});
      assert.equal(app.ids.get('workspace-read-status').textContent,vm.runInContext('t("workspaceReadUnavailable")',app.context));
    }
  }
  next={paper:{Cash:888,Position:0,KillSwitch:true},strategies:{},experiments:{},audit:[]};
  await app.ids.get('refresh').onclick();assert.match(app.ids.get('paper-state').innerHTML,/888/);
  assert.equal(app.ids.get('workspace-read-status').hidden,true);
  assert.equal(app.calls.filter(call=>call.options.method==='POST'||call.options.method==='PUT').length,0);
});
test('failed workspace refresh blocks fresh Paper intent before confirmation and recovers without clearing authority or records',async()=>{
  for(const mode of ['transport','failure','source-unavailable']){
  const hash='e'.repeat(64),workspace={paper:{Cash:777,Position:0,KillSwitch:false},strategies:{saved:{Name:'Saved fixture',StrategyHash:hash}}};
  let unavailable=false,confirmations=0;
  const app=harness({confirmAction:()=>{confirmations++;return true},apiResponse:url=>{assert.ok(url.endsWith('/snapshot'));if(unavailable){if(mode==='transport')throw Error('offline');return {...workspace,failure:mode==='failure'?{code:'state_refresh_failed'}:null,sourceMetadata:mode==='source-unavailable'?{status:'unavailable'}:undefined}}return workspace}});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('paper-strategy').onchange();app.ids.get('paper-amount').value='100';app.ids.get('side').value='buy';
  assert.equal(app.ids.get('paper-submit').disabled,false);
  unavailable=true;await app.ids.get('refresh').onclick();
  assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(vm.runInContext('statefulPreview',app.context),true);
  assert.equal(app.ids.get('reconcile').disabled,true);assert.equal(app.ids.get('kill').disabled,false);
  await app.ids.get('reconcile').onclick();
  assert.equal(vm.runInContext('snapshot.paper.Cash',app.context),777);
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    await app.ids.get('paper-order').onsubmit({preventDefault(){}});
    assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("workspaceReadUnavailable")',app.context));
    assert.equal(app.ids.get('paper-submit').disabled,true);
    assert.equal(app.ids.get('paper-strategy-status').textContent,vm.runInContext('t("workspaceReadUnavailable")',app.context));
  }
  assert.equal(confirmations,0);assert.equal(app.calls.filter(c=>c.options.method==='POST').length,0);
  unavailable=false;await app.ids.get('refresh').onclick();
  assert.equal(app.ids.get('workspace-read-status').hidden,true);assert.equal(app.ids.get('paper-submit').disabled,false);
  assert.equal(app.ids.get('reconcile').disabled,false);
  assert.equal(app.ids.get('paper-strategy-status').textContent,'');
  }
});

test('Paper availability explains exact risk or recovery fence without inventing an active kill switch',async()=>{
  const hash='e'.repeat(64),workspace={paper:{Cash:777,Position:0,KillSwitch:false},strategies:{saved:{Name:'Saved fixture',StrategyHash:hash}}};
  for(const [mutation,key] of [['riskOutcomeUnconfirmed=true','riskReceiptUnconfirmed'],['riskWrites.add("reconcile")','riskReceiptUnconfirmed'],['pendingPaperInvalid=true','paperPendingUnreadable'],['snapshot.paper.KillSwitch=true','killActive']]){
    const app=harness({snapshot:workspace});await settle();
    vm.runInContext(mutation+';renderPaperSubmitControl()',app.context);
    for(const language of vm.runInContext('supportedLocales',app.context)){
      app.ids.get('locale').onchange({target:{value:language}});
      assert.equal(app.ids.get('paper-strategy-status').textContent,vm.runInContext(`t(${JSON.stringify(key)})`,app.context));
      assert.equal(app.ids.get('paper-submit').disabled,true);
      if(key!=='killActive')assert.equal(vm.runInContext('snapshot.paper.KillSwitch',app.context),false);
    }
    assert.equal(app.calls.filter(call=>call.options.method==='POST'||call.options.method==='PUT').length,0);assert.equal(app.proofs(),0);
  }
});

test('unknown exact Paper replay remains available during failed workspace reads without enabling fresh intent',async()=>{
  const hash='e'.repeat(64),workspace={paper:{KillSwitch:false},strategies:{saved:{Name:'Saved fixture',StrategyHash:hash}}};
  let unavailable=false,posts=0,original;
  const app=harness({confirmAction:()=>true,apiResponse:(url,options)=>{
    if(url.endsWith('/snapshot')){if(unavailable)throw Error('offline');return workspace}
    assert.ok(url.endsWith('/paper/orders'));const submitted=JSON.parse(options.body);posts++;
    if(posts===1){original=submitted;throw Error('lost receipt')}
    assert.deepEqual(submitted,original);return {...paperRecord({Status:'filled',Filled:100,Amount:100}),...submitted};
  }});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('paper-strategy').onchange();app.ids.get('paper-amount').value='100';app.ids.get('side').value='buy';
  await app.ids.get('paper-order').onsubmit({preventDefault(){}});
  unavailable=true;await app.ids.get('refresh').onclick();
  assert.equal(app.ids.get('paper-submit').disabled,false);
  await app.ids.get('paper-order').onsubmit({preventDefault(){}});
  assert.equal(posts,2);assert.equal(vm.runInContext('pendingPaperIntent',app.context),null);
  assert.equal(app.ids.get('paper-submit').disabled,true);
  await app.ids.get('paper-order').onsubmit({preventDefault(){}});assert.equal(posts,2);
});

test('retired workspace read failure cannot mark a newer successful snapshot unavailable',async()=>{
  const old=deferred();let reads=0;
  const app=harness({rawSnapshot:true,apiResponse:()=>++reads===2?old.promise:{paper:{Cash:reads,KillSwitch:true}}});await settle();
  const first=app.ids.get('refresh').onclick();await settle();await app.ids.get('refresh').onclick();
  old.reject(Error('retired read'));await first;
  assert.equal(vm.runInContext('snapshot.paper.Cash',app.context),3);
  assert.equal(app.ids.get('workspace-read-status').hidden,true);
});
test('late workspace snapshots cannot replace a newer confirmed risk state', async () => {
  const stale = deferred(); let snapshots = 0;
  const app = harness({apiResponse: url => {
    assert.ok(url.endsWith('/snapshot'));
    if (++snapshots === 2) return stale.promise;
    return {paper: {KillSwitch: snapshots > 2}, strategies: {}, audit: []};
  }});
  await settle();
  const oldRefresh = app.ids.get('refresh').onclick();
  await settle();
  await app.ids.get('refresh').onclick();
  assert.match(app.ids.get('paper-state').innerHTML, /ACTIVE/);
  stale.resolve({paper: {KillSwitch: false}, strategies: {}, audit: []});
  await oldRefresh;
  assert.match(app.ids.get('paper-state').innerHTML, /ACTIVE/);
  assert.equal(snapshots, 3);
});

test('guest Paper has a separate persisted browser tenant and cannot submit an invented strategy hash', async () => {
  const app = harness(); await settle();
  assert.match(app.ids.get('wallet-portfolio-status').textContent, /Connect YNX Wallet or MetaMask/);
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '—');
  assert.equal(app.ids.get('paper-submit').disabled, true);
  await app.submit('paper-order');
  assert.equal(app.calls.length, 1);
  const tenant = app.calls[0].options.headers['x-ynx-tenant-id'];
  assert.match(tenant, /^[0-9a-f]{64}$/);
  app.wallet(connected(accountA)); await settle();
  app.wallet(connected(accountB)); await settle();
  assert.equal(app.storage.get('ynx.quant.tenant.v1'), tenant);
  assert.equal(app.proofs(), 0);
});

test('Paper confirmation binds exact inputs, discloses missing execution-cost model and cancellation writes nothing',async()=>{
  const hash='d'.repeat(64);let preview='',accept=false;
  const app=harness({snapshot:{strategies:{saved:{Name:'Saved',StrategyHash:hash}}},confirmAction:message=>{preview=message;return accept}});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='sell';app.ids.get('paper-amount').value='9007199254740991';
  await app.submit('paper-order');assert.match(preview,/Confirm.*Paper/);assert.match(preview,/YNXT-YUSD_TEST/);assert.ok(preview.includes(hash));assert.match(preview,/sell/);assert.match(preview,/9007199254740991/);assert.match(preview,/does not deduct commission\/gas or model slippage/);
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal([...app.storage.keys()].some(key=>key.startsWith('ynx.quant.paper.pending')),false);assert.equal(app.ids.get('paper-submit').disabled,false);
  for(const language of vm.runInContext('supportedLocales',app.context)){app.ids.get('locale').onchange({target:{value:language}});await app.submit('paper-order');assert.ok(preview.startsWith(vm.runInContext(`businessCopy[${JSON.stringify(language)}].paperConfirm`,app.context)))}
  accept=true;app.context.confirm=()=>{app.ids.get('paper-amount').value='100';return true};await app.submit('paper-order');assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal([...app.storage.keys()].some(key=>key.startsWith('ynx.quant.paper.pending')),false);
});

const paperCostsV1={Policy:'adverse_price_ceil_fee_micro_v1',FeeBPS:10,SlippageBPS:5};
const setPaperCosts = app => {app.ids.get('paper-cost-model').value='v1';app.ids.get('paper-cost-fee').value='10';app.ids.get('paper-cost-slippage').value='5';app.ids.get('paper-cost-model').emit('change');};
const costReceipt = request => ({...paperRecord({ID:'paper-000001',Price:1000000,Status:'filled',Filled:request.Amount}),StrategyHash:request.StrategyHash,Side:request.Side,Amount:request.Amount,IdempotencyKey:request.IdempotencyKey,CostPolicy:paperCostsV1.Policy,FeeBPS:10,SlippageBPS:5,ExecutionPriceMicro:1000500,ExecutedNotionalMicro:1000500,FeeMicro:1001});
test('Paper receipt cost disclosure is exact and localized, and legacy/invalid records never invent a model',async()=>{
  const valid=costReceipt({StrategyHash:'d'.repeat(64),Side:'buy',Amount:1000000,IdempotencyKey:'controlled-read-only-key'}),legacy=paperRecord({ID:'paper-legacy'});
  legacy.ID='paper-000009';const app=harness({snapshot:{paper:{Orders:[valid,legacy]}}});await settle();const before=app.calls.length;
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});const rendered=app.ids.get('paper-record-rows').innerHTML;
    assert.equal((rendered.match(/class="paper-cost-receipt"/g)||[]).length,1);
    for(const key of ['paperCostV1','paperCostFee','paperCostSlippage','paperCostLegacy'])assert.ok(rendered.includes(vm.runInContext(`safe(t(${JSON.stringify(key)}))`,app.context)));
    assert.ok(rendered.includes(': 10'));assert.ok(rendered.includes(': 5'));assert.equal(app.calls.length,before);assert.equal(app.proofs(),0);
  }
  for(const patch of [{FeeBPS:11},{CostPolicy:'unknown'},{FeeMicro:1}]){
    app.context.badRecord={...valid,...patch};vm.runInContext('renderPaperRecords({Orders:[badRecord]})',app.context);
    assert.doesNotMatch(app.ids.get('paper-record-rows').innerHTML,/paper-cost-receipt/);
  }
});
test('Paper cost model confirmation localizes, fences changes and invalid rates, and cancellation creates no intent',async()=>{
  let message='';const app=harness({snapshot:{strategies:{saved:savedResearchStrategy()}},confirmAction:preview=>{message=preview;return false}});await settle();
  app.ids.get('paper-strategy').value='d'.repeat(64);app.ids.get('side').value='buy';app.ids.get('paper-amount').value='1000000';setPaperCosts(app);
  for(const language of vm.runInContext('supportedLocales',app.context)){
    app.ids.get('locale').onchange({target:{value:language}});await app.submit('paper-order');
    assert.ok(message.includes(vm.runInContext('t("paperCostBoundary")',app.context)));assert.ok(message.includes(vm.runInContext('t("paperCostFee")',app.context)+': 10'));
    assert.equal(app.ids.get('paper-execution-boundary').textContent,vm.runInContext('t("paperCostBoundary")',app.context));
  }
  app.context.confirm=()=>{app.ids.get('paper-cost-fee').value='11';return true};await app.submit('paper-order');
  assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(vm.runInContext('pendingPaperIntent',app.context),null);
  for(const value of ['','1.5','-1','10001','9007199254740992']){app.ids.get('paper-cost-fee').value=value;await app.submit('paper-order');assert.equal(app.calls.filter(call=>call.options.method==='POST').length,0);}
});
test('Paper confirmed costs require exact mathematically consistent receipt before clearing the durable intent',async()=>{
  const snapshot={strategies:{saved:savedResearchStrategy()}};
  for(const change of [{}, {FeeMicro:1000}, {ExecutedNotionalMicro:1000501}, {ExecutionPriceMicro:1000501}, {FeeBPS:11}, {CostPolicy:'unknown'}, {FeeMicro:null}, {CostPolicy:undefined,FeeBPS:undefined,SlippageBPS:undefined,ExecutionPriceMicro:undefined,ExecutedNotionalMicro:undefined,FeeMicro:undefined}]){
    const app=harness({snapshot,confirmAction:()=>true,apiResponse:(url,options)=>url.endsWith('/snapshot')?snapshot:{...costReceipt(JSON.parse(options.body)),...change}});await settle();
    app.ids.get('paper-strategy').value='d'.repeat(64);app.ids.get('side').value='buy';app.ids.get('paper-amount').value='1000000';setPaperCosts(app);await app.submit('paper-order');
    const call=app.calls.find(call=>call.url.endsWith('/paper/orders'));assert.deepEqual(JSON.parse(call.options.body).ExecutionCosts,paperCostsV1);
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(app.proofs(),0);
    assert.equal(vm.runInContext('pendingPaperIntent!==null',app.context),Object.keys(change).length>0);
  }
});
test('Paper cost pending recovery restores exact rates, refuses changed model, and retries only original intent',async()=>{
  const snapshot={strategies:{saved:savedResearchStrategy()}};
  const lost=harness({snapshot,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?snapshot:Promise.reject(Error('Connection lost'))});await settle();
  lost.ids.get('paper-strategy').value='d'.repeat(64);lost.ids.get('side').value='buy';lost.ids.get('paper-amount').value='1000000';setPaperCosts(lost);await lost.submit('paper-order');
  const submitted=lost.calls.find(call=>call.url.endsWith('/paper/orders')).options.body;
  const restored=harness({snapshot,savedStorage:lost.storage,confirmAction:()=>true,apiResponse:(url,options)=>url.endsWith('/snapshot')?snapshot:costReceipt(JSON.parse(options.body))});await settle();
  assert.equal(restored.ids.get('paper-cost-model').value,'v1');assert.equal(restored.ids.get('paper-cost-fee').value,'10');assert.equal(restored.ids.get('paper-cost-slippage').value,'5');
  restored.ids.get('paper-cost-fee').value='11';await restored.submit('paper-order');assert.equal(restored.calls.filter(call=>call.options.method==='POST').length,0);
  restored.ids.get('paper-cost-fee').value='10';await restored.submit('paper-order');assert.equal(restored.calls.find(call=>call.url.endsWith('/paper/orders')).options.body,submitted);assert.equal(vm.runInContext('pendingPaperIntent',restored.context),null);
});

test('typed Paper daily-loss rejection clears the rejected intent, refreshes risk and stays localized without auto-retry',async()=>{
  const hash='d'.repeat(64),snapshot={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};let posts=0;
  const app=harness({snapshot,confirmAction:()=>true,apiStatus:url=>url.endsWith('/paper/orders')?403:200,apiResponse:url=>{
    if(url.endsWith('/paper/orders')){posts++;return {error:'paper_daily_loss_limit',errorId:'controlled-error-id'}}
    return {...snapshot,paper:posts?{DailyRisk:{Policy:'utc_first_mark_equity_loss_micro_v1',Day:'2026-10-03',Loss:1000000000,Limit:1000000000,Breached:true}}:{}};
  }});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';
  await app.submit('paper-order');assert.equal(posts,1);
  assert.equal([...app.storage.keys()].some(key=>key.startsWith('ynx.quant.paper.pending')),false);
  assert.ok(app.ids.get('paper-state').innerHTML.includes('1000000000 / 1000000000'));
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("paperDailyLossLead")',app.context));
  }
  assert.equal(posts,1);assert.equal(app.proofs(),0);
});

test('Paper rejection follow-up read cannot label a newer pending view with the old rejection',async()=>{
  const hash='d'.repeat(64),snapshot={strategies:{saved:{Name:'Saved',StrategyHash:hash}}},late=deferred();let posts=0;
  const app=harness({snapshot,confirmAction:()=>true,apiStatus:url=>url.endsWith('/paper/orders')?403:200,apiResponse:url=>{
    if(url.endsWith('/paper/orders')){posts++;return {error:'paper_daily_loss_limit'}}
    return posts?late.promise:snapshot;
  }});await settle();app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';
  const pending=app.submit('paper-order');await settle();const key=vm.runInContext('paperPendingKey',app.context),newer={StrategyHash:hash,Side:'buy',Amount:200,IdempotencyKey:'quant-paper-11111111-1111-4111-8111-111111111111'},raw=JSON.stringify(newer),before=app.ids.get('toast').textContent;
  app.storage.set(key,raw);late.resolve(snapshot);await pending;
  assert.equal(app.storage.get(key),raw);assert.equal(app.ids.get('toast').textContent,before);assert.equal(vm.runInContext('JSON.stringify(pendingPaperIntent)',app.context),raw);assert.equal(posts,1);
});
test('saved Paper parameter restoration is read-only, exact, localized and retains legacy compatibility',async()=>{
  for(const costs of [false,true]){
    const hash='d'.repeat(64),workspace={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};
    const app=harness({snapshot:workspace,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?workspace:Promise.reject(Error('controlled lost return'))});await settle();
    app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='1000000';if(costs)setPaperCosts(app);
    await app.submit('paper-order');const key=vm.runInContext('paperPendingKey',app.context),raw=app.storage.get(key),calls=app.calls.length;
    const restore=app.ids.get('paper-order').children.find(element=>element.id==='paper-restore-pending'),review=app.ids.get('paper-order').children.find(element=>element.id==='paper-pending-status');
    for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
      app.ids.get('locale').onchange({target:{value:language}});app.ids.get('paper-amount').value='2000000';app.ids.get('side').value='sell';app.ids.get('paper-cost-model').value=costs?'legacy':'v1';app.ids.get('paper-cost-fee').value='99';
      restore.onclick();
      assert.equal(app.ids.get('paper-amount').value,'1000000');assert.equal(app.ids.get('side').value,'buy');assert.equal(app.ids.get('paper-cost-model').value,costs?'v1':'legacy');
      if(costs){assert.equal(app.ids.get('paper-cost-fee').value,'10');assert.equal(app.ids.get('paper-cost-slippage').value,'5');}
      assert.equal(app.storage.get(key),raw);assert.equal(app.calls.length,calls);assert.equal(app.proofs(),0);
      assert.equal(app.ids.get('toast').textContent,vm.runInContext('t("paperRestored")',app.context));
      assert.ok(review.textContent.includes(JSON.parse(raw).IdempotencyKey));assert.ok(review.textContent.includes(vm.runInContext('t("paperPendingReview")',app.context)));
      assert.equal(restore.textContent,vm.runInContext('t("paperRestore")',app.context));
    }
    const before=app.ids.get('paper-amount').value;
    for(const invalid of ['{"unexpected":true}',JSON.stringify({...JSON.parse(raw),StrategyHash:'f'.repeat(64)})]){
      app.storage.set(key,invalid);restore.onclick();assert.equal(app.storage.get(key),invalid);assert.equal(app.ids.get('paper-amount').value,before);assert.equal(app.calls.length,calls);
    }
  }
});
test('cancelled retry preserves the original durable uncertain intent without a new request',async()=>{
  const hash='d'.repeat(64),snapshot={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};
  const original=harness({snapshot,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?snapshot:Promise.reject(Error('Connection lost'))});await settle();original.ids.get('paper-strategy').value=hash;original.ids.get('side').value='buy';original.ids.get('paper-amount').value='100';await original.submit('paper-order');
  const key=[...original.storage.keys()].find(key=>key.startsWith('ynx.quant.paper.pending')),pending=original.storage.get(key);assert.ok(pending);
  const restored=harness({snapshot,savedStorage:original.storage,confirmAction:()=>false});await settle();await restored.submit('paper-order');assert.equal(restored.storage.get(key),pending);assert.equal(restored.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(restored.proofs(),0);
});

test('late Paper success, definitive rejection and network loss cannot erase or complete a newer durable intent', async () => {
  for(const costs of [false,true])for(const outcome of ['success','rejection','network']){
    const hash='d'.repeat(64),late=deferred(),workspace={strategies:{saved:{Name:'Saved',StrategyHash:hash}},paper:{KillSwitch:false}};
    const app=harness({snapshot:workspace,confirmAction:()=>true,apiStatus:url=>url.endsWith('/paper/orders')&&outcome==='rejection'?400:200,apiResponse:url=>url.endsWith('/snapshot')?workspace:late.promise});await settle();
    app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='1000000';if(costs)setPaperCosts(app);
    const pending=app.submit('paper-order');await settle();
    const sent=JSON.parse(app.calls.find(c=>c.url.endsWith('/paper/orders')).options.body),key=[...app.storage.keys()].find(k=>k.startsWith('ynx.quant.paper.pending.v1:'));
    const newer={...sent,IdempotencyKey:'quant-paper-11111111-1111-4111-8111-111111111111',Amount:2000000},raw=JSON.stringify(newer);
    app.storage.set(key,raw);const before=app.ids.get('toast').textContent,reads=app.calls.filter(c=>c.url.endsWith('/snapshot')).length;
    if(outcome==='network')late.reject(Error('controlled late connection loss'));
    else late.resolve(outcome==='rejection'?{error:'invalid_request'}:costs?costReceipt(sent):paperRecord({StrategyHash:sent.StrategyHash,Side:sent.Side,Amount:sent.Amount,IdempotencyKey:sent.IdempotencyKey}));
    await pending;
    assert.equal(app.storage.get(key),raw);assert.equal(vm.runInContext('JSON.stringify(pendingPaperIntent)',app.context),raw);
    assert.equal(app.ids.get('toast').textContent,before,'old response cannot label the new operation completed or failed');
    assert.equal(app.calls.filter(c=>c.url.endsWith('/snapshot')).length,reads);assert.equal(vm.runInContext('paperSubmitting',app.context),false);assert.equal(app.proofs(),0);
    app.ids.get('paper-amount').value='2000000';await app.submit('paper-order');
    assert.equal(JSON.parse(app.calls.filter(c=>c.url.endsWith('/paper/orders'))[1].options.body).IdempotencyKey,newer.IdempotencyKey);
  }
});
test('late Paper response preserves an edited current view and cannot overwrite another view before dispatch',async()=>{
  const hash='d'.repeat(64),late=deferred(),workspace={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};
  const app=harness({snapshot:workspace,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?workspace:late.promise});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='1000000';setPaperCosts(app);
  const pending=app.submit('paper-order');await settle();const sent=JSON.parse(app.calls.find(c=>c.url.endsWith('/paper/orders')).options.body),key=[...app.storage.keys()].find(k=>k.startsWith('ynx.quant.paper.pending.v1:')),raw=app.storage.get(key),before=app.ids.get('toast').textContent;
  app.ids.get('paper-cost-fee').value='11';late.resolve(costReceipt(sent));await pending;
  assert.equal(app.storage.get(key),raw);assert.equal(app.ids.get('paper-cost-fee').value,'11');assert.equal(app.ids.get('toast').textContent,before);
  const newer={...sent,IdempotencyKey:'quant-paper-11111111-1111-4111-8111-111111111111',Amount:2000000};app.storage.set(key,JSON.stringify(newer));
  app.ids.get('paper-cost-fee').value='10';await app.submit('paper-order');assert.equal(app.calls.filter(c=>c.url.endsWith('/paper/orders')).length,1);assert.equal(app.storage.get(key),JSON.stringify(newer));
});
test('Paper confirmation cannot overwrite a journal created by another view while the dialog is open',async()=>{
  const hash='d'.repeat(64),workspace={strategies:{saved:{Name:'Saved',StrategyHash:hash}}},newer={StrategyHash:hash,Side:'buy',Amount:2000000,IdempotencyKey:'quant-paper-11111111-1111-4111-8111-111111111111'};
  let app;
  app=harness({snapshot:workspace,confirmAction:()=>{app.storage.set(vm.runInContext('paperPendingKey',app.context),JSON.stringify(newer));return true;}});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='1000000';await app.submit('paper-order');
  assert.equal(app.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(app.storage.get(vm.runInContext('paperPendingKey',app.context)),JSON.stringify(newer));
  assert.equal(vm.runInContext('JSON.stringify(pendingPaperIntent)',app.context),JSON.stringify(newer));assert.equal(app.proofs(),0);
});
test('Paper submits the selected saved strategy, preserves selection on refresh and rejects a stale/foreign hash', async () => {
  const hash = 'd'.repeat(64), app = harness({confirmAction:()=>true,snapshot: {strategies: {one: {Name: 'Saved strategy', StrategyHash: hash}}}}); await settle();
  app.ids.get('paper-strategy').value = hash; app.ids.get('paper-strategy').onchange();
  app.ids.get('side').value = 'buy'; app.ids.get('paper-amount').value = '100';
  await app.submit('paper-order');
  const order = app.calls.find(call => call.url.endsWith('/paper/orders'));
  assert.equal(JSON.parse(order.options.body).StrategyHash, hash);
  assert.equal(app.ids.get('paper-strategy').value, hash);
  app.ids.get('paper-strategy').value = 'e'.repeat(64);
  await app.submit('paper-order');
  assert.equal(app.calls.filter(call => call.url.endsWith('/paper/orders')).length, 1);
});

test('Paper preserves one intent across double clicks, unknown network outcome and reload retry', async () => {
  const strategyHash = 'd'.repeat(64), snapshot = {strategies: {one: {Name: 'Saved strategy', StrategyHash: strategyHash}}};
  const late = deferred(), app = harness({confirmAction:()=>true,snapshot, apiResponse: url => url.endsWith('/snapshot') ? snapshot : late.promise});
  await settle();
  app.ids.get('paper-strategy').value = strategyHash;
  app.ids.get('paper-strategy').onchange();
  app.ids.get('side').value = 'buy'; app.ids.get('paper-amount').value = '100';
  const first = app.submit('paper-order');
  await app.submit('paper-order');
  assert.equal(app.ids.get('paper-submit').disabled, true);
  const requests = app.calls.filter(call => call.url.endsWith('/paper/orders'));
  assert.equal(requests.length, 1);
  const original = JSON.parse(requests[0].options.body);
  assert.match(original.IdempotencyKey, /^quant-paper-[0-9a-f-]{36}$/);
  late.reject(new Error('Connection lost after request was sent')); await first;
  const key = [...app.storage.keys()].find(value => value.startsWith('ynx.quant.paper.pending.v1:'));
  assert.equal(JSON.parse(app.storage.get(key)).IdempotencyKey, original.IdempotencyKey);
  app.wallet(connected(accountB)); await settle();
  assert.equal(JSON.parse(app.storage.get(key)).IdempotencyKey, original.IdempotencyKey);
  app.ids.get('paper-amount').value = '101';
  await app.submit('paper-order');
  assert.equal(app.calls.filter(call => call.url.endsWith('/paper/orders')).length, 1);
  assert.match(app.ids.get('toast').textContent, /unknown outcome/);
  const restored = harness({confirmAction:()=>true,snapshot, savedStorage: app.storage}); await settle();
  assert.equal(restored.ids.get('paper-strategy').value, strategyHash);
  assert.equal(restored.ids.get('paper-amount').value, '100');
  await restored.submit('paper-order');
  const retried = JSON.parse(restored.calls.find(call => call.url.endsWith('/paper/orders')).options.body);
  assert.deepEqual(retried, original);
  assert.equal(restored.storage.has(key), false);
  assert.equal(restored.proofs(), 0);
});

test('Paper refuses unsafe numeric amounts before creating an intent or making a request', async () => {
  const hash = 'd'.repeat(64), app = harness({snapshot: {strategies: {one: {Name: 'Saved', StrategyHash: hash}}}}); await settle();
  app.ids.get('paper-strategy').value = hash; app.ids.get('side').value = 'buy';
  for (const amount of ['9007199254740992', '0', '-1', '1.5']) {
    app.ids.get('paper-amount').value = amount;
    await app.submit('paper-order');
  }
  assert.equal(app.calls.filter(call => call.url.endsWith('/paper/orders')).length, 0);
  assert.equal([...app.storage.keys()].some(key => key.startsWith('ynx.quant.paper.pending.v1:')), false);
});

test('Paper acknowledgement cannot silently forget a pending intent when durable removal fails',async()=>{
  for(const outcome of ['recorded','rejected'])for(const mode of ['silent','throw']){
    const hash='d'.repeat(64),workspace={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};
    const app=harness({snapshot:workspace,confirmAction:()=>true,storageBoundary(operation,key){if(operation==='remove'&&key.startsWith('ynx.quant.paper.pending')){if(mode==='throw')throw Error('Storage removal unavailable');return false}},apiStatus:url=>url.endsWith('/paper/orders')&&outcome==='rejected'?400:200,apiResponse:(url,options)=>url.endsWith('/snapshot')?workspace:outcome==='rejected'?{error:'invalid_request'}:{...paperRecord({ID:'paper-000001',Price:1200000,Status:'filled',Filled:100}),...JSON.parse(options.body)}});
    await settle();app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';await app.submit('paper-order');
    const key=[...app.storage.keys()].find(key=>key.startsWith('ynx.quant.paper.pending'));assert.ok(key);
    const durable=JSON.parse(app.storage.get(key));
    assert.equal(vm.runInContext('workspaceStorageAvailable',app.context),false,`${outcome}/${mode}: failed removal must close stateful actions`);
    assert.equal(vm.runInContext('pendingPaperIntent?.IdempotencyKey',app.context),durable.IdempotencyKey,'memory must not pretend the persisted intent is gone');
    assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(app.ids.get('workspace-storage-boundary').hidden,false);
    await app.submit('paper-order');assert.equal(app.calls.filter(call=>call.url.endsWith('/paper/orders')).length,1);
    assert.equal(app.proofs(),0);
  }
});

test('only complete consistent Paper receipts acknowledge recorded orders; malformed 200 retains intent',async()=>{
  const hash='d'.repeat(64),snapshot={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};
  const cases=[{Status:'open',Filled:0},{Status:'partially_filled',Filled:1},{Status:'filled',Filled:100},{Price:0},{Price:9007199254740992},{Filled:-1},{Filled:101},{Filled:1,Status:'filled'},{Filled:100,Status:'open'},{Status:'unknown'},{Source:'static-placeholder'},{CreatedAt:'invalid'},{ID:['paper-000001']},{StrategyHash:[hash]},null];
  for(const [caseIndex,override] of cases.entries()){
    const expected=caseIndex<3;
    const app=harness({snapshot,confirmAction:()=>true,apiResponse:(url,options)=>url.endsWith('/snapshot')?snapshot:override===null?null:{...paperRecord({ID:'paper-000001',Price:1200000,Status:'filled',Filled:100}),...JSON.parse(options.body),...override}});await settle();
    app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='100';await app.submit('paper-order');
    const pending=[...app.storage.keys()].some(key=>key.startsWith('ynx.quant.paper.pending'));assert.equal(pending,!expected,JSON.stringify(override));
    assert.match(app.ids.get('toast').textContent,expected?/Simulated order recorded/:/unknown outcome/);
    assert.equal(app.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(app.proofs(),0);
  }
});

test('Paper does not acknowledge or forget an intent when the service returns an unbound result', async () => {
  const hash = 'd'.repeat(64), snapshot = {strategies: {one: {Name: 'Saved', StrategyHash: hash}}};
  for (const mismatch of [{}, {IdempotencyKey: 'wrong-key'}, {StrategyHash: 'e'.repeat(64)}, {Amount: 101}]) {
    const app = harness({confirmAction:()=>true,snapshot, apiResponse: (url, options) => url.endsWith('/snapshot') ? snapshot : Object.keys(mismatch).length ? {ID: 'paper-000001', ...JSON.parse(options.body), ...mismatch} : {}});
    await settle();
    app.ids.get('paper-strategy').value = hash; app.ids.get('side').value = 'buy'; app.ids.get('paper-amount').value = '100';
    await app.submit('paper-order');
    assert.match(app.ids.get('toast').textContent, /unknown outcome/);
    assert.equal([...app.storage.keys()].some(key => key.startsWith('ynx.quant.paper.pending.v1:')), true);
  }
});

test('disconnected portfolio states independent public research and workspace-gated Paper in every language without requests',async()=>{
  assert.doesNotMatch(html,/Research and Paper are still available/);
  assert.match(html,/Public research is independent; Paper requires an authorized workspace/);
  const app=harness();await settle();const calls=app.calls.length,values=new Set();
  for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
    app.ids.get('locale').onchange({target:{value:language}});
    const copy=vm.runInContext('t("connectForPortfolio")',app.context);values.add(copy);
    assert.equal(app.ids.get('wallet-portfolio-status').textContent,copy);assert.ok(copy.includes('YNX Wallet')&&copy.includes('MetaMask'));
    assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(app.calls.length,calls);assert.equal(app.proofs(),0);
  }
  assert.equal(values.size,12);assert.match([...values][0],/Paper requires an authorized workspace/);
});

test('portfolio uses exact provider data without floating point loss and rejects malformed account/source receipts', async () => {
  const large = '9007199254740993000000000000000001';
  const app = harness({portfolioRead: state => Promise.resolve(receipt(state.account, large))}); await settle();
  app.wallet(connected(accountA)); await settle();
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '9,007,199,254,740,993.000000000000000001 YNXT');
  assert.equal(app.ids.get('wallet-portfolio-block').textContent, '42');
  assert.equal(app.ids.get('wallet-portfolio-account').textContent, accountA);
  for (const value of [{...receipt(accountB)}, {...receipt(accountA), source: 'local-paper'}, {...receipt(accountA), decimals: 6}, {...receipt(accountA), balanceBaseUnits: 1e18}, {...receipt(accountA), blockNumber: 42}]) {
    app.context.window.YNXQuantWallet.readPortfolio = async () => value;
    await app.ids.get('wallet-portfolio-refresh').onclick();
    assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '—');
    assert.match(app.ids.get('wallet-portfolio-status').textContent, /unavailable/);
  }
  for(const asOf of ['2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-10-04T00:00:00','10/04/2026']){
    app.context.window.YNXQuantWallet.readPortfolio=async()=>({...receipt(accountA),asOf});
    await app.ids.get('wallet-portfolio-refresh').onclick();
    assert.equal(app.ids.get('wallet-portfolio-balance').textContent,'—');
    assert.equal(vm.runInContext('walletIdentity',app.context),'metamask:'+accountA+':0x1917');
  }
  app.context.window.YNXQuantWallet.readPortfolio=async()=>({...receipt(accountA,large),asOf:'2026-10-04T08:00:00.123456789+08:00'});
  await app.ids.get('wallet-portfolio-refresh').onclick();
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent,'9,007,199,254,740,993.000000000000000001 YNXT');
  assert.equal(app.proofs(),0);
});

test('wallet events deduplicate reads, clear account-bound signatures/previews and ignore late portfolio results', async () => {
  const late = deferred(), app = harness({portfolioRead: () => late.promise}); await settle();
  app.wallet(connected(accountA)); app.wallet({...connected(accountA), rpcProbeStatus: 'degraded'});
  assert.equal(app.reads(), 1);
  for (const id of ['mandate-signature', 'order-signature', 'mandate-account', 'order-mandate']) app.ids.get(id).value = 'old-account-bound-value';
  for (const id of ['mandate-payload', 'order-payload']) {app.ids.get(id).hidden = false; app.ids.get(id).textContent = 'old preview';}
  app.wallet({status: 'disconnected'});
  late.resolve(receipt(accountA)); await settle();
  assert.equal(app.ids.get('wallet-portfolio-balance').textContent, '—');
  for (const id of ['mandate-signature', 'order-signature', 'mandate-account', 'order-mandate']) assert.equal(app.ids.get(id).value, '');
  for (const id of ['mandate-payload', 'order-payload']) assert.equal(app.ids.get(id).hidden, true);
});

test('pending signing preview cannot return after account change and unpreviewed orders never request proof', async () => {
  const late = deferred(), app = harness({apiResponse: url => url.endsWith('/snapshot') ? {} : late.promise}); await settle();
  app.wallet(connected(accountA)); await settle();
  const preview = app.ids.get('preview-mandate').onclick();
  app.wallet(connected(accountB));
  late.resolve({payload: 'stale-account-payload', digest: 'f'.repeat(64)}); await preview;
  assert.equal(app.ids.get('mandate-payload').hidden, true);
  await app.submit('mandate-form'); await app.submit('testnet-order-form');
  assert.equal(app.proofs(), 0);
  assert.equal(app.calls.filter(call => /\/testnet\/(orders|mandates)$/.test(call.url)).length, 0);
});

test('new portfolio states and execution blocker follow all supported languages', async () => {
  const app = harness(); await settle();
  const englishKeys = vm.runInContext('Object.keys(businessCopy.en)', app.context);
  for (const locale of vm.runInContext('supportedLocales', app.context)) {
    assert.deepEqual([...vm.runInContext(`Object.keys(businessCopy[${JSON.stringify(locale)}])`, app.context)].sort(), [...englishKeys].sort());
    app.ids.get('locale').onchange({target: {value: locale}});
    assert.equal(app.context.document.documentElement.lang, locale);
    assert.equal(app.ids.get('wallet-portfolio-status').textContent, vm.runInContext(`businessCopy[${JSON.stringify(locale)}].connectForPortfolio`, app.context));
    assert.equal(app.ids.get('testnet-execution-boundary').textContent, vm.runInContext(`businessCopy[${JSON.stringify(locale)}].executionUnavailable`, app.context));
  }
});
