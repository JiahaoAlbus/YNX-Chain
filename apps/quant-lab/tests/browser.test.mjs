import test from 'node:test';import assert from'node:assert/strict';import{spawn}from'node:child_process';import{mkdtemp,mkdir,readFile}from'node:fs/promises';import net from'node:net';import os from'node:os';import path from'node:path';import{fileURLToPath}from'node:url';import{chromium}from'playwright';
const repo=fileURLToPath(new URL('../../../',import.meta.url));let server,browser,evidence,base;
async function reserveLoopbackPort(){return await new Promise((resolve,reject)=>{const listener=net.createServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const address=listener.address();if(!address||typeof address==='string'){listener.close();reject(new Error('Unable to reserve a loopback port for Quant browser tests.'));return}listener.close(error=>error?reject(error):resolve(address.port))})})}
test.before(async()=>{const work=await mkdtemp(path.join(os.tmpdir(),'ynx-quant-'));const port=await reserveLoopbackPort();base=`http://127.0.0.1:${port}`;evidence=path.join(repo,'tmp','quant-lab-evidence');await mkdir(evidence,{recursive:true});server=spawn('go',['run','./apps/quant-lab/server'],{cwd:repo,detached:true,env:{...process.env,YNX_QUANT_HTTP_ADDR:`127.0.0.1:${port}`,YNX_QUANT_STATE_PATH:path.join(work,'state.json')},stdio:['ignore','pipe','pipe']});let err='';server.stderr.on('data',d=>err+=d);for(let i=0;i<150;i++){try{if((await fetch(base+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,200));if(i===149)throw new Error(err||'Quant browser test server did not become healthy.')}browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})},{timeout:30_000});test.after(async()=>{await browser?.close();if(server?.pid)try{process.kill(-server.pid,'SIGTERM')}catch{}});
test('real research form coalesces a delayed request without displaying unconfirmed results',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  try{
    let posts=0,complete;const gate=new Promise(resolve=>complete=resolve);
    await context.route('**/api/v1/backtests/from-market',async route=>{posts++;await gate;await route.fulfill({status:503,contentType:'application/json',body:'{"error":"Exact delayed market unavailable"}'})});
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});await page.locator('#research-submit').click();await page.locator('#research-request-status').waitFor({state:'visible'});
    assert.equal(await page.locator('#research-submit').isDisabled(),true);assert.equal(await page.locator('#backtest').getAttribute('aria-busy'),'true');
    await page.evaluate(()=>{document.getElementById('backtest').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))});
    await page.selectOption('#locale','ar');assert.match(await page.locator('#research-request-status').textContent(),/قيد الانتظار/);assert.equal(await page.locator('#latest-result').isVisible(),false);assert.equal(posts,1);
    complete();await page.getByText('Exact delayed market unavailable',{exact:true}).waitFor();assert.equal(await page.locator('#research-submit').isDisabled(),false);assert.equal(await page.locator('#backtest').getAttribute('aria-busy'),'false');assert.equal(await page.locator('#research-request-status').isVisible(),false);assert.equal(posts,1);
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
test('paper requires a saved strategy; zero reconciliation and kill switch are visible',async()=>{const page=await browser.newPage({viewport:{width:1024,height:800}});await page.goto(base);await page.selectOption('#locale','en');await page.getByRole('button',{name:'Paper',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Submit simulated signal'}).isDisabled(),true);await page.getByText('Run a backtest to save a strategy before submitting a Paper signal.').waitFor();await page.getByRole('button',{name:'Risk'}).click();await page.getByRole('button',{name:'Reconcile exact local paper state'}).click();await page.getByText('Reconciliation completed: zero difference').waitFor();page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Activate kill switch'}).click();await page.getByText('Kill switch active').waitFor();await page.getByRole('button',{name:'Paper',exact:true}).click();await page.getByText('ACTIVE',{exact:true}).waitFor();await page.screenshot({path:path.join(evidence,'paper-kill-switch.png'),fullPage:true})});
test('a delayed actual-service snapshot cannot hide a newer confirmed Paper kill switch',{timeout:15000},async()=>{
  // Delay a real isolated Go response, not a fabricated risk-state result.
  const context=await browser.newContext();let release;
  const held=new Promise(resolve=>{release=resolve;});let captured;
  const capture=new Promise(resolve=>{captured=resolve;});
  try{
    const page=await context.newPage();await page.goto(base,{waitUntil:'networkidle'});
    let holdNext=true;
    await context.route('**/api/v1/snapshot',async route=>{
      if(!holdNext)return route.continue();holdNext=false;
      const response=await route.fetch();captured(await response.json());
      await held;await route.fulfill({response});
    });
    await page.evaluate(()=>{window.quantSnapshotTest=refresh();});
    const before=await capture;assert.equal(before.paper.KillSwitch,false);
    await page.getByRole('button',{name:'Risk',exact:true}).click();
    page.on('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'Activate kill switch',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#paper-state').textContent.includes('ACTIVE'));
    release();await page.evaluate(()=>window.quantSnapshotTest);
    assert.match(await page.locator('#paper-state').textContent(),/ACTIVE/);
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
      await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({id:'isolated-public-ui-result',createdAt:'2026-10-03T00:00:00Z',strategy:{Name:'Isolated UI research fixture',Source:'Explicit isolated UI data fixture',DataHash:'c'.repeat(64),StrategyHash:'d'.repeat(64)},assumptions:{FeeBPS:34,SlippageBPS:17,LatencyBars:2,ParticipationBPS:2500,TrainEnd:30,WalkForwardWindows:4,Seed:0},metricDefinitions:{sharpeMilli:'Explicit isolated UI formula: mean / sample deviation × √periods × 1,000; zero risk-free rate'},metrics:{ReturnBPS:120,BuyHoldBPS:90,MaxDrawdownBPS:20,SharpeMilli:1500,VolatilityBPS:7,Trades:2,PartialFills:0,DataGaps:0},equityCurve:[{equity:1000,benchmarkEquity:1000},{equity:1012,benchmarkEquity:1009}],sensitivitySpreadBPS:2})});
    });
    const page=await context.newPage();await page.goto(base,{waitUntil:'domcontentloaded'});
    assert.equal((await capturedSnapshot).access.statefulPreview,true);
    await page.getByRole('button',{name:'Run out-of-sample backtest',exact:true}).click();await startedResearch;
    releaseSnapshot();await page.waitForFunction(()=>document.querySelector('#workspace-boundary').hidden);
    releaseResearch();await page.locator('#research-result-status').getByText('Temporary result on this page only — not saved or audited. Reloading the page discards it.',{exact:true}).waitFor();
    assert.equal(await page.locator('#result-return').textContent(),'120 bps');
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
