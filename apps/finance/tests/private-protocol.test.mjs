import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {ProductSessionGatewayHttpHandler,signProductSessionApproval,createProductSessionReturnURL,canonicalJSON} from './fixtures/wallet-test-kernel-9840ef87.mjs';

// OFFLINE ONLY. Real browser WebCrypto/IndexedDB plus the unchanged official
// Gateway kernel. Disposable scalar 1/2 accounts are local test fixtures. No
// network, installed Wallet, user key, public approval or transaction is used.
const ORIGIN='https://finance.ynxweb4.com',AUTH='https://wallet-auth.ynxweb4.com';
const registry=JSON.parse(await readFile(new URL('../web/vendor/product-session-registry-a7dad7ec.json',import.meta.url),'utf8'));
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
test.after(async()=>browser.close());
async function setup(){
  const context=await browser.newContext();const calls=[];let revokeOffline=false;
  const kernel=new ProductSessionGatewayHttpHandler(registry,()=>randomBytes(32).toString('base64url'));
  function authority(path,method,body,proofHeader,requestId){return kernel.handle({requestId,method,path,contentType:'application/json',body:body??'{}',proofHeader:proofHeader??null,networkAvailable:true},new Date());}
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===AUTH){
      const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'x-request-id, content-type, x-ynx-product-session-proof-v2','access-control-expose-headers':'x-request-id, cache-control'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
      // The official Node host, not the kernel, owns the read-only clock route.
      if(url.pathname==='/v2/product-sessions/time'){const requestId=request.headers()['x-request-id'];return route.fulfill({status:200,headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonicalJSON({ok:true,requestId,result:{serverTime:new Date().toISOString()},schemaVersion:2})});}
      if(revokeOffline&&url.pathname.endsWith('/revoke'))return route.abort('failed');
      const result=authority(url.pathname,request.method(),request.postData(),request.headers()['x-ynx-product-session-proof-v2'],request.headers()['x-request-id']);
      calls.push({path:url.pathname,status:result.status});return route.fulfill({status:result.status,headers:{...cors,...result.headers},body:result.body});
    }
    assert.equal(url.origin,ORIGIN,'external network not authorized in local test');
    if(url.pathname==='/health')return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,chainId:'ynx_6423-1',portfolio:'read-only'})});
    if(url.pathname.startsWith('/api/')){
      const requiredScopes=['finance.portfolio.read'];
      const result=authority('/v2/product-sessions/introspect','POST',canonicalJSON({requiredScopes}),request.headers()['x-ynx-product-session-proof-v2'],'req_finance_test_'+randomBytes(16).toString('hex'));
      calls.push({path:url.pathname,status:result.status});if(result.status!==200)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Local authoritative proof rejected'})});
      const account=JSON.parse(result.body).result.session.account;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({portfolio:{account,activity:[],payReceipts:[],explorerStatus:{available:false,error:'Explicit offline test fixture'},payStatus:{available:false,error:'Explicit offline test fixture'}},profile:{categories:[],budgets:[],reminders:[],privacy:{}},budgetProgress:[],alerts:[],support:{helpUrl:ORIGIN,privacyUrl:ORIGIN,disputeUrl:ORIGIN}})});
    }
    const file=url.pathname==='/'||url.pathname==='/wallet-auth/callback'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file))return route.fulfill({status:404,body:''});
    try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../web/'+file,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();await page.goto(ORIGIN);await page.evaluate(()=>window.YNXFinanceWallet.ready);
  return {context,page,kernel,calls,authority,offline:value=>{revokeOffline=value;}};
}
async function approve(f,secret='1'){
  await f.page.locator('#private-begin').click();try{await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='connecting',{},{timeout:3000});}catch(error){throw new Error(JSON.stringify({state:await f.page.evaluate(()=>window.YNXFinanceWallet.getPrivateState()),notice:await f.page.locator('#private-state').textContent(),calls:f.calls}),{cause:error});}
  const uri=await f.page.locator('#private-open').getAttribute('href');const request=JSON.parse(Buffer.from(new URL(uri).searchParams.get('request'),'base64url').toString('utf8'));
  const now=new Date();const approval=signProductSessionApproval(registry,request,{accountSecret:secret.padStart(64,'0'),scopes:request.scopes,expiresAt:new Date(now.getTime()+180000).toISOString()},now);
  const callback=createProductSessionReturnURL(registry,request,{result:'approved',approval},now);
  await f.page.goto(callback);await f.page.waitForFunction(()=>window.YNXFinanceWallet.connected(),{},{timeout:10000});return {request,callback,account:approval.account};
}

