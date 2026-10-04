import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../finance/node_modules/playwright/index.mjs';
import {financeBrowserLaunchOptions} from '../../finance/tests/browser-launch-options.mjs';
const root=fileURLToPath(new URL('../web/',import.meta.url));
// Each run retains its own captures; never overwrite committed prior evidence.
const evidence=fs.mkdtempSync(path.join(tmpdir(),'ynx-exchange-ui-product-'));
const locales=['en','zh-Hans','zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id'];
let server,browser,url;
test.before(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  server=http.createServer((req,res)=>{
    const name=path.join(root,new URL(req.url,'http://localhost').pathname);
    const file=name===root?path.join(root,'index.html'):name;
    if(!file.startsWith(root)){res.writeHead(403);res.end();return}
    try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file))}catch{res.writeHead(404,{'Content-Type':'application/json'});res.end('{"code":"LOCAL_UI_SOURCE_ONLY"}')}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch(await financeBrowserLaunchOptions());
});
test.after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));console.log('CONTROLLED LOCAL UI evidence='+evidence)});
async function pageAt(width){const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});await page.goto(url,{waitUntil:'networkidle'});return page}
async function noOverflow(page,label){const m=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:document.documentElement.clientWidth}));assert.ok(m.scroll<=m.width,label+JSON.stringify(m))}

test('real existing source renders all twelve locales at mobile widths and enlarged desktop without losing controls',async()=>{
  const results=[];
  for(const width of [320,390,1440]){
    const page=await pageAt(width);const writes=[];page.on('request',request=>{if(request.method()!=='GET')writes.push(request.url())});
    if(width===1440){await page.locator('#ui-display-label').click();await page.locator('#ui-text-size').selectOption('large');await page.locator('#ui-display-label').click()}
    for(const locale of locales){
      await page.locator('#exchange-language').selectOption(locale);await noOverflow(page,`${width}/${locale}/market `);
      assert.equal(await page.locator('html').getAttribute('dir'),locale==='ar'?'rtl':'ltr');
      assert.equal(await page.locator('#private-status').isVisible(),true);
      assert.equal(await page.locator('[data-exchange-locale="private-scope-help"]').isVisible(),false);
      await page.locator('.account-management summary').click();assert.equal(await page.locator('#private-disconnect').isVisible(),true);assert.equal(await page.locator('[data-exchange-locale="private-scope-help"]').isVisible(),true);await page.locator('.account-management summary').click();
      await page.locator('#connect').click();assert.equal(await page.locator('#wallet-dialog').evaluate(el=>el.open),true);
      for(const id of ['connect-ynx-wallet','connect-hosted-ynx','connect-metamask']){const box=await page.locator('#'+id).boundingBox();assert.ok(box.width>180&&box.height>=76);assert.equal(await page.locator('#'+id).evaluate(el=>getComputedStyle(el,'::before').backgroundImage.includes('ynx-logo')||getComputedStyle(el,'::before').backgroundImage.includes('metamask.svg')),true)}
      const dlg=await page.locator('#wallet-dialog').boundingBox();assert.ok(dlg.x>=0&&dlg.x+dlg.width<=width+1);
      await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:path.join(evidence,`wallet-${width}-${locale}.png`)});await page.keyboard.press('Escape');assert.equal(await page.locator('#wallet-dialog').evaluate(el=>el.open),false);
      for(const view of ['assets','activity','controls','market']){await page.locator(`[data-view="${view}"]`).click();await noOverflow(page,`${width}/${locale}/${view} `)}
      results.push({width,locale,overflow:false,rtl:locale==='ar'});
    }
    assert.deepEqual(writes,[],'ordinary UI navigation cannot create approvals, accounts, signatures or orders');
    await page.locator('#exchange-language').selectOption('en');await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0)});await page.screenshot({path:path.join(evidence,`workspace-${width}.png`),fullPage:true});await page.close();
  }
  fs.writeFileSync(path.join(evidence,'render-matrix.json'),JSON.stringify({scope:'Existing local source; API deliberately unavailable; no Wallet installed/account approval/trading/public deployment proof',results},null,2)+'\n');
});

test('modal native focus trap, close, backdrop and Escape preserve current controls and never request accounts',async()=>{
  const page=await pageAt(390);const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url())});
  await page.locator('#price').fill('12.3');await page.locator('#amount').fill('4.5');
  for(const method of ['close','escape','backdrop']){
    await page.locator('#connect').click();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('#wallet-dialog').contains(document.activeElement)),true);
    if(method==='close')await page.locator('#wallet-dialog .close').click();
    else if(method==='escape')await page.keyboard.press('Escape');
    else await page.mouse.click(2,2);
    assert.equal(await page.locator('#wallet-dialog').evaluate(el=>el.open),false);assert.equal(await page.locator('#connect').evaluate(el=>el===document.activeElement),true);
    assert.equal(await page.locator('#price').inputValue(),'12.3');assert.equal(await page.locator('#amount').inputValue(),'4.5');
  }
  assert.deepEqual(writes,[]);await page.close();
});

test('before and after preserve the exact brand bytes and testnet errors, with no fixture market data',async()=>{
  const page=await pageAt(1440);const mark=await page.locator('.mark').evaluate(el=>({height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,naturalWidth:el.naturalWidth,naturalHeight:el.naturalHeight}));assert.equal(mark.height,23);assert.equal(mark.naturalWidth,798);assert.equal(mark.naturalHeight,420);assert.ok(Math.abs(mark.width/mark.height-798/420)<.01);
  assert.equal(await page.locator('#last-price').textContent(),'—');assert.equal(await page.locator('#private-status').isVisible(),true);assert.match(await page.locator('#private-status').textContent(),/unavailable/);assert.equal(await page.locator('.disclosure').isVisible(),true);
  await page.close();
});

test('standard desktop workspace retains three columns and styled default controls',async()=>{
  const page=await pageAt(1440);const panels=[];for(const selector of ['.chart','.book','.order-entry'])panels.push(await page.locator(selector).boundingBox());assert.ok(panels.every(p=>p&&p.y===panels[0].y));
  for(const selector of ['#private-begin','#private-retry','#connect-ynx-wallet','#wallet-disconnect'])assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).borderRadius==='8px'||getComputedStyle(el).borderRadius==='12px'),true);
  await page.screenshot({path:path.join(evidence,'desktop-standard.png'),fullPage:true});await page.locator('#connect').click();await page.screenshot({path:path.join(evidence,'wallet-desktop-standard.png')});await page.close();
});
