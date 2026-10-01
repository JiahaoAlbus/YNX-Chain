// Invoked by the Go Finance SSO test against its real /sso/start handler.
// Ephemeral browser, all other origins intercepted; no wallet/account writes.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {createCentralBrowserSessionRegistry} from '../../../packages/wallet-auth/src/central-browser-session-registry.js';
import {CentralBrowserSessionStore} from '../../../packages/wallet-auth/src/central-browser-session-store.js';
import {CentralBrowserSessionAuthority,CentralBrowserSessionNodeRoutes} from '../../../packages/wallet-auth/src/central-browser-session.js';
const product='https://finance.ynxweb4.com',issuer='https://wallet-auth.ynxweb4.com',directory=await mkdtemp(join(tmpdir(),'ynx-locale-flow-'));
const registry=createCentralBrowserSessionRegistry(JSON.parse(await readFile(new URL('../../../packages/wallet-auth/product-session-registry.json',import.meta.url))));
const routes=new CentralBrowserSessionNodeRoutes(new CentralBrowserSessionAuthority(registry,new CentralBrowserSessionStore(join(directory,'state'))));
const compile=async file=>(await build({entryPoints:[new URL(file,import.meta.url).pathname],bundle:true,write:false,platform:'browser',target:'es2022'})).outputFiles[0].text;
const [finance,central]=await Promise.all([compile('../web/wallet-auth-entry.js'),compile('../../../packages/wallet-auth/src/central-browser-session-browser.js')]);
const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext({locale:'en-US',serviceWorkers:'block'});let startLanguage;
  await context.route('**/*',route=>route.abort());
  await context.route(product+'/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/sso/start'){startLanguage=url.searchParams.get('lang');const response=await route.fetch({url:process.argv[2]+url.search,maxRedirects:0});const destination=response.headers().location;assert.equal(new URL(destination).origin,issuer);
      // Playwright does not rematch redirected navigation routes. Convert only
      // this fixture's real Go 303 into a separate navigation to the identical
      // untouched URL, so public issuer requests cannot escape interception.
      return route.fulfill({status:200,headers:{'set-cookie':response.headers()['set-cookie'],'content-type':'text/html'},body:'<script>location.replace('+JSON.stringify(destination)+')</script>'});}
    if(url.pathname==='/sso/callback')return route.fulfill({body:'Returned to Finance'});
    if(url.pathname==='/wallet-auth.js')return route.fulfill({contentType:'text/javascript',body:finance});
    if(['/app.js','/finance-locale.js'].includes(url.pathname))return route.fulfill({contentType:'text/javascript',body:await readFile(new URL('../web'+url.pathname,import.meta.url),'utf8')});
    if(url.pathname.endsWith('.js'))return route.fulfill({body:'',contentType:'text/javascript'});
    if(url.pathname==='/')return route.fulfill({body:await readFile(new URL('../web/index.html',import.meta.url),'utf8'),contentType:'text/html'});
    return route.fulfill({status:url.pathname==='/api/sso/config'?200:401,contentType:'application/json',body:JSON.stringify(url.pathname==='/api/sso/config'?{enabled:true,silentRestoreAllowed:false}:{code:'UNAUTHORIZED'})});
  });
  await context.route(issuer+'/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/sso/browser.js')return route.fulfill({body:central,contentType:'text/javascript'});
    const response=routes.handle({method:request.method(),url:url.href,headers:await request.allHeaders(),body:request.postData()??''});
    return route.fulfill({status:response.status,headers:response.headers,body:response.body});
  });
  const page=await context.newPage();await page.goto(product+'/');await page.evaluate(()=>YNXFinanceWallet.ready);await page.locator('#finance-language').selectOption('zh-CN');await page.locator('#browser-signin-start').click();
  await page.waitForURL(issuer+'/**');await page.locator('#language').waitFor();assert.equal(startLanguage,'zh-CN');
  assert.equal(await page.locator('html').getAttribute('lang'),'zh-CN');assert.equal(await page.locator('h1').innerText(),'使用 YNX Wallet 登录');assert.match(await page.locator('#requesting-site').innerText(),/finance\.ynxweb4\.com/);assert.match(await page.locator('#status').innerText(),/钱包/);
  assert.deepEqual([...new URL(page.url()).searchParams.keys()].sort(),['clientId','codeChallenge','codeChallengeMethod','origin','redirectUri','state']);
  await page.locator('#language').selectOption('zh-Hant');assert.equal(await page.locator('#cancel').innerText(),'取消');assert.equal(await page.locator('h1').innerText(),'使用 YNX Wallet 登入');
  await page.locator('#language').selectOption('en');assert.equal(await page.locator('#cancel').innerText(),'Cancel');assert.equal(await page.locator('h1').innerText(),'Sign in with YNX Wallet');
  await page.locator('#cancel').click();try{await page.waitForURL(product+'/sso/callback?**',{timeout:3000});}catch(error){throw new Error(JSON.stringify(await page.evaluate(()=>({path:location.pathname,code:document.querySelector('#status')?.dataset.errorCode,phase:document.querySelector('#status')?.dataset.phase,status:document.querySelector('#status')?.textContent}))));}const returned=new URL(page.url());assert.equal(returned.searchParams.get('error'),'access_denied');assert.equal(returned.searchParams.has('code'),false);
  await context.close();
}finally{await browser.close();await rm(directory,{recursive:true,force:true});}
