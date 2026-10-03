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
const settle = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
const researchFixture = (id, name = id) => ({id, createdAt:'2026-10-03T00:00:00Z', strategy:{Name:name, StrategyHash:'e'.repeat(64)}, metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:0}, equityCurve:[{equity:1000,benchmarkEquity:1000},{equity:1012,benchmarkEquity:1009}], sensitivitySpreadBPS:2});
const researchStatus = app => app.ids.get('latest-result').children.find(element => element.id === 'research-result-status').textContent;

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
function harness({snapshot = {}, portfolioRead, apiResponse, savedStorage, storageBoundary, confirmAction = () => false} = {}) {
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
  const context = vm.createContext({window, document, console, crypto: webcrypto, Intl, Date, BigInt, setTimeout: () => 1, clearTimeout: () => {}, confirm: confirmAction,
    localStorage: {getItem: key => {storageBoundary?.('get',key);return storage.get(key) ?? null}, setItem: (key, value) => {if(storageBoundary?.('set',key)!==false)storage.set(key,value)}, removeItem: key => {storageBoundary?.('remove',key);storage.delete(key)}},
    fetch: async (url, options) => {calls.push({url, options}); const body = apiResponse ? await apiResponse(url, options) : url.endsWith('/snapshot') ? snapshot : url.endsWith('/paper/orders') ? {ID: 'paper-000001', ...JSON.parse(options.body)} : {payload: 'exact-fixture-payload', digest: 'f'.repeat(64)}; return {ok: true, json: async () => url.endsWith('/snapshot') ? {access: {statefulPreview: true}, ...body} : body};},
  });
  vm.runInContext(i18n, context);
  context.QuantI18n = window.QuantI18n;
  vm.runInContext(source, context);
  return {ids, calls, storage, context, reads: () => reads, proofs: () => proofs,
    wallet: state => {current = state; events.get('ynx:quant-wallet-state')({detail: state});},
    submit: id => ids.get(id).onsubmit({preventDefault() {}}),
  };
}

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
  let denied=false;const hash='d'.repeat(64),app=harness({snapshot:{strategies:{one:{Name:'Saved strategy',StrategyHash:hash}}},storageBoundary(operation,key){if(denied&&operation==='set'&&key.startsWith('ynx.quant.paper.pending'))throw Error('Quota exceeded')}});await settle();
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

test('failed research unlocks a new explicit request without fabricating an experiment or automatic replay',async()=>{
  let posts=0;const app=harness({snapshot:{access:{statefulPreview:false}},apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:(posts++,Promise.reject(Error('Exact bounded source failure')))});await settle();
  await app.submit('backtest');assert.equal(posts,1);assert.equal(app.ids.get('research-submit').disabled,false);assert.equal(app.ids.get('research-request-status').hidden,true);assert.equal(app.ids.get('latest-result').hidden,true);assert.match(app.ids.get('toast').textContent,/Exact bounded source failure/);
  await app.submit('backtest');assert.equal(posts,2);assert.equal(app.proofs(),0);assert.equal(vm.runInContext('Object.keys(publicExperiments).length',app.context),0);
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

test('public stateless research renders measured equity without granting Paper or saved strategy authority', async () => {
  const experiment = {id:'public-test-result',createdAt:'2026-09-12T00:00:00Z',strategy:{Name:'Explicit synthetic UI fixture'},metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:0},equityCurve:[{equity:1000,benchmarkEquity:1000},{equity:1012,benchmarkEquity:1009}],sensitivitySpreadBPS:2};
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

test('run details stay bound to the returned experiment through input edits and locale changes', async () => {
  const result={...researchFixture('reported-run'),strategy:{Name:'Reported run',Source:'verified-index/<img src=x>',DataHash:'a'.repeat(64),StrategyHash:'b'.repeat(64)},assumptions:{FeeBPS:34,SlippageBPS:17,LatencyBars:2,ParticipationBPS:2500,TrainEnd:30,WalkForwardWindows:4,Seed:0},metricDefinitions:{sharpeMilli:'returned Sharpe definition <script>alert(1)</script>',volatilityBPS:'sample deviation; not annualized'}};
  const app=harness({apiResponse:url=>url.endsWith('/snapshot')?{access:{statefulPreview:false}}:result});await settle();
  app.ids.get('fee').value='10';app.ids.get('slippage').value='5';await app.submit('backtest');
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

test('Paper submits the selected saved strategy, preserves selection on refresh and rejects a stale/foreign hash', async () => {
  const hash = 'd'.repeat(64), app = harness({snapshot: {strategies: {one: {Name: 'Saved strategy', StrategyHash: hash}}}}); await settle();
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
  const late = deferred(), app = harness({snapshot, apiResponse: url => url.endsWith('/snapshot') ? snapshot : late.promise});
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
  const restored = harness({snapshot, savedStorage: app.storage}); await settle();
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

test('Paper does not acknowledge or forget an intent when the service returns an unbound result', async () => {
  const hash = 'd'.repeat(64), snapshot = {strategies: {one: {Name: 'Saved', StrategyHash: hash}}};
  for (const mismatch of [{}, {IdempotencyKey: 'wrong-key'}, {StrategyHash: 'e'.repeat(64)}, {Amount: 101}]) {
    const app = harness({snapshot, apiResponse: (url, options) => url.endsWith('/snapshot') ? snapshot : Object.keys(mismatch).length ? {ID: 'paper-000001', ...JSON.parse(options.body), ...mismatch} : {}});
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
