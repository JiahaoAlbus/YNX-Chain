const fs=require('fs/promises'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process'),net=require('net');
const {chromium}=require(require.resolve('playwright',{paths:['/Users/huangjiahao/.codex/worktrees/android-installed-gate-main-20261001/apps/finance']}));
const root=path.resolve(__dirname,'../../..'),out=process.env.YNX_MEDIA_SITE_EVIDENCE||'/tmp/ynx-media-microsites-20261004';
const musicBinary=process.env.YNX_MEDIA_SITE_MUSIC_BINARY||out+'/music-site-candidate';
const port=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
(async()=>{const processes=[],cases=[];let browser;
try{
 await fs.mkdir(out,{recursive:true});const sites=[];
 for(const [product,directory] of [['video','apps/video'],['creator','apps/creator-studio'],['music','apps/music/web']]){
  const p=await port(),origin='http://127.0.0.1:'+p;let child;
  if(product==='music')child=spawn(musicBinary,['-http','127.0.0.1:'+p,'-data',await fs.mkdtemp(out+'/music-state-')],{cwd:root,stdio:['ignore','pipe','pipe']});
  else child=spawn(process.execPath,['server.mjs'],{cwd:path.join(root,directory),env:{...process.env,PORT:String(p)},stdio:['ignore','pipe','pipe']});
  processes.push(child);let log='';child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
  for(let attempts=0;;attempts++){try{const r=await fetch(origin);if(r.ok)break;}catch{}if(attempts>50||child.exitCode!==null)throw Error('Startup failed '+product+' '+log);await new Promise(r=>setTimeout(r,100));}
  await fs.writeFile(path.join(out,product+'-server.txt'),log);sites.push({product,origin});
 }
 browser=await chromium.launch({headless:true});
 for(const site of sites)for(const width of [1280,390,320])for(const lang of ['en','zh-CN']){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),requests=[],errors=[],consoleErrors=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.addInitScript(()=>{globalThis.__walletCalls=0;globalThis.ethereum={request(){globalThis.__walletCalls++;throw Error('Unexpected wallet call');}};});
  await page.goto(site.origin+'/?lang='+lang);await page.waitForFunction(lang=>document.documentElement.lang===lang,lang);await page.waitForLoadState('networkidle');
  assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
  assert.equal(await page.evaluate(()=>globalThis.__walletCalls),0);
  assert.equal(requests.some(x=>/wallet-auth|product-session|\/api\/|\/health|canonical-session/.test(x)),false,'public page must not load account runtime or call services');
  assert.equal(await page.locator('[data-role]').count(),3);const publicConsoleErrors=consoleErrors.length;
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,logo:{width:document.querySelector('.brand img').naturalWidth,height:document.querySelector('.brand img').naturalHeight}}));
  assert.ok(geometry.scroll<=width+1,'no horizontal overflow '+JSON.stringify({site,width,lang,geometry}));assert.ok(geometry.logo.width>0);
  const blank=await page.locator('[data-text]').evaluateAll(nodes=>nodes.filter(n=>!n.textContent.trim()).map(n=>n.dataset.text));assert.deepEqual(blank,[]);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'skip');
  await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.id==='main');assert.equal(await page.evaluate(()=>document.activeElement.id),'main');
  await page.evaluate(()=>document.activeElement.blur());
  await page.screenshot({path:path.join(out,site.product+'-'+width+'-'+lang+'.png'),fullPage:true});
  await page.locator('#site-language').selectOption(lang==='en'?'zh-CN':'en');await page.reload();assert.equal(await page.locator('#site-language').inputValue(),lang==='en'?'zh-CN':'en');
  await page.locator('#site-language').selectOption(lang);
  const app=page.locator('header [data-app]');assert.match(await app.getAttribute('href'),new RegExp('/app.html\\?lang='+lang+'$'));
  await app.click();await page.waitForURL('**/app.html?lang='+lang);await page.locator('[data-media-about]').waitFor();
  await page.goBack();await page.waitForFunction(lang=>document.documentElement.lang===lang,lang);assert.equal(await page.locator('#site-language').inputValue(),lang);
  await page.locator('header [data-app]').click();await page.locator('[data-media-about]').click();await page.waitForFunction(lang=>document.documentElement.lang===lang,lang);await page.reload();assert.equal(await page.locator('#site-language').inputValue(),lang);
  cases.push({product:site.product,width,lang,publicWalletCalls:0,publicAccountRuntimeRequests:0,publicConsoleErrors,geometry,explicitApp:true,backAndRefresh:true});await context.close();
 }
 const zoomCases=[],noScriptCases=[];
 for(const site of sites){
  const context=await browser.newContext({viewport:{width:320,height:900}}),page=await context.newPage();await page.goto(site.origin+'/?lang=zh-CN');await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,text:getComputedStyle(document.body).fontSize}));assert.equal(geometry.text,'32px');assert.ok(geometry.scroll<=321,'200% text overflow '+JSON.stringify({site,geometry}));await page.screenshot({path:path.join(out,site.product+'-320-zh-CN-text200.png'),fullPage:true});zoomCases.push({product:site.product,geometry});await context.close();
  const plain=await browser.newContext({javaScriptEnabled:false}),staticPage=await plain.newPage();await staticPage.goto(site.origin+'/');assert.ok((await staticPage.locator('h1').textContent()).trim());assert.equal(await staticPage.locator('[data-role]').count(),3);assert.match(await staticPage.locator('header [data-app]').getAttribute('href'),/app.html$/);noScriptCases.push({product:site.product,readableWithoutJavaScript:true});await plain.close();
 }
 const routes=[];
 for(const site of sites){const context=await browser.newContext(),page=await context.newPage();
  for(const query of ['?video=old_video&lang=zh-CN','?mediaView=playlists&mediaPlaylist=old_list','#library','?lang=ar']){
   await page.goto(site.origin+'/'+query);await page.waitForURL(site.origin+'/app.html'+query);routes.push({product:site.product,legacy:query,appURL:page.url()});
  }
  for(const p of ['/wallet-auth/callback','/app.html','/media-site.js','/media-site-back.js']){const r=await fetch(site.origin+p);assert.equal(r.status,200,site.product+p);}
  if(site.product!=='music'){const base=site.product==='video'?'/video/':'/video/studio/';const r=await fetch(site.origin+base+'app.html');assert.equal(r.status,200);routes.push({product:site.product,prefix:base+'app.html',status:r.status});}
  await context.close();
 }
 await fs.writeFile(path.join(out,'browser-receipt.json'),JSON.stringify({scope:'actual owned Node Video/Creator servers and Go embedded Music public-only server; no real grant or Host',realWallet:false,formalHost:false,cases,zoomCases,noScriptCases,routes},null,2)+'\n');console.log(JSON.stringify({passed:cases.length,legacyRoutes:routes.length,textZoom:zoomCases.length,noScript:noScriptCases.length}));
}finally{if(browser)await browser.close();for(const p of processes){if(p.exitCode===null)p.kill();}}
})().catch(e=>{console.error(e);process.exitCode=1;});
