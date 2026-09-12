import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {ProductSessionGatewayHttpHandler,signProductSessionApproval,createProductSessionReturnURL,canonicalJSON} from './fixtures/wallet-test-kernel-9840ef87.mjs';

// OFFLINE ONLY: unmodified official Wallet kernel and actual Chromium storage.
// Disposable scalar 1/2 accounts are test data, never user keys or approvals.
// All HTTPS is intercepted in-process. No installed Wallet or public request.
const ORIGIN='https://quant.ynxweb4.com',AUTH='https://wallet-auth.ynxweb4.com';
const registry=JSON.parse(await readFile(new URL('../vendor/product-session-registry-9840ef87.json',import.meta.url),'utf8'));
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});});
test.after(async()=>browser.close());
async function setup(){
  const context=await browser.newContext(),calls=[];let revokeOffline=false;
  const kernel=new ProductSessionGatewayHttpHandler(registry,()=>randomBytes(32).toString('base64url'));
  function authority(path,method,body,proofHeader,requestId){return kernel.handle({requestId,method,path,contentType:'application/json',body:body??'{}',proofHeader:proofHeader??null,networkAvailable:true},new Date());}
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===AUTH){
      const cors={'access-control-allow-origin':ORIGIN,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'x-request-id, content-type, x-ynx-product-session-proof-v2','access-control-expose-headers':'x-request-id, cache-control'};
      if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors,body:''});
      // Authority time is the official Node host boundary, not a kernel route.
      if(url.pathname==='/v2/product-sessions/time'){
        const requestId=request.headers()['x-request-id'];return route.fulfill({status:200,headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonicalJSON({ok:true,requestId,result:{serverTime:new Date().toISOString()},schemaVersion:2})});
      }
      if(revokeOffline&&url.pathname.endsWith('/revoke'))return route.abort('failed');
      const result=authority(url.pathname,request.method(),request.postData(),request.headers()['x-ynx-product-session-proof-v2'],request.headers()['x-request-id']);
      calls.push({path:url.pathname,status:result.status});return route.fulfill({status:result.status,headers:{...cors,...result.headers},body:result.body});
    }
    assert.equal(url.origin,ORIGIN);
    if(url.pathname==='/api/v1/snapshot')return route.fulfill({contentType:'application/json',body:JSON.stringify({paper:{Cash:100,Position:0,ReconciliationDelta:0},strategies:{},experiments:{},audit:[]})});
    if(url.pathname==='/api/v1/wallet/private-account'){
      assert.match(request.headers()['x-ynx-tenant-id'],/^[0-9a-f]{64}$/);assert.equal(request.postData(),'{}');
      const proof=request.headers()['x-ynx-product-session-proof-v2'],result=authority('/v2/product-sessions/introspect','POST',canonicalJSON({requiredScopes:['quant:account']}),proof,'req_quant_test_'+randomBytes(16).toString('hex'));
      calls.push({path:url.pathname,status:result.status,proof});if(result.status!==200)return route.fulfill({status:401,contentType:'application/json',body:'{"error":"test-proof-rejected"}'});
      const session=JSON.parse(result.body).result.session;
      return route.fulfill({contentType:'application/json',body:JSON.stringify({account:session.account,sessionBinding:session.sessionBinding,authority:AUTH,nativeExecutionEnabled:false,paperWorkspaceLinked:false})});
    }
    const file=url.pathname==='/'||url.pathname==='/wallet-auth/callback'?'index.html':url.pathname.slice(1);
    if(!/^[a-z0-9.-]+$/.test(file))return route.fulfill({status:404,body:''});
    try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:await readFile(new URL('../web/'+file,import.meta.url))});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();await page.goto(ORIGIN);await page.waitForFunction(()=>!!window.YNXQuantWallet);
  return {context,page,kernel,calls,authority,offline:value=>{revokeOffline=value;}};
}
async function approve(f,secret='1'){
  await f.page.locator('#private-sign-in').click();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='connecting',null,{timeout:5000});
  const uri=await f.page.locator('#private-open-wallet').getAttribute('href'),request=JSON.parse(Buffer.from(new URL(uri).searchParams.get('request'),'base64url').toString('utf8'));
  const now=new Date(),approval=signProductSessionApproval(registry,request,{accountSecret:secret.padStart(64,'0'),scopes:request.scopes,expiresAt:new Date(now.getTime()+180000).toISOString()},now);
  const callback=createProductSessionReturnURL(registry,request,{result:'approved',approval},now);
  await f.page.goto(callback);
  try{await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='connected',null,{timeout:5000});}
  catch{assert.fail(JSON.stringify({privateState:await f.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState()),calls:f.calls.map(({path,status})=>({path,status}))}));}
  return {request,callback,account:approval.account};
}
async function account(page){return page.evaluate(()=>window.YNXQuantWallet.privateAccount(localStorage.getItem('ynx.quant.tenant.v1')));}