test('offline test kernel and browser SDK are exact source artifacts',async()=>{
  for(const [path,bytes,hash] of [['fixtures/wallet-test-kernel-9840ef87.mjs',119170,'5f711edad9a4ade05d3bc2353ac989ae4c1465cfb79b50e4bc600f1af4f70bd1'],['../web/vendor/product-session-browser-a7dad7ec.mjs',223235,'16b0d677ec21e84b5ce425138f175c37e1ac6d319db7fe5a85926b276dccd336']]){const data=await readFile(new URL(path,import.meta.url));assert.equal(data.length,bytes);assert.equal(createHash('sha256').update(data).digest('hex'),hash);}
});
test('official local approval completes exact callback, fresh API proof, replay rejection, refresh and revocation retry',async()=>{
  const f=await setup();try{
    const approved=await approve(f);assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.session())).account,approved.account);
    assert.equal(f.calls.some(c=>c.path==='/v2/product-sessions/challenge'&&c.status===200),true);assert.equal(f.calls.some(c=>c.path==='/v2/product-sessions/complete'&&c.status===200),true);
    const proof=await f.page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read'));
    assert.equal(proof.body,'{"requiredScopes":["finance.portfolio.read"]}');
    const first=f.authority('/v2/product-sessions/introspect','POST',proof.body,proof.proofHeader,'req_finance_test_consume_001');assert.equal(first.status,200,first.body);
    const replay=f.authority('/v2/product-sessions/introspect','POST',proof.body,proof.proofHeader,'req_finance_test_replay_0001');assert.equal(replay.status,409);
    const second=await f.page.evaluate(()=>window.YNXFinanceWallet.requireProof('finance.portfolio.read'));assert.notEqual(second.proofHeader,proof.proofHeader);
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet.connected());assert.equal((await f.page.evaluate(()=>window.YNXFinanceWallet.session())).account,approved.account);
    f.offline(true);await f.page.locator('#private-revoke').click();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='network-unavailable');assert.equal(await f.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);
    await f.page.reload();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='retry-required');f.offline(false);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='disconnected');
    assert.equal(f.calls.some(c=>c.path==='/v2/product-sessions/revoke'&&c.status===200),true);assert.equal(f.context.pages().length,1);assert.equal(new URL(f.page.url()).origin,ORIGIN);
  }finally{await f.context.close();}
});
test('two isolated browser users cannot adopt another user callback or session',async()=>{
  const a=await setup(),b=await setup();try{const aa=await approve(a,'1'),bb=await approve(b,'2');assert.notEqual(aa.account,bb.account);assert.equal((await a.page.evaluate(()=>window.YNXFinanceWallet.session())).account,aa.account);assert.equal((await b.page.evaluate(()=>window.YNXFinanceWallet.session())).account,bb.account);
    await b.page.goto(aa.callback);await b.page.waitForFunction(()=>window.YNXFinanceWallet.getPrivateState().status==='retry-required');assert.equal(await b.page.evaluate(()=>window.YNXFinanceWallet.connected()),false);assert.equal((await a.page.evaluate(()=>window.YNXFinanceWallet.session())).account,aa.account);
  }finally{await a.context.close();await b.context.close();}
});
