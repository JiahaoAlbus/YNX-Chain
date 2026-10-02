import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {chromium} = await import(process.env.YNX_DOCS_PLAYWRIGHT_MODULE || 'playwright');
const web = new URL('../web/', import.meta.url);
// Engineering UI/HTTP fixture only: no real Wallet, signature or authority is substituted in production.
const fixture = `export class ProductSessionGatewayFetchAdapter {};
export async function createBrowserProductSessionClient(){
 const read=()=>JSON.parse(localStorage.getItem('qa-docs-session')||'{"status":"guest"}');
 const client={current:read(),restore:async()=>client.current=read(),beginExplicit:async()=>({route:{status:'ready',url:'ynxwallet://fixture'}}),
 handleReturn:async()=>{const account=globalThis.qaAccount||'fixture-A';const value={status:'connected',session:{sessionBinding:'fixture-session-'+account,account,scopes:['docs.read','docs.write','files.read','files.write']}};localStorage.setItem('qa-docs-session',JSON.stringify(value));return client.current=value;},
 disconnect:async()=>{localStorage.removeItem('qa-docs-session');return client.current={status:'disconnected'}}};
 return {client,close(){},createIntrospectionProof:async()=>{if(client.current.status!=='connected')throw Object.assign(Error('inactive'),{code:'SESSION_INACTIVE'});return {proofHeader:'engineering-fixture:'+client.current.session.account}}};}`;

