import {test as base,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';

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

// LOCAL_QA_ONLY: real product JS and legacy callback processing with deterministic
// Gateway/business responses. This is not installed Wallet or canonical v2 SSO.
export async function installPrivateShop(page,{cart=[],orders=[],profile={DisplayName:'Private buyer',Addresses:[{Recipient:'QA recipient',Line1:'Private QA address',City:'QA city',Country:'QA'}]},beforeNavigate,waitForSession=true}={}){
  const account='ynx1'+'q'.repeat(38),expiresAt=new Date(Date.now()+120000).toISOString();
  const pending={version:'1',nonce:'shop-controlled-private-ui',chainId:'ynx_6423-1',requestingProduct:'shop-buyer',productClientId:'ynx-shop-v1',bundleId:'com.ynxweb4.shop',productDeviceAlgorithm:'p256-sha256',productDeviceKey:'controlled-device-binding',callback:'ynxshop://wallet-auth/callback',purpose:'Controlled local Shop UI test',scopes:['account:read','shop:orders:write','shop:profile:write'],expiresAt};
  const response={...pending,account,grantedScopes:pending.scopes,requestDigest:'shop-controlled-ui-digest'};
  await page.addInitScript(value=>sessionStorage.setItem('ynx_wallet_pending',JSON.stringify(value)),pending);
  const product={ID:'qa-product',StoreID:'qa-store',Title:'QA product',Category:'tech',Description:'Controlled source fixture',Variants:[{ID:'qa-variant',Name:'QA variant',PriceYNXT:8,Inventory:20,Reserved:0}],Media:[]};
  const state={cart,orders,profile,product},requests=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;requests.push({path,method:request.method(),body:request.postDataJSON()});let body;
    if(path==='/api/auth/gateway/challenges')body={challenge:{nonce:'controlled-shop-challenge'}};
    else if(path==='/api/auth/gateway/sessions')body={account,token:'shop-controlled-product-bearer-1234567890',expiresAt};
    else if(path==='/api/capabilities')body={paySettlement:'unavailable',tax:'unavailable',logistics:'unavailable',aiProvider:'controlled-qa',privacyData:'available'};
    else if(path==='/api/products')body={products:[product]};
    else if(path==='/api/cart')body={Items:state.cart};
    else if(path==='/api/profile')body={profile:state.profile};
    else if(path==='/api/orders')body={orders:state.orders};
    else if(path==='/api/stores/qa-store')body={Name:'QA store',Policy:'Controlled QA policy'};
    else{await route.fulfill({status:404,contentType:'application/json',body:'{"error":"Unconfigured controlled fixture"}'});return}
    await route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  await beforeNavigate?.({state,requests,account});
  await page.goto('/?response='+Buffer.from(JSON.stringify(response)).toString('base64url'));
  if(waitForSession){await expect(page.locator('#wallet')).toHaveText('Wallet session active');await expect(page.locator('#products')).toContainText('QA product')}
  return {state,requests,account};
}

export function orderFixture(overrides={}){return{ID:'qa-order',Status:'delivered',CreatedAt:new Date().toISOString(),TotalYNXT:8,Lines:[{Title:'QA product',VariantName:'QA variant',Quantity:1}],Timeline:[],...overrides}}
