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
const savedResearchStrategy = overrides => ({ID:'saved-research',Name:'Saved research',Stage:'Backtest',Family:'transparent',License:'test-only',StrategyHash:'d'.repeat(64),Runtime:{enabled:false,running:false,intervalSeconds:0},...overrides});

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

test('completed research must bind the exact submitted strategy ID, not another run with identical parameters',async()=>{
  const app=harness();await settle();
  const submitted={strategy:{id:'ma-current-request',family:'transparent',seed:7,params:{fast:3,slow:8}},assumptions:{feeBPS:10,slippageBPS:5,latencyBars:1,participationBPS:1000,trainEnd:24,walkForwardWindows:3,seed:7}};
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
function harness({snapshot = {}, portfolioRead, apiResponse, apiStatus = () => 200, savedStorage, storageBoundary, confirmAction = () => false} = {}) {
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
  const context = vm.createContext({window, document, console, crypto: webcrypto, Intl, Date, BigInt, AbortController, TextEncoder, setTimeout: () => 1, clearTimeout: () => {}, confirm: confirmAction,
    localStorage: {getItem: key => {storageBoundary?.('get',key);return storage.get(key) ?? null}, setItem: (key, value) => {if(storageBoundary?.('set',key)!==false)storage.set(key,value)}, removeItem: key => {storageBoundary?.('remove',key);storage.delete(key)}},
fetch: async (url, options) => {calls.push({url, options}); const submitted=url.endsWith('/paper/orders')?JSON.parse(options.body):null; let body = apiResponse ? await apiResponse(url, options) : url.endsWith('/snapshot') ? snapshot : submitted ? {...paperRecord({ID:'paper-000001',Price:1200000,Status:'filled',Filled:submitted.Amount}),...submitted} : {payload: 'exact-fixture-payload', digest: 'f'.repeat(64)}; if (url.endsWith('/backtests/from-market') && body?.strategy) {const research=JSON.parse(options.body);body={...body,strategy:{...body.strategy,ID:body.strategy.ID??research.strategy.id},researchRequestKey:body.researchRequestKey??research.idempotencyKey};} const status = apiStatus(url); return {ok: status >= 200 && status < 300, status, headers:new Headers({'content-type':'application/json'}), text:async()=>JSON.stringify(url.endsWith('/snapshot') ? {access: {statefulPreview: true}, ...body} : body)};},
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
test('saved research schedules render source failures and disable unknown or ineligible runtimes',async()=>{
  for(const Runtime of [undefined,{enabled:false},{enabled:true,running:false,intervalSeconds:60,nextRunAt:'not-a-date',lastRunStatus:'scheduled'},{enabled:false,running:true,intervalSeconds:60}]){
    const strategy=savedResearchStrategy({Runtime}),app=harness({snapshot:{strategies:{saved:strategy}}});await settle();assert.match(app.ids.get('strategy-rows').innerHTML,/Schedule unverified/);assert.match(app.ids.get('strategy-rows').innerHTML,/disabled/);assert.doesNotMatch(app.ids.get('strategy-rows').innerHTML,/>Stopped</);await app.schedule(strategy,true);assert.equal(app.calls.filter(call=>call.options.method==='PUT').length,0);
  }
  const strategy=savedResearchStrategy({ID:'saved"><img src=x>',Runtime:{enabled:true,running:false,intervalSeconds:60,nextRunAt:'2026-10-03T01:01:00Z',lastRunAt:'2026-10-03T01:00:00Z',lastRunStatus:'failed_market_data_unavailable',lastExperiment:''}}),app=harness({snapshot:{strategies:{saved:strategy}}});await settle();const rows=app.ids.get('strategy-rows').innerHTML;assert.match(rows,/Market data unavailable/);assert.doesNotMatch(rows,/failed_market_data_unavailable|<img src=x>/);assert.match(rows,/Stop schedule/);
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

test('blocked or silent storage cannot crash public research or grant Paper authority', async () => {
  for(const mode of ['get','set','remove','silent']){
    const app=harness({storageBoundary(operation){if(operation===mode)throw Error('Storage unavailable');if(mode==='silent'&&operation==='set')return false},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},strategies:{},experiments:{},paper:{},audit:[]}:researchFixture('storage-public')});await settle();
    assert.equal(app.ids.get('workspace-storage-boundary').hidden,false,mode);
    assert.equal(app.ids.get('kill').disabled,true);assert.equal(app.ids.get('reconcile').disabled,true);assert.equal(app.ids.get('paper-submit').disabled,true);
    await app.submit('backtest');assert.equal(app.calls.at(-1).url,'/api/v1/public/research/backtests/from-market');assert.equal(app.calls.at(-1).options.headers['x-ynx-tenant-id'],undefined);assert.equal(app.calls.at(-1).options.headers['x-ynx-preview-mode'],undefined);
    const before=app.calls.length;await app.submit('paper-order');await app.ids.get('kill').onclick();await app.ids.get('reconcile').onclick();assert.equal(app.calls.length,before);
    app.ids.get('locale').onchange({target:{value:'ar'}});assert.equal(app.context.document.documentElement.lang,'ar');assert.match(app.ids.get('workspace-storage-boundary').textContent,/تخزين/);
    assert.equal(app.proofs(),0);
  }
});

test('Paper intent persistence failure sends no order and disables durable workspace actions', async()=>{
  let denied=false;const hash='d'.repeat(64),app=harness({confirmAction:()=>true,snapshot:{strategies:{one:{Name:'Saved strategy',StrategyHash:hash}}},storageBoundary(operation,key){if(denied&&operation==='set'&&key.startsWith('ynx.quant.paper.pending'))throw Error('Quota exceeded')}});await settle();
  app.ids.get('paper-strategy').value=hash;app.ids.get('side').value='buy';app.ids.get('paper-amount').value='10';denied=true;
  await app.submit('paper-order');assert.equal(app.calls.filter(call=>call.url.endsWith('/paper/orders')).length,0);
  assert.equal(app.ids.get('paper-submit').disabled,true);assert.equal(app.ids.get('kill').disabled,true);assert.equal(app.ids.get('workspace-storage-boundary').hidden,false);
  await app.submit('backtest');assert.equal(app.calls.at(-1).url,'/api/v1/public/research/backtests/from-market');
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

test('risk outcomes use confirmed zero or exact nonzero receipts without false zero-difference claims',async()=>{
  for(const delta of [0,1,Number.MAX_SAFE_INTEGER]){
    const receipt={Cash:1000,Position:0,ReconciliationDelta:delta,KillSwitch:delta!==0};
    const app=harness({snapshot:{paper:receipt},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},paper:receipt}:receipt});await settle();
    await app.ids.get('reconcile').onclick();const message=app.ids.get('toast').textContent;
    if(delta===0)assert.match(message,/zero difference/);else{assert.doesNotMatch(message,/zero difference/);assert.match(message,new RegExp(': '+delta+'$'));assert.match(message,/kill switch is active/);app.ids.get('locale').onchange({target:{value:'ar'}});assert.match(app.ids.get('toast').textContent,new RegExp(': '+delta+'$'))}
    assert.equal(app.ids.get('reconcile').disabled,false);assert.equal(app.proofs(),0);
  }
});

test('risk receipt mismatch is unconfirmed and pending operations coalesce without duplicate confirmations',async()=>{
  for(const id of ['reconcile','kill']){
    let confirmations=0;const pending=deferred(),receipt={Cash:1000,Position:0,ReconciliationDelta:0,KillSwitch:id==='kill'};
    const app=harness({snapshot:{paper:receipt},confirmAction:()=>{confirmations++;return true},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:true},paper:receipt}:pending.promise});await settle();
    const first=app.ids.get(id).onclick();await app.ids.get(id).onclick();assert.equal(app.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(confirmations,id==='kill'?1:0);assert.equal(app.ids.get(id).disabled,true);
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
    assert.equal(confirmations,firstId==='kill'?1:0);
    pending.resolve(receipt);await first;
    assert.equal(app.ids.get('kill').disabled,false);assert.equal(app.ids.get('reconcile').disabled,false);
  }
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

test('malformed research curves are omitted without fabricating equity or losing valid metrics', async () => {
  for(const curve of [{length:2},[null,{}],[{equity:1,benchmarkEquity:1},{equity:Number.MAX_SAFE_INTEGER+1,benchmarkEquity:2}],[{equity:1,benchmarkEquity:1},{equity:-1,benchmarkEquity:2}],[]]){
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
  for(const times of [[undefined,'2026-10-03T00:01:00Z'],['invalid','2026-10-03T00:01:00Z'],['2026-10-03T00:01:00Z','2026-10-03T00:01:00Z'],['2026-10-03T00:02:00Z','2026-10-03T00:01:00Z']]){
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
    assert.deepEqual(cells.slice(-5),expected);
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

test('cancelled retry preserves the original durable uncertain intent without a new request',async()=>{
  const hash='d'.repeat(64),snapshot={strategies:{saved:{Name:'Saved',StrategyHash:hash}}};
  const original=harness({snapshot,confirmAction:()=>true,apiResponse:url=>url.endsWith('/snapshot')?snapshot:Promise.reject(Error('Connection lost'))});await settle();original.ids.get('paper-strategy').value=hash;original.ids.get('side').value='buy';original.ids.get('paper-amount').value='100';await original.submit('paper-order');
  const key=[...original.storage.keys()].find(key=>key.startsWith('ynx.quant.paper.pending')),pending=original.storage.get(key);assert.ok(pending);
  const restored=harness({snapshot,savedStorage:original.storage,confirmAction:()=>false});await settle();await restored.submit('paper-order');assert.equal(restored.storage.get(key),pending);assert.equal(restored.calls.filter(call=>call.options.method==='POST').length,0);assert.equal(restored.proofs(),0);
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