test('ordinary main editor approve, create, save, reopen after reload and cancel retry at 360px', async () => {
 const browser = await chromium.launch({headless:true});
 const context = await browser.newContext({viewport:{width:360,height:780}});
 const page = await context.newPage(), errors = [], requests = [];
 page.setDefaultTimeout(5000);
 let object, content = '';
 page.on('pageerror', error => errors.push(error.message));
 await context.addInitScript(() => {
  const listeners = new Map();
  window.ethereum={isYNXWallet:true,rdns:'com.ynx.wallet',on:(name,fn)=>listeners.set(name,fn),removeListener:name=>listeners.delete(name),request:async request=>{
   if(request.method!=='ynx_requestProductSessionV2')return request.method==='eth_accounts'?[]:'0x1917';
   window.qaApprovals=(window.qaApprovals||0)+1;
   if(window.qaHold)await new Promise(resolve=>window.qaRelease=resolve);
   return {version:2,returnUrl:'https://docs.ynxweb4.com/wallet-auth/callback?fixture'};
  }};
  window.qaChangeAccount=()=>listeners.get('accountsChanged')?.(['fixture-B']);
 });
 await context.route('**/*', async route => {
  const request=route.request(), url=new URL(request.url());
  if(url.pathname.startsWith('/api/v1/')) {
   requests.push({path:url.pathname,method:request.method(),proof:request.headers()['x-ynx-product-session-proof-v2'],bearer:request.headers().authorization,key:request.headers()['idempotency-key']});
   if(request.headers()['x-ynx-product-session-proof-v2']==='engineering-fixture:fixture-B')return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[]})});
   if(request.method()==='POST' && url.pathname==='/api/v1/objects') {
    const body=request.postDataJSON(); object={id:'qa-doc',name:body.name,kind:body.kind,mime:'text/plain',version:1,updatedAt:new Date().toISOString()};
   } else if(request.method()==='PUT') {content=Buffer.from(request.postDataJSON().content,'base64').toString();object={...object,version:object.version+1};}
   if(url.pathname.endsWith('/content'))return route.fulfill({contentType:'application/json',body:content});
   return route.fulfill({contentType:'application/json',body:JSON.stringify(url.pathname==='/api/v1/objects'?request.method()==='POST'?object:{items:object?[object]:[]}:object)});
  }
  if(url.pathname==='/vendor/wallet-session-sdk.js')return route.fulfill({contentType:'application/javascript',body:fixture});
  try {const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);let body=await readFile(new URL(filename,web));if(filename==='app-secure.js')body=Buffer.from(body.toString().replace("$('#auth-details').textContent = String(error?.code || 'WALLET_UNAVAILABLE');", "$('#auth-details').textContent = String(error?.code || 'WALLET_UNAVAILABLE'); window.qaCaughtError = error?.message;"));return route.fulfill({contentType:filename.endsWith('.html')?'text/html':filename.endsWith('.css')?'text/css':filename.endsWith('.json')?'application/json':filename.endsWith('.png')?'image/png':'application/javascript',body});}
  catch {return route.fulfill({status:404,body:'missing'});}
 });
 try {
  await page.goto('https://docs.ynxweb4.com/');await page.click('#wallet');await page.click('#auth-start');
  await page.waitForFunction(()=>!document.querySelector('#auth-dialog').open);
  assert.notEqual(await page.evaluate(()=>localStorage.getItem('qa-docs-session')),null);
  page.once('dialog',dialog=>dialog.accept('QA document'));await page.click('#new-doc');await page.waitForFunction(()=>!document.querySelector('#editor').disabled);
  await page.fill('#editor','QA saved text');await page.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('Version 2'));
  assert.equal(content,'QA saved text');assert.equal(object.version,2);
  await page.reload();await page.locator('#doc-list button').first().click();await page.waitForFunction(()=>document.querySelector('#editor').value==='QA saved text');
  assert.equal(await page.evaluate(()=>window.qaApprovals||0),0);
  assert.ok(requests.every(item=>item.proof&&!item.bearer));assert.ok(requests.filter(item=>['POST','PUT'].includes(item.method)).every(item=>item.key));
  await page.click('#wallet');page.once('dialog',dialog=>dialog.accept());await page.click('#auth-end');
  await page.evaluate(()=>window.qaHold=true);await page.click('#auth-start');await page.waitForFunction(()=>!!window.qaRelease);
  await page.locator('#auth-dialog button').filter({hasText:'Cancel'}).click();await page.evaluate(()=>{window.qaHold=false;window.qaRelease();});
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>localStorage.getItem('qa-docs-session')),null);
  await page.click('#wallet');await page.click('#auth-start');await page.waitForFunction(()=>!document.querySelector('#auth-dialog').open);
  await page.locator('#doc-list button').first().click();await page.waitForFunction(()=>!document.querySelector('#editor').disabled);
  await page.fill('#editor','unconfirmed account A draft');await page.evaluate(()=>window.qaChangeAccount());
  await page.waitForFunction(()=>document.querySelector('#editor-shell').hidden && document.querySelector('#auth-end').disabled);
  assert.notEqual(await page.evaluate(()=>localStorage.getItem('ynx.docs.v2.draft.fixture-A.qa-doc')),null);
  await page.evaluate(()=>window.qaAccount='fixture-B');await page.click('#wallet');await page.click('#auth-start');await page.waitForFunction(()=>!document.querySelector('#auth-dialog').open);
  assert.equal(await page.locator('#editor-shell').isVisible(),false);assert.equal(await page.locator('#doc-list button').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
 } catch(error) {
  console.error(JSON.stringify({stage:'main-editor',errors,auth:await page.locator('#auth-state').textContent(),detail:await page.locator('#auth-details').textContent(),caught:await page.evaluate(()=>window.qaCaughtError)}));
  throw error;
 } finally {await browser.close();}
});

