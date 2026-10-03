import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {chromium} from '../../quant-lab/node_modules/playwright/index.mjs';
import {financeBrowserLaunchOptions} from './browser-launch-options.mjs';

const app=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
const transport=app.slice(app.indexOf('function financeProductDocument('),app.indexOf('function scope(path)'));
const exportView=app.slice(app.indexOf('const ownedExportOperations='),app.indexOf('let ownedAIGeneration='));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const reply=(body,mime='application/json',status=200,length=null)=>({ok:status>=200&&status<300,status,headers:{get:key=>key==='content-type'?mime:key==='content-length'?length:null},text:async()=>body});
function fixture(){
  const calls=[],proofs=[],statuses=[],timers=new Map();let next=0;
  const scope={AbortController,TextEncoder,TextDecoder,Blob,URL,location:{href:'https://finance.local/'},state:{context:1},READ_RETRY_DELAYS:[0,600,1600],wait:async()=>{},sourceStatus:(...args)=>statuses.push(args),scope:()=> 'finance.portfolio.read',window:{YNXFinanceWallet:{getRevision:()=>1,requireProof:async()=>{proofs.push(1);return {proofHeader:'controlled-qa-only',requestId:'request-'+proofs.length}}}},fetch:(path,options)=>{const value=deferred();calls.push({path,options,...value});return value.promise},setTimeout:(callback,ms)=>{const id=++next;timers.set(id,{callback,ms});return id},clearTimeout:id=>timers.delete(id)};
  runInNewContext(transport+'globalThis.invoke=api;globalThis.response=financeProductResponse;',scope);
  return {scope,calls,proofs,statuses,timers};
}
test('actual Finance product transport verifies JSON/CSV exports and refuses HTML, wrong type, corrupt JSON and oversized bodies',async()=>{
  for(const [path,text,mime] of [['/api/export?format=json','{"coverageComplete":false}','application/json'],['/api/export','{"coverageComplete":false}','application/json'],['/api/export?format=csv','date,amount\n','text/csv']]){
    const f=fixture(),pending=f.scope.response(path,{responseType:'blob'},()=>{});f.calls[0].resolve(reply(text,mime));const {body}=await pending;assert.equal(await body.text(),text);assert.equal(body.type,mime);assert.equal(f.timers.size,0);
  }
  for(const response of [reply('<html>fallback</html>','text/html'),reply('broken'),reply('{}','text/csv'),reply('{}','application/json',200,'8388609')]){
    const f=fixture(),pending=f.scope.response('/api/export?format=json',{responseType:'blob'},()=>{});f.calls[0].resolve(response);await assert.rejects(pending,{code:'FINANCE_RESPONSE_INVALID',nonRetryable:true});assert.equal(f.timers.size,0);
  }
});
test('only the exact AI cancellation POST accepts an empty 202, never a cancellation result or other empty document',async()=>{
  const path='/api/ai/jobs/owned-job/cancel';
  const f=fixture(),pending=f.scope.response(path,{method:'POST'},()=>{});f.calls[0].resolve(reply('','',202,'0'));
  assert.equal((await pending).body,null);assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  for(const [url,method,response] of [
    [path,'GET',reply('','',202)],['/api/overview','POST',reply('','',202)],
    [path+'?other=1','POST',reply('','',202)],[path,'POST',reply('{}','application/json',202)],
    [path,'POST',reply(' ','',202)],[path,'POST',reply('','',202,'1')],
    [path,'POST',reply('','',200)],
  ]){
    const f=fixture(),pending=f.scope.response(url,{method},()=>{});f.calls[0].resolve(response);
    await assert.rejects(pending,{code:'FINANCE_RESPONSE_INVALID'});assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  }
});
test('ambiguous financial JSON never materializes duplicate balances, privacy choices or escaped aliases',async()=>{
  for(const body of ['{"balanceYnxt":1,"balanceYnxt":999999}', '{"profile":{"privacy":{"alertsEnabled":false,"alertsEnabled":true}}}', '{"account":"owner-a","\\u0061ccount":"owner-b"}', '['.repeat(66)+'0'+']'.repeat(66)]){
    const f=fixture(),pending=f.scope.response('/api/overview',{},()=>{});f.calls[0].resolve(reply(body));
    await assert.rejects(pending,{code:'FINANCE_RESPONSE_INVALID'});assert.equal(f.calls.length,1);assert.equal(f.timers.size,0);
  }
  const f=fixture(),pending=f.scope.response('/api/overview',{},()=>{});
  f.calls[0].resolve(reply('{"rows":[{"balanceYnxt":1},{"balanceYnxt":2}],"label":"中文 \\\" quoted","nested":{"alertsEnabled":true}}'));
  assert.deepEqual(JSON.parse(JSON.stringify((await pending).body)),{rows:[{balanceYnxt:1},{balanceYnxt:2}],label:'中文 " quoted',nested:{alertsEnabled:true}});
});
test('real Chrome rejects duplicate fields from native streamed financial responses and recovers without Wallet mutation',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setContent('<p>Controlled native Finance document QA</p>');
    await page.addScriptTag({content:`const state={context:1},READ_RETRY_DELAYS=[0],wait=async()=>{},sourceStatus=()=>{},scope=()=> 'finance.portfolio.read';window.YNXFinanceWallet={getRevision:()=>1};${transport}`});
    const result=await page.evaluate(async()=>{
      let reads=0;const outcomes=[];window.controlledStandard={status:'connected',account:'isolated-test-owner'};
      for(const text of ['{"portfolio":{"balanceYnxt":1,"balanceYnxt":999999}}','{"portfolio":{"balanceYnxt":1},"label":"中文"}']){
        const bytes=new TextEncoder().encode(text);
        const fetchImpl=async()=>{reads++;return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,12));controller.enqueue(bytes.slice(12));controller.close()}}),{headers:{'content-type':'application/json'}})};
        try{const {body}=await financeProductResponse('/api/overview',{},()=>{},{fetchImpl});outcomes.push(body)}catch(error){outcomes.push(error.code)}
      }
      return {outcomes,reads,standard:window.controlledStandard};
    });
    assert.deepEqual(result,{outcomes:['FINANCE_RESPONSE_INVALID',{portfolio:{balanceYnxt:1},label:'中文'}],reads:2,standard:{status:'connected',account:'isolated-test-owner'}});assert.deepEqual(errors,[]);assert.equal(page.context().pages().length,1);
  }finally{await browser.close()}
});
test('actual API write timeout covers stalled fetch and stalled body, unlocks without replay, and ignores a late result',async()=>{
  for(const phase of ['fetch','body']){
    const f=fixture(),body=deferred(),pending=f.scope.invoke('/api/notes',{method:'POST',body:'{}'});await new Promise(setImmediate);
    if(phase==='body'){f.calls[0].resolve({...reply('{}'),text:()=>body.promise});await new Promise(setImmediate)}
    const timer=[...f.timers.values()][0];assert.equal(timer.ms,10000);timer.callback();await assert.rejects(pending,{code:'FINANCE_REQUEST_TIMEOUT'});
    assert.equal(f.calls.length,1);assert.equal(f.proofs.length,1);assert.equal(f.calls[0].options.signal.aborted,true);assert.equal(f.timers.size,0);
    if(phase==='fetch')f.calls[0].resolve(reply('{}'));else body.resolve('{}');await new Promise(setImmediate);assert.equal(f.calls.length,1);assert.equal(f.statuses.some(([key])=>key==='privateFinanceReachable'),false);
  }
});
test('GET retry remains bounded, gets fresh proofs, and malformed HTTP 200 never becomes reachable',async()=>{
  const f=fixture(),pending=f.scope.invoke('/api/overview');
  for(let i=0;i<3;i++){await new Promise(setImmediate);f.calls[i].resolve(reply('{"error":"temporarily unavailable"}','application/json',503))}
  await assert.rejects(pending,{status:503});assert.equal(f.proofs.length,3);assert.equal(f.calls.length,3);assert.equal(f.timers.size,0);
  const invalid=fixture(),bad=invalid.scope.invoke('/api/overview');await new Promise(setImmediate);invalid.calls[0].resolve(reply('<html>','text/html'));await assert.rejects(bad,{code:'FINANCE_RESPONSE_INVALID'});assert.equal(invalid.calls.length,1);assert.equal(invalid.statuses.some(([key])=>key==='privateFinanceReachable'),false);
});
test('old-account response after stalled parsing fails context fence before any private success',async()=>{
  const f=fixture(),body=deferred(),pending=f.scope.invoke('/api/overview');await new Promise(setImmediate);f.calls[0].resolve({...reply('{}'),text:()=>body.promise});await new Promise(setImmediate);f.scope.state.context++;body.resolve('{"old":"private"}');await assert.rejects(pending,{nonRetryable:true});assert.equal(f.calls.length,1);assert.equal(f.statuses.some(([key])=>key==='privateFinanceReachable'),false);
});
test('native streams cancel oversized, malformed UTF8, deadline and retired-owner bodies without read replay',async()=>{
  for(const kind of ['oversize','utf8','truncated','deadline','owner']){
    const f=fixture();let cancels=0,reads=0,streamController;
    const response=new Response(new ReadableStream({start(controller){streamController=controller},pull(controller){reads++;if(kind==='oversize')controller.enqueue(new Uint8Array(8388609));else if(kind==='utf8'){controller.enqueue(new Uint8Array([255]));controller.close()}else if(kind==='truncated'){controller.enqueue(new Uint8Array([228,184]));controller.close()}},cancel(){cancels++}}),{headers:{'content-type':'application/json'}});
    const pending=f.scope.invoke('/api/notes',{method:'POST',body:'{}'});pending.catch(()=>{});await new Promise(setImmediate);f.calls[0].resolve(response);await new Promise(setImmediate);
    if(kind==='deadline'||kind==='owner'){
      if(kind==='owner'){f.scope.state.context++;streamController.enqueue(new TextEncoder().encode('{}'))}
      else [...f.timers.values()][0].callback();
    }
    await assert.rejects(pending,error=>error.code==='FINANCE_RESPONSE_INVALID'||error.code==='FINANCE_REQUEST_TIMEOUT'||error.nonRetryable===true);
    assert.equal(cancels,kind==='utf8'||kind==='truncated'?0:1);if(kind==='oversize')assert.ok(reads<=2);assert.equal(f.calls.length,1);assert.equal(f.proofs.length,1);assert.equal(f.timers.size,0);assert.equal(f.statuses.some(([key])=>key==='privateFinanceReachable'),false);
  }
  const f=fixture(),bytes=new TextEncoder().encode('{"label":"中文"}'),response=new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,11));controller.enqueue(bytes.slice(11));controller.close()}}),{headers:{'content-type':'application/json'}});
  const pending=f.scope.response('/api/overview',{},()=>{});f.calls[0].resolve(response);assert.deepEqual(JSON.parse(JSON.stringify((await pending).body)),{label:'中文'});
  for(const length of ['-1','1.5','8388609','9007199254740992']){
    const f=fixture(),pending=f.scope.response('/api/overview',{},()=>{});f.calls[0].resolve(new Response('{}',{headers:{'content-type':'application/json','content-length':length}}));await assert.rejects(pending,{code:'FINANCE_RESPONSE_INVALID'});assert.equal(f.timers.size,0);
  }
});
test('actual Chrome native JSON and CSV streams decode split UTF8 and discard old-owner chunks',async()=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  try{
    const page=await browser.newPage();await page.setContent('<p>Controlled Finance response QA</p>');
    await page.addScriptTag({content:`const state={context:1};const READ_RETRY_DELAYS=[0],wait=async()=>{},sourceStatus=()=>{},scope=()=> 'finance.portfolio.read';window.YNXFinanceWallet={getRevision:()=>1};${transport}`});
    const result=await page.evaluate(async()=>{
      const outcomes=[];
      for(const [path,mime,text] of [['/api/export?format=csv','text/csv','label,amount\n中文,1\n'],['/api/export?format=json','application/json','{"label":"中文"}']]){
        const bytes=new TextEncoder().encode(text),split=bytes.indexOf(228)+1;
        const fetchImpl=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));controller.close()}}),{headers:{'content-type':mime}});
        const {body}=await financeProductResponse('https://finance-controlled.test'+path,{responseType:'blob'},()=>{},{fetchImpl});outcomes.push(await body.text());
      }
      let cancels=0;
      const fetchImpl=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{}'))},cancel(){cancels++}}),{headers:{'content-type':'application/json'}});
      let error,checks=0;try{await financeProductResponse('/api/overview',{},()=>{if(++checks===3)throw Object.assign(new Error('retired'),{nonRetryable:true})},{fetchImpl})}catch(value){error=value.message}
      return {outcomes,error,cancels};
    });
    assert.deepEqual(result.outcomes,['label,amount\n中文,1\n','{"label":"中文"}']);assert.equal(result.error,'retired');assert.equal(result.cancels,1);
  }finally{await browser.close()}
});
test('actual Chrome export rejects HTML fallback, recovers with explicit retry and emits only verified JSON bytes',{timeout:20000},async t=>{
  const browser=await chromium.launch(await financeBrowserLaunchOptions());
  t.diagnostic('browser launched');
  try{
    const page=await browser.newPage({acceptDownloads:true}),downloads=[],errors=[];page.on('download',value=>downloads.push(value.suggestedFilename()));page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.abort());
    await page.route('https://finance-export.local/',route=>route.fulfill({contentType:'text/html',body:'<button id="export-json">Export</button>'}));
    await page.goto('https://finance-export.local/');
    t.diagnostic('controlled document loaded');
    await page.addScriptTag({content:`const state={context:1};let browserSSOIntentGeneration=1;const $=s=>document.querySelector(s),$$=s=>Array.from(document.querySelectorAll(s));const READ_RETRY_DELAYS=[0,0,0],wait=async()=>{},sourceStatus=()=>{},scope=()=> 'finance.portfolio.read';window.YNXFinanceWallet={getRevision:()=>1,requireProof:async()=>({proofHeader:'controlled-only',requestId:'controlled'})};window.calls=[];window.failures=[];const notifyFailure=error=>failures.push(error.code);window.fetch=()=>new Promise(resolve=>calls.push(resolve));${transport}${exportView}window.complete=(text,mime)=>calls.shift()({ok:true,status:200,headers:new Headers({'content-type':mime}),text:async()=>text});`});
    await page.locator('#export-json').click();await page.evaluate(()=>complete('<html>not export</html>','text/html'));await page.waitForFunction(()=>failures.length===1);assert.deepEqual(downloads,[]);assert.equal(await page.evaluate(()=>ownedExportOperations.size),0);
    t.diagnostic('HTML refusal observed');
    await page.locator('#export-json').click();t.diagnostic('explicit retry clicked');await page.waitForFunction(()=>calls.length===1,{},{timeout:5000});assert.deepEqual(errors,[]);
    const downloaded=page.waitForEvent('download',{timeout:5000});downloaded.catch(()=>{});await page.evaluate(()=>complete('{"coverageComplete":false}','application/json'));t.diagnostic(JSON.stringify(await page.evaluate(()=>({failures,pending:ownedExportOperations.size}))));const result=await downloaded;assert.equal(result.suggestedFilename(),'ynx-finance-observed-export.json');assert.equal(await result.failure(),null);assert.equal(await readFile(await result.path(),'utf8'),'{"coverageComplete":false}');assert.equal(await page.evaluate(()=>ownedExportOperations.size),0);assert.equal(downloads.length,1);
  }finally{await browser.close()}
});
