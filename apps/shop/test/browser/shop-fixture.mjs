import {createBrowserIdentityFixture} from './browser-identity-fixture.mjs';
import {test as base,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {ProductSessionGatewayHttpHandler,ProductSessionServerAuthorizer,canonicalJSON,PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION,parseProductSessionWalletURL,signProductSessionApproval,createProductSessionReturnURL,walletIdentity,evmAddressFromYNX,decodeProductSessionGatewayProofHeaderV2,verifyProductSessionProofV2,httpBodyDigest} from '@ynx-chain/wallet-auth';
const registry=JSON.parse(await readFile(new URL('../../../seller-console/product-session-registry.json',import.meta.url),'utf8'));
export const fixtureAccount=walletIdentity('0'.repeat(63)+'1').account;

export const test=base.extend({
  shopServer:[async({},use)=>{
    const root=resolve('dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
    const server=createServer(async(req,res)=>{
      const pathname=new URL(req.url,'http://127.0.0.1:4317').pathname,file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
      if(!file.startsWith(root+'/')){res.writeHead(404);res.end();return}
      try{const body=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body)}catch{res.writeHead(404);res.end()}
    });
    await new Promise((ok,fail)=>{server.once('error',fail);server.listen(4317,'127.0.0.1',ok)});
    await use();await new Promise(ok=>server.close(ok));
  },{scope:'worker',auto:true}],
});
export {expect};

// CONTROLLED_QA_ONLY: actual browser SDK, nonextractable keys and software
// approval/authority. Business replies remain fixtures, not live acceptance.
export async function installPrivateShop(page,{cart=[],orders=[],profile={DisplayName:'Private buyer',Addresses:[{Recipient:'QA recipient',Line1:'Private QA address',City:'QA city',Country:'QA'}]},beforeNavigate,waitForSession=true,prepareApproval=true,gatewayAvailable=true,gatewayOrigin='https://auth.ynxweb4.com',csp=null}={}){
 const gatewayRequests=[];
 const browserIdentity=await createBrowserIdentityFixture(registry);page.once('close',()=>browserIdentity.close());
 const account=fixtureAccount,origin='https://shop.ynxweb4.com';
 const handler=new ProductSessionGatewayHttpHandler(registry,()=>randomBytes(32).toString('base64url'));
 const gatewayFetch=async(url,init)=>{const h=new Headers(init.headers),result=handler.handle({requestId:h.get('x-request-id'),method:init.method,path:new URL(url).pathname,contentType:'application/json',body:init.body??'{}',proofHeader:h.get('x-ynx-product-session-proof-v2'),networkAvailable:true});return new Response(result.body,{status:result.status,headers:result.headers})};
 const server=new ProductSessionServerAuthorizer({registry,productId:'shop',platform:'web',endpoint:gatewayOrigin,fetch:gatewayFetch,timeoutMs:15000});
 await page.context().route('**/*',route=>route.abort());
 await page.context().route(origin+'/**',async route=>{const url=new URL(route.request().url()),name=url.pathname==='/'||url.pathname==='/wallet-auth/callback'?'index.html':url.pathname.replace(/^\/shop\//,'/').slice(1),file=url.pathname.startsWith('/seller/')?resolve('../seller-console/dist',url.pathname.slice('/seller/'.length)||'index.html'):resolve('dist',name);if(!file.startsWith(resolve('dist')+'/')&&!file.startsWith(resolve('../seller-console/dist')+'/'))return route.abort();try{await route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(file)]||'application/octet-stream',body:await readFile(file),headers:csp&&extname(file)==='.html'?{'Content-Security-Policy':csp}:undefined})}catch{await route.abort()}});
 await page.route(gatewayOrigin+'/**',async route=>{gatewayRequests.push({method:route.request().method(),path:new URL(route.request().url()).pathname});const request=route.request(),requestId=request.headers()['x-request-id'],path=new URL(request.url()).pathname;let result;
 if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'GET,POST','access-control-allow-headers':'content-type,x-request-id,x-ynx-product-session-proof-v2'}});return}
 if(path==='/v2/product-sessions/time')result={status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-request-id':requestId},body:canonicalJSON({ok:true,requestId,result:{serverTime:new Date().toISOString()},schemaVersion:PRODUCT_SESSION_GATEWAY_SCHEMA_VERSION})};
 else result=handler.handle({requestId,method:request.method(),path,contentType:'application/json',body:request.postData()??'{}',proofHeader:request.headers()['x-ynx-product-session-proof-v2']??null,networkAvailable:true});
 await route.fulfill({status:result.status,headers:{...result.headers,'access-control-allow-origin':origin,'access-control-expose-headers':'x-request-id,cache-control'},body:result.body});
 });
 await page.addInitScript(({evm,gatewayAvailable,gatewayOrigin})=>{globalThis.__YNX_SHOP_RUNTIME__={endpoints:{appGateway:{status:gatewayAvailable?'AVAILABLE':'UNAVAILABLE',url:gatewayAvailable?gatewayOrigin:''}}};globalThis.ethereum={isMetaMask:true,request:async({method})=>method==='eth_accounts'||method==='eth_requestAccounts'?[evm]:method==='eth_chainId'?'0x1917':null};window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'11111111-1111-4111-8111-111111111111',name:'MetaMask',rdns:'io.metamask'},provider:globalThis.ethereum}})));sessionStorage.setItem('ynx_wallet_pending','original-legacy-data');},{evm:evmAddressFromYNX(account),gatewayAvailable,gatewayOrigin});
  const product={ID:'qa-product',StoreID:'qa-store',Title:'QA product',Category:'tech',Description:'Controlled source fixture',Variants:[{ID:'qa-variant',Name:'QA variant',PriceYNXT:8,Inventory:20,Reserved:0}],Media:[]};
  const state={cart,cartRevision:'qa-cart-v1',orders,profile,product,transitionIntents:new Map(),dropTransitionOnce:false,lookupBarrier:null},requests=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;requests.push({path,method:request.method(),body:request.postDataJSON(),headers:request.headers()});let body;
    if(path==='/api/sso/account'){await route.fulfill({contentType:'application/json',body:JSON.stringify(browserIdentity.read())});return}
    if(!['/api/capabilities','/api/products'].includes(path)&&!(request.method()==='GET'&&path==='/api/stores/qa-store')){const headers=request.headers(),live=await server.authorize({proofHeader:headers['x-ynx-product-session-proof-v2'],origin,method:request.method(),path,requiredScopes:path.startsWith('/api/seller/')?['account:read','shop:seller:operate']:['/api/profile','/api/privacy/export','/api/privacy/delete'].includes(path)?['account:read','shop:profile:write']:path==='/api/cart'||(path==='/api/orders'&&request.method()==='POST')||path==='/api/orders/intent-lookup'||/^\/api\/orders\/[^/]+\/(pay-handoff|confirm-payment)$/.test(path)?['account:read','shop:orders:write']:['account:read','shop:orders:write','shop:profile:write']});if(!path.startsWith('/api/seller/')){const identity=browserIdentity.read();if(live.account!==identity.account||(request.method()!=='GET'&&headers['x-ynx-sso-csrf']!==browserIdentity.csrf))throw Error('Controlled UI Browser/private mismatch');}verifyProductSessionProofV2(decodeProductSessionGatewayProofHeaderV2(headers['x-ynx-product-session-action-proof-v2']),live,{method:request.method(),path,bodyDigest:httpBodyDigest(request.postData()??'')});}
    if(path==='/api/capabilities')body={paySettlement:'unavailable',tax:'unavailable',logistics:'unavailable',aiProvider:'controlled-qa',privacyData:'available'};
    else if(path==='/api/products')body={products:[product]};
    else if(path==='/api/seller/stores')body={stores:[],access:{}};
    else if(path==='/api/cart')body={Items:state.cart,Revision:state.cartRevision};
    else if(path==='/api/profile')body={profile:state.profile};
    else if(path==='/api/orders')body={orders:state.orders};
    else if(/^\/api\/orders\/[^/]+\/pay-handoff$/.test(path)){const id=path.split('/')[3],order=state.orders.find(o=>o.ID===id);if(!order){await route.fulfill({status:404,json:{error:'unknown original order'}});return}if(request.method()==='POST'){order.InvoiceID='inv_original';order.PayIntentID='intent_original'}if(!order.InvoiceID){await route.fulfill({status:409,json:{error:'INVOICE_REFERENCE_NOT_READY'}});return}body={order,invoiceId:order.InvoiceID,intentId:order.PayIntentID,deepLink:'ynxpay://invoice/'+order.InvoiceID};}
    else if(/^\/api\/orders\/[^/]+$/.test(path)){body=state.orders.find(o=>o.ID===path.split('/')[3]);if(!body){await route.fulfill({status:404,json:{error:'unknown original order'}});return}}
    else if(/^\/api\/orders\/[^/]+\/transition$/.test(path)){const input=request.postDataJSON(),target=path.split('/')[3],order=state.orders.find(o=>o.ID===target);if(!order){await route.fulfill({status:404,json:{error:'unknown original order'}});return}const old=state.transitionIntents.get(input.IdempotencyKey);if(old&&JSON.stringify(old)!==JSON.stringify(input)){await route.fulfill({status:409,json:{error:'changed original request'}});return}if(!old){state.transitionIntents.set(input.IdempotencyKey,input);order.Status=input.Action;if(input.Action==='reviewed')order.Review={Rating:input.Rating,Body:input.Body};}if(state.dropTransitionOnce){state.dropTransitionOnce=false;await route.abort('failed');return}body=order;}
    else if(/^\/api\/orders\/[^/]+\/transition-intent-lookup$/.test(path)){const input=request.postDataJSON(),target=path.split('/')[3],old=state.transitionIntents.get(input.IdempotencyKey);if(state.lookupBarrier)await state.lookupBarrier;if(!old||JSON.stringify(old)!==JSON.stringify(input)){await route.fulfill({status:409,json:{error:'original request unavailable'}});return}body={Actor:account,OrderID:target,Action:input.Action,IdempotencyKey:input.IdempotencyKey,Order:state.orders.find(o=>o.ID===target)};}
    else if(path==='/api/stores/qa-store')body={Name:'QA store',Policy:'Controlled QA policy'};
    else{await route.fulfill({status:404,contentType:'application/json',body:'{"error":"Unconfigured controlled fixture"}'});return}
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await beforeNavigate?.({state,requests,account,handler,registry});
  await page.goto(origin+'/');await expect(page.locator('#privateSession')).toBeEnabled();if(!prepareApproval){await expect(page.locator('#products')).toContainText('QA product');return{state,requests,account,registry,gatewayRequests}}await page.locator('#privateSession').click();const link=page.locator('#status a');await expect(link).toHaveAttribute('href',/^ynxwallet:/);const request=parseProductSessionWalletURL(registry,await link.getAttribute('href')),at=new Date(),approval=signProductSessionApproval(registry,request,{accountSecret:'0'.repeat(63)+'1',scopes:request.scopes,expiresAt:request.expiresAt},at);await page.goto(createProductSessionReturnURL(registry,request,{result:'approved',approval},at));
  if(waitForSession){await expect(page.locator('#wallet')).toHaveText('Wallet session active');await expect(page.locator('#products')).toContainText('QA product')}
  return {state,requests,account,registry,gatewayRequests};
}

export function orderFixture(overrides={}){return{Buyer:fixtureAccount,StoreID:'qa-store',Currency:'YNXT',InvoiceID:'qa-invoice',PayIntentID:'qa-intent',PayMerchant:'qa-merchant',PayPayoutAddress:fixtureAccount,Settlement:{Status:'paid',InvoiceID:'qa-invoice',IntentID:'qa-intent',Merchant:'qa-merchant',PayoutAddress:fixtureAccount,Payer:fixtureAccount,Currency:'YNXT',AmountYNXT:8,BlockHeight:1,TransactionHash:'0x'+'a'.repeat(64)},ID:'qa-order',Status:'delivered',CreatedAt:new Date().toISOString(),TotalYNXT:8,Lines:[{Title:'QA product',VariantName:'QA variant',Quantity:1}],Timeline:[],...overrides}}
