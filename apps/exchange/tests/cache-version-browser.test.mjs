import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';

const web=new URL('../web/',import.meta.url);
const oldHTML=execFileSync('git',['show','a2ac7f196d4aff9951b9ae94e27d8fde446859f0:apps/exchange/web/index.html'],{encoding:'utf8'});
const oldApp=execFileSync('git',['show','a2ac7f196d4aff9951b9ae94e27d8fde446859f0:apps/exchange/web/app.js'],{encoding:'utf8'});

test('normal browser cache retains old Exchange module but fresh HTML loads hash-bound wallet and full module graph',async()=>{
  let mode='old';const requested=[],methods=[],errors=[];
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://localhost');requested.push(request.url);methods.push(request.method);
    if(url.pathname.startsWith('/api/')){response.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});return response.end('{"code":"LOCAL_SOURCE_FIXTURE_UNAVAILABLE"}');}
    if(url.pathname==='/'){response.writeHead(200,{'content-type':'text/html','cache-control':'no-store'});return response.end(mode==='old'?oldHTML:await readFile(new URL('index.html',web)));}
    const name=url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/u.test(name)){response.writeHead(404);return response.end();}
    try{
      const body=mode==='old'&&name==='app.js'?Buffer.from(oldApp):await readFile(new URL(name,web));
      response.writeHead(200,{'content-type':name.endsWith('.css')?'text/css':'text/javascript','cache-control':'public, max-age=3600'});response.end(body);
    }catch{response.writeHead(404);response.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({headless:true,executablePath:process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined});
    const context=await browser.newContext();const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));const base=`http://127.0.0.1:${server.address().port}`;
    await page.goto(base,{waitUntil:'load'});
    assert.match(await page.evaluate(async()=>await(await fetch('/app.js')).text()),/from '\.\/market-data\.js'/u);
    mode='new';requested.length=0;methods.length=0;errors.length=0;await page.reload({waitUntil:'load'});
    const currentApp=await readFile(new URL('app.js',web),'utf8');
    assert.match(await page.evaluate(async()=>await(await fetch('/app.js')).text()),/from '\.\/market-data\.js'/u,'old unversioned asset remains cached');
    const script=await page.locator('script[type="module"]').getAttribute('src');assert.match(script,/^\/app\.js\?v=[0-9a-f]{64}$/u);
    assert.equal(await page.evaluate(async src=>await(await fetch(src)).text(),script),currentApp);
    // A hash-identical dependency may already be cached from another module on
    // the old page. Network-request count is not proof of browser-loaded bytes.
    // Keep normal cache enabled and verify every actual versioned response.
    for(const name of ['wallet-connect.js','app.js','market-data.js','order-preview.js','private-session.js','styles.css','locale.js','ui-preferences.js']){
      const expected=await readFile(new URL(name,web),'utf8');
      const digest=createHash('sha256').update(expected).digest('hex');
      const url='/'+name+'?v='+digest;
      assert.ok((name.endsWith('.css')||['wallet-connect.js','app.js','ui-preferences.js'].includes(name)?await page.content():currentApp).includes(url)||currentApp.includes('./'+name+'?v='+digest),`source graph lacks exact pin: ${name}`);
      const observed=await page.evaluate(async url=>{const response=await fetch(url);return {status:response.status,body:await response.text(),url:new URL(response.url).pathname+new URL(response.url).search}},url);
      assert.equal(observed.status,200,name);assert.equal(observed.url,url,name);assert.equal(observed.body,expected,`normal-cache bytes mismatch: ${name}`);
    }
    assert.ok(requested.includes('/api/v1/market-data/snapshot'),'actual module graph ran the public read without Wallet approval');
    assert.deepEqual(errors,[],'current module graph has no uncaught runtime errors');
    assert.ok(methods.every(method=>method==='GET'),'normal guest cache recovery sends no writes');
    assert.equal(await page.url(),base+'/');
    await context.close();
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