test('actual bundled SDK verifies signed Docs callback, cold IndexedDB restore and in-flight cancellation', async () => {
 if(!process.env.YNX_DOCS_AUTH_SOURCE_MODULE)throw Error('Provide the reviewed official wallet-auth index.js for the isolated authority fixture.');
 const sdk=await import(process.env.YNX_DOCS_AUTH_SOURCE_MODULE);
 const registry=JSON.parse(await readFile(new URL('vendor/product-session-registry.json',web),'utf8'));
 const handler=new sdk.ProductSessionGatewayHttpHandler(registry,()=>crypto.randomUUID().replaceAll('-',''));
 const browser=await chromium.launch({headless:true}), context=await browser.newContext();
 const page=await context.newPage();page.setDefaultTimeout(8000);
 let completionHold, releaseCompletion, completionStarted=false;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await context.exposeBinding('qaSignedApproval',async(_source,url)=>{
  const request=sdk.parseProductSessionWalletURL(registry,url);
  const approval=sdk.signProductSessionApproval(registry,request,{accountSecret:'1'.padStart(64,'0'),scopes:request.scopes,expiresAt:request.expiresAt});
  return {version:2,returnUrl:sdk.createProductSessionReturnURL(registry,request,{result:'approved',approval})};
 });
 await context.addInitScript(()=>{
  window.ethereum={isYNXWallet:true,rdns:'com.ynx.wallet',on(){},removeListener(){},request:async input=>input.method==='ynx_requestProductSessionV2'?window.qaSignedApproval(input.params[0]):input.method==='eth_accounts'?[]:'0x1917'};
 });
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin==='https://wallet-auth.ynxweb4.com'){
   const cors={'access-control-allow-origin':'https://docs.ynxweb4.com','access-control-expose-headers':'x-request-id','access-control-allow-methods':'GET, POST','access-control-allow-headers':'content-type,x-request-id,x-ynx-product-session-proof-v2'};
   if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
   const headers=request.headers(),id=headers['x-request-id'];
   if(url.pathname.endsWith('/time'))return route.fulfill({headers:{...cors,'content-type':'application/json','cache-control':'no-store','x-request-id':id},body:sdk.canonicalJSON({ok:true,result:{serverTime:new Date().toISOString()},requestId:id,schemaVersion:2})});
   if(completionHold&&url.pathname.endsWith('/complete')){completionStarted=true;await completionHold;}
   const result=handler.handle({requestId:id,method:request.method(),path:url.pathname,contentType:headers['content-type'],body:request.postData(),proofHeader:headers['x-ynx-product-session-proof-v2']??null,networkAvailable:true});
   return route.fulfill({status:result.status,headers:{...cors,...result.headers},body:result.body});
  }
  if(url.pathname.startsWith('/api/v1/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({items:[]})});
  try{const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);return route.fulfill({contentType:filename.endsWith('.html')?'text/html':filename.endsWith('.css')?'text/css':filename.endsWith('.json')?'application/json':filename.endsWith('.png')?'image/png':'application/javascript',body:await readFile(new URL(filename,web))});}
  catch{return route.fulfill({status:404,body:'missing'});}
 });
 try{
  await page.goto('https://docs.ynxweb4.com/');await page.click('#wallet');await page.click('#auth-start');
  await page.waitForFunction(()=>!document.querySelector('#auth-dialog').open);
  assert.equal(handler.snapshot().authority.sessions.length,1);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#wallet').textContent.includes('authorized'));
  await page.click('#wallet');page.once('dialog',dialog=>dialog.accept());await page.click('#auth-end');
  await page.waitForFunction(()=>document.querySelector('#auth-state').textContent.includes('revoked'));
  completionHold=new Promise(resolve=>releaseCompletion=resolve);await page.click('#auth-start');
  for(let i=0;i<100&&!completionStarted;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(completionStarted,true);
  await page.locator('#auth-dialog button').filter({hasText:'Cancel'}).click();releaseCompletion();completionHold=null;
  // Wait for SDK cancellation/revocation completion, not merely the local dialog closing.
  await page.waitForFunction(()=>document.querySelector('#auth-end').disabled && document.querySelector('#new-doc').disabled);
  await page.reload();await page.waitForFunction(()=>!document.querySelector('#wallet').textContent.includes('Checking'));
  assert.equal(await page.locator('#new-doc').isDisabled(),true);
  assert.deepEqual(errors,[]);
 }catch(error){console.error(JSON.stringify({stage:'actual-sdk',auth:await page.locator('#auth-state').textContent(),detail:await page.locator('#auth-details').textContent(),status:await page.locator('#wallet').textContent(),errors}));throw error;}
 finally{releaseCompletion?.();await browser.close();}
});
