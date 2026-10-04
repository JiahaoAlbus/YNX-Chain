import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

test('actual local Chrome preserves Paper drafts through refresh and twelve languages until explicit recovery',{timeout:20000},async()=>{
  const web=new URL('../web/',import.meta.url),hash='d'.repeat(64),tenant='a'.repeat(64),key='ynx.quant.paper.pending.v1:'+tenant;
  let writes=0,reads=0;
  const server=createServer(async(request,response)=>{
    if(request.method!=='GET'){writes++;response.writeHead(405).end();return;}
    const url=new URL(request.url,'http://local.invalid');
    if(url.pathname==='/api/v1/snapshot'){reads++;response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({access:{statefulPreview:true},strategies:{saved:{Name:'Saved',StrategyHash:hash}},experiments:{},paper:{},audit:[]}));return;}
    if(url.pathname.startsWith('/api/')){response.writeHead(503,{'content-type':'application/json'}).end('{"code":"CONTROLLED_LOCAL_READ_UNAVAILABLE"}');return;}
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(name)){response.writeHead(404).end();return;}
    try{response.writeHead(200,{'content-type':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'}).end(await readFile(new URL(name,web)));}catch{response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
    for(const width of [390,1280])for(const versioned of [false,true]){
      const context=await browser.newContext({viewport:{width,height:844}});
      try{
        const intent={StrategyHash:hash,Side:'buy',Amount:1000000,IdempotencyKey:'quant-paper-11111111-1111-4111-8111-111111111111',...(versioned?{ExecutionCosts:{Policy:'adverse_price_ceil_fee_micro_v1',FeeBPS:10,SlippageBPS:5}}:{})},raw=JSON.stringify(intent);
        await context.addInitScript(({tenant,key,raw})=>{localStorage.setItem('ynx.quant.tenant.v1',tenant);localStorage.setItem(key,raw);},{tenant,key,raw});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base,{waitUntil:'networkidle'});assert.equal(await page.locator('#paper-strategy').inputValue(),hash);
        await page.evaluate(()=>{
          $('#paper-strategy').value='';$('#paper-strategy').onchange();$('#side').value='sell';$('#paper-amount').value='2000000';
        });
        await page.evaluate(versioned=>{$('#paper-cost-model').value=versioned?'legacy':'v1';$('#paper-cost-fee').value='99';$('#paper-cost-slippage').value='88';},versioned);
        for(const language of ['en','zh-CN','zh-TW','ja','ko','es','fr','de','pt','ru','ar','id']){
          await page.selectOption('#locale',language);await page.evaluate(()=>$('#refresh').onclick());
          assert.deepEqual(await page.evaluate(key=>({strategy:$('#paper-strategy').value,side:$('#side').value,amount:$('#paper-amount').value,model:$('#paper-cost-model').value,fee:$('#paper-cost-fee').value,slip:$('#paper-cost-slippage').value,journal:localStorage.getItem(key)}),key),{strategy:'',side:'sell',amount:'2000000',model:versioned?'legacy':'v1',fee:'99',slip:'88',journal:raw});
        }
        await page.evaluate(()=>paperRestoreButton.onclick());
        assert.equal(await page.locator('#paper-strategy').inputValue(),hash);assert.equal(await page.locator('#side').inputValue(),'buy');assert.equal(await page.locator('#paper-amount').inputValue(),'1000000');
        assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),raw);assert.equal(context.pages().length,1);assert.equal(page.url(),base+'/');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    }
    assert.equal(writes,0);assert.ok(reads>=52);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
