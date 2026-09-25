import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';

const web=new URL('../web/',import.meta.url);
const oldHTML=execFileSync('git',['show','a2ac7f196d4aff9951b9ae94e27d8fde446859f0:apps/exchange/web/index.html'],{encoding:'utf8'});
const oldApp=execFileSync('git',['show','a2ac7f196d4aff9951b9ae94e27d8fde446859f0:apps/exchange/web/app.js'],{encoding:'utf8'});

test('normal browser cache retains old Exchange module but fresh HTML loads hash-bound wallet and full module graph',async()=>{
  let mode='old';const requested=[];
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url,'http://localhost');requested.push(request.url);
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
    const context=await browser.newContext();const page=await context.newPage();const base=`http://127.0.0.1:${server.address().port}`;
    await page.goto(base,{waitUntil:'load'});
    assert.match(await page.evaluate(async()=>await(await fetch('/app.js')).text()),/from '\.\/market-data\.js'/u);
    mode='new';requested.length=0;await page.reload({waitUntil:'load'});
    const currentApp=await readFile(new URL('app.js',web),'utf8');
    assert.match(await page.evaluate(async()=>await(await fetch('/app.js')).text()),/from '\.\/market-data\.js'/u,'old unversioned asset remains cached');
    const script=await page.locator('script[type="module"]').getAttribute('src');assert.match(script,/^\/app\.js\?v=[0-9a-f]{64}$/u);
    assert.equal(await page.evaluate(async src=>await(await fetch(src)).text(),script),currentApp);
    for(const name of ['wallet-connect.js','app.js','market-data.js','order-preview.js','private-session.js','styles.css'])assert.ok(requested.some(url=>new RegExp(`^/${name.replace('.','\\.')}\\?v=[0-9a-f]{64}$`,'u').test(url)),`fresh versioned request missing: ${name}`);
    assert.equal(await page.url(),base+'/');
    await context.close();
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
