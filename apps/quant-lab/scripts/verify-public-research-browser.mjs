// One explicit historical CPU-only research submission. Never permits other
// writes, private authorization, signing, Paper orders or capital execution.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const {chromium}=createRequire(new URL('../tests/business-flow.test.mjs',import.meta.url))('playwright');
const origin='https://quant.ynxweb4.com',endpoint='/api/v1/public/research/backtests/from-market';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.argv.length!==3||process.argv[2]!=='--run-stateless')throw Error('Explicit --run-stateless required; one historical CPU research request only.');
async function publicJSON(path){
  const response=await fetch(origin+path,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(10000)}),bytes=Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length<=262144);assert.match(response.headers.get('content-type')||'',/application\/json/);
  return {receipt:{path,status:response.status,bytes:bytes.length,sha256:hash(bytes)},value:JSON.parse(bytes)};
}
const version=await publicJSON('/api/version'),status=await publicJSON('/api/v1/public/status');
assert.equal(status.receipt.status,200);assert.equal(status.value.mode,'public_stateless_research');
assert.equal(status.value.capabilities.research,true);assert.equal(status.value.capabilities.paper,false);assert.equal(status.value.capabilities.testnetExecution,false);assert.equal(status.value.capabilities.liveFunds,false);assert.equal(status.value.marketData.synthetic,false);
console.log(JSON.stringify({kind:'PUBLIC_BROWSER_PREFLIGHT',observedAt:new Date().toISOString(),version:version.value,versionReceipt:version.receipt,statusReceipt:status.receipt}));
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[],requests=[],blocked=[];let submissions=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{const url=new URL(request.url());requests.push({method:request.method(),origin:url.origin,path:url.pathname})});
  await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET')return route.continue();
    if(request.method()==='POST'&&url.origin===origin&&url.pathname===endpoint&&submissions===0){submissions++;return route.continue()}
    blocked.push({method:request.method(),origin:url.origin,path:url.pathname});return route.abort();
  });
  await page.goto(origin,{waitUntil:'domcontentloaded',timeout:20000});
  // Permit the current public identity-only silent recovery to settle, without
  // clicking any sign-in/Wallet/account control. Retain its observed path trace.
  await page.waitForTimeout(3500);
  const initialURL=page.url();
  const responsePromise=page.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname===endpoint&&response.request().method()==='POST',{timeout:20000});
  await page.locator('#strategy').fill('Public browser CPU research verification');
  await page.locator('#backtest button.primary').click();
  const response=await responsePromise,bytes=await response.body(),request=JSON.parse(response.request().postData()),result=JSON.parse(bytes);
  const responseReceipt={kind:'PUBLIC_BROWSER_CPU_RESPONSE',status:response.status(),bytes:bytes.length,sha256:hash(bytes),submissions};
  // Persist in tool stdout before DOM checks: a later verifier failure must not
  // erase proof of an already executed CPU request or invite automatic retry.
  console.log(JSON.stringify(responseReceipt));
  assert.equal(response.status(),201);assert.equal(result.status,'completed_oos');assert.equal(result.strategy.ID,request.strategy.id);assert.equal(result.strategy.Name,request.strategy.name);
  for(const [key,value] of Object.entries(request.assumptions))assert.equal(result.assumptions[key[0].toUpperCase()+key.slice(1)],value);
  let visible=false;try{await page.waitForFunction(()=>document.querySelector('#latest-result')?.hidden===false,{},{timeout:5000});visible=true}catch{}
  const dom=await page.evaluate(()=>({language:document.documentElement.lang,latestHidden:document.querySelector('#latest-result')?.hidden,return:document.querySelector('#result-return')?.textContent,sharpe:document.querySelector('#result-sharpe')?.textContent,toast:document.querySelector('#toast')?.textContent,chartLines:document.querySelectorAll('#equity-chart polyline').length,leakage:document.querySelector('#research')?.textContent?.includes('First 50%')}));
  const report={kind:'PUBLIC_BROWSER_CPU_FLOW',observedAt:new Date().toISOString(),sourceCommit:version.value.commit,initialURL,finalURL:page.url(),tabs:context.pages().length,responseReceipt,id:result.id,source:result.strategy.Source,split:result.strategy.Split,metrics:result.metrics,equityPoints:result.equityCurve?.length,dom,errors,requests,blocked,publicCPUAPIConfirmed:true,visibleResultConfirmed:visible,privateWorkspaceVerified:false,walletApprovalVerified:false,signaturesVerified:false,paperOrdersSubmitted:false,testnetOrdersSubmitted:false,nativeInstallVerified:false};
  console.log(JSON.stringify(report,null,2));
  assert.equal(submissions,1);assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);assert.equal(context.pages().length,1);assert.equal(page.url(),initialURL);
  assert.equal(visible,true,'public CPU result received but result panel did not become visible');
  assert.equal(dom.return,`${result.metrics.ReturnBPS} bps`);assert.equal(dom.sharpe,(result.metrics.SharpeMilli/1000).toFixed(3));
}finally{await browser.close()}