test('offline test kernel is the frozen official artifact, not a Quant protocol reimplementation',async()=>{
  const data=await readFile(new URL('./fixtures/wallet-test-kernel-9840ef87.mjs',import.meta.url));assert.equal(data.length,119170);assert.equal(createHash('sha256').update(data).digest('hex'),'5f711edad9a4ade05d3bc2353ac989ae4c1465cfb79b50e4bc600f1af4f70bd1');
});
test('official local approval, completion, fresh API proofs, replay, restore and revoke Retry remain bound',async()=>{
  const f=await setup();try{
    const approved=await approve(f);assert.equal((await account(f.page)).account,approved.account);await account(f.page);
    const proofs=f.calls.filter(c=>c.path==='/api/v1/wallet/private-account').map(c=>c.proof);assert.equal(proofs.length,2);assert.notEqual(proofs[0],proofs[1]);
    const replay=f.authority('/v2/product-sessions/introspect','POST',canonicalJSON({requiredScopes:['quant:account']}),proofs[0],'req_quant_test_replay_0001');assert.equal(replay.status,409);
    assert.equal(f.page.url(),ORIGIN+'/');await f.page.reload();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='connected');assert.equal((await account(f.page)).account,approved.account);
    f.offline(true);await f.page.locator('#private-sign-out').click();await f.page.waitForFunction(()=>['network-unavailable','retry-required'].includes(window.YNXQuantWallet.getPrivateSessionState().status));
    await assert.rejects(account(f.page));await f.page.reload();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='retry-required');
    f.offline(false);await f.page.locator('#private-retry').click();await f.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='disconnected');
    assert.equal(f.calls.some(c=>c.path==='/v2/product-sessions/revoke'&&c.status===200),true);assert.equal(f.context.pages().length,1);
    assert.equal(f.calls.some(c=>c.path==='/v2/product-sessions/challenge'&&c.status===200),true);assert.equal(f.calls.some(c=>c.path==='/v2/product-sessions/complete'&&c.status===200),true);
  }finally{await f.context.close();}
});
test('two isolated users and second-tab revocation cannot leak authority or adopt old approval callbacks',async()=>{
  const a=await setup(),b=await setup();try{
    const aa=await approve(a,'1'),bb=await approve(b,'2');assert.notEqual(aa.account,bb.account);assert.equal((await account(a.page)).account,aa.account);assert.equal((await account(b.page)).account,bb.account);
    const tab=await a.context.newPage();await tab.goto(ORIGIN);await tab.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='connected');assert.equal((await account(tab)).account,aa.account);
    await a.page.locator('#private-sign-out').click();await a.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='disconnected');await assert.rejects(account(tab));
    await b.page.goto(aa.callback);await b.page.waitForFunction(()=>window.YNXQuantWallet.getPrivateSessionState().status==='retry-required');assert.equal((await b.page.evaluate(()=>window.YNXQuantWallet.getPrivateSessionState())).account,null);
  }finally{await a.context.close();await b.context.close();}
});
