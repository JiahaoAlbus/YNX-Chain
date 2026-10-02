import{test,expect}from'@playwright/test';
import{createServer}from'node:http';
import{mkdir,readFile}from'node:fs/promises';
import{resolve}from'node:path';
const origin='http://127.0.0.1:4316',evidence=resolve('evidence/visible');
const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/app.js',['app.js','text/javascript; charset=utf-8']],['/runtime-config.js',['runtime-config.js','text/javascript; charset=utf-8']],['/styles.css',['styles.css','text/css; charset=utf-8']],['/responsive.css',['responsive.css','text/css; charset=utf-8']],['/workflow.css',['workflow.css','text/css; charset=utf-8']],['/assets/ynx-logo.png',['assets/ynx-logo.png','image/png']]]);let server;
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true});server=createServer(async(req,res)=>{const asset=assets.get(new URL(req.url,origin).pathname);if(!asset){res.writeHead(404,{'content-type':'text/plain'});res.end('not found');return}res.writeHead(200,{'content-type':asset[1],'cache-control':'no-store'});res.end(await readFile(resolve('dist',asset[0])))});await new Promise((ok,fail)=>{server.once('error',fail);server.listen(4316,'127.0.0.1',ok)})});
test.afterAll(async()=>{if(server)await new Promise(ok=>server.close(ok))});
async function installProvider(page,{reject=false}={}){await page.addInitScript(({reject})=>{const provider={async request({method}){if(method==='eth_requestAccounts'){if(reject)throw Object.assign(new Error('User rejected the request.'),{code:4001});return['0x1111111111111111111111111111111111111111']}if(method==='eth_chainId')return'0x1917';throw Object.assign(new Error(`Unsupported deterministic method: ${method}`),{code:4200})},on(){},removeListener(){}};const detail=Object.freeze({info:Object.freeze({uuid:reject?'seller-reject':'seller-approve',name:'YNX Test Wallet',icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:'com.ynxweb4.wallet.test'}),provider});addEventListener('eip6963:requestProvider',()=>dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})))} ,{reject})}
test('approved deterministic Wallet preserves guest preview and separates degraded seller service',async({page})=>{const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await installProvider(page);await page.goto('/');await page.getByRole('button',{name:'Explore without signing in'}).click();await expect(page.getByText('Seller workflow preview')).toBeVisible();await page.getByRole('button',{name:'Connect Wallet'}).click();await expect(page.locator('#wallet')).toContainText('YNX Test Wallet');await expect(page.locator('#state')).toContainText('Standard Wallet connected on 0x1917');await page.locator('#privateSession').click();await expect(page.locator('#state')).toContainText('remains connected');await expect(page.locator('#state')).toContainText('PRIVATE_SERVICE_DEGRADED');await expect(page.getByText('Seller workflow preview')).toBeVisible();await page.screenshot({path:resolve(evidence,'seller-wallet-approved-private-degraded-1440x900.png'),fullPage:true});expect(errors).toEqual([])});
test('rejected deterministic Wallet creates no account and guest preview remains available',async({page})=>{const errors=[];page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await installProvider(page,{reject:true});await page.goto('/');await page.locator('#wallet').click();await expect(page.locator('#wallet')).toHaveText('Connect Wallet');await expect(page.locator('#privateSession')).toBeDisabled();await expect(page.locator('#state')).toContainText('User rejected the request');await page.getByRole('button',{name:'Explore without signing in'}).click();await expect(page.getByText('No seller records, balances, orders, accounts, or permissions are fabricated')).toBeVisible();await page.screenshot({path:resolve(evidence,'seller-wallet-rejected-guest-preview-1440x900.png'),fullPage:true});expect(errors).toEqual([])});
test('private Wallet launch keeps Seller visible and exposes official fallback choices',async({page})=>{await page.addInitScript(()=>Object.defineProperty(globalThis,'__YNX_SELLER_RUNTIME__',{value:Object.freeze({endpoints:Object.freeze({sellerProductApi:Object.freeze({status:'VERIFIED'})})}),configurable:false,writable:false}));await installProvider(page);await page.route('**/api/auth/config?surface=seller',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:'1',gateway:'available',chainId:'ynx_6423-1',requestingProduct:'shop-seller',productClientId:'ynx-seller-v1',bundleId:'com.ynxweb4.seller-console',productDeviceAlgorithm:'p256-sha256',callback:'ynxseller://wallet-auth/callback',scopes:['account:read','shop:seller:operate']})}));await page.goto('/');const original=page.url();await page.locator('#wallet').click();await page.locator('#privateSession').click();await expect(page.getByRole('link',{name:'Download YNX Wallet'})).toHaveAttribute('href','https://www.ynxweb4.com/dapp/download');await expect(page.getByRole('link',{name:'Use MetaMask'})).toHaveAttribute('href','https://metamask.io/download/');expect(page.url()).toBe(original);await expect(page.locator('#state')).toContainText('Seller page remains available');await page.screenshot({path:resolve(evidence,'seller-controlled-wallet-fallback-1440x900.png'),fullPage:true})});

// This verifies product UI with a controlled legacy gateway response. It is not
// proof of installed Wallet approval, canonical v2 SSO or a public deployment.
async function installPrivateWorkspace(page,{noStores=false,storeARole="catalog",storeAPermissions=["seller.read","catalog.write"],orders=[]}={}) {
  const account='ynx1'+'q'.repeat(38),expiresAt=new Date(Date.now()+120000).toISOString();
  const pending={nonce:'controlled-private-ui',chainId:'ynx_6423-1',requestingProduct:'shop-seller',productClientId:'ynx-seller-v1',bundleId:'com.ynxweb4.seller-console',productDeviceAlgorithm:'p256-sha256',productDeviceKey:'controlled-device-binding',callback:'ynxseller://wallet-auth/callback',purpose:'Controlled local UI test',scopes:['account:read','shop:seller:operate'],expiresAt};
  const response={...pending,account,grantedScopes:pending.scopes,requestDigest:'controlled-ui-digest'};
  await page.addInitScript(value=>sessionStorage.setItem('ynx_wallet_pending',JSON.stringify(value)),pending);
  const product=store=>({ID:'product-'+store,StoreID:store,Title:store+' product',Category:'QA',Description:'Owned fixture',Published:false,Variants:[{ID:store+'-v1',Name:'First',SKU:'one',PriceYNXT:10,Inventory:5,Reserved:1},{ID:store+'-v2',Name:'Second',SKU:'two',PriceYNXT:20,Inventory:8,Reserved:0}],Media:[{URL:'https://example.com/one.png',AltText:'First image',Kind:'image'},{URL:'https://example.com/two.png',AltText:'Second image',Kind:'image'}]});
  const saved=[];
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());let body;
    if(url.pathname==='/api/auth/gateway/challenges')body={challenge:{nonce:'controlled-challenge'}};
    else if(url.pathname==='/api/auth/gateway/sessions')body={account,token:'controlled-product-bearer-1234567890',expiresAt};
    else if(url.pathname==='/api/seller/stores')body={stores:noStores?[]:[{ID:'storeA',Name:'Catalog store',Status:'active'},{ID:'storeB',Name:'Inventory store',Status:'active'}],access:{storeA:{role:storeARole,permissions:storeAPermissions},storeB:{role:'inventory',permissions:['seller.read','inventory.write']}}};
    else if(url.pathname==='/api/orders')body={orders};
    else if(url.pathname==='/api/seller/products')body={products:[product(url.searchParams.get('storeId'))]};
    else if(url.pathname.startsWith('/api/seller/products/')&&request.method()==='PUT'){saved.push(request.postDataJSON());body=product('storeA');}
    else {await route.fulfill({status:403,contentType:'application/json',body:'{"error":"role denied"}'});return;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto('/?response='+Buffer.from(JSON.stringify(response)).toString('base64url'));
  await expect(page.locator('#storeSelect')).toContainText(noStores?'No store':'Catalog store');
  await expect(page.locator('#privateSession')).toHaveText('Private session active');
  return {saved};
}

test('role-specific catalog editing preserves other variants and closes stale store dialogs',async({page})=>{
  const {saved}=await installPrivateWorkspace(page);
  await page.locator('[data-view="catalog"]').click();
  await page.getByRole('button',{name:'Edit draft',exact:true}).click();
  await expect(page.locator('#productForm [name="inventory"]')).toHaveAttribute('readonly','');
  await page.locator('#productForm [name="title"]').fill('Edited first variant title');
  await page.getByRole('button',{name:'Save unpublished draft'}).click();
  await expect(page.locator('#product')).not.toBeVisible();
  expect(saved).toHaveLength(1);expect(saved[0].Variants).toHaveLength(2);expect(saved[0].Variants[1].ID).toBe('storeA-v2');expect(saved[0].Media).toHaveLength(2);
  await page.getByRole('button',{name:'Edit draft',exact:true}).click();
  // Modal dialogs prevent users from switching the underlying store. Simulate
  // a store-selection event to verify the workspace fence also covers it.
  await page.locator('#storeSelect').evaluate(el=>{el.value='storeB';el.dispatchEvent(new Event('change'));});
  await expect(page.locator('#product')).not.toBeVisible();
  await expect(page.locator('#content')).toContainText('storeB product');
  await expect(page.getByRole('button',{name:'Edit draft',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Set First inventory'})).toBeVisible();
  await expect(page.locator('#primaryAction')).toBeHidden();
  await page.locator('[data-view="integrations"]').click();
  await expect(page.locator('#state')).toContainText('managed by the store owner');
  await expect(page.locator('#primaryAction')).toBeHidden();
  await page.locator('#disconnectWallet').click();
  await expect(page.locator('#content')).toBeEmpty();
  await expect(page.locator('#storeSelect')).toContainText('No store');
});

test('closing an AI dialog fences a late run result before reopening',async({page})=>{
  await installPrivateWorkspace(page);
  let releaseRun;const runGate=new Promise(resolve=>{releaseRun=resolve;});let runStarted=false;
  await page.route('**/api/ai/jobs**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/stream')){await route.fulfill({status:200,contentType:'text/event-stream',body:'data: {"Status":"running","ProviderStatus":"connected"}\n\n'});return;}
    if(path.endsWith('/run')){runStarted=true;await runGate;await route.fulfill({status:200,contentType:'application/json',body:'{"ID":"controlled-ai","Status":"ready","Result":"OLD ACCOUNT TASK RESULT"}'}).catch(()=>{});return;}
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ID:'controlled-ai',Status:path.endsWith('/cancel')?'cancelled':'permission_granted'})});
  });
  await page.locator('#ai').click();await page.locator('#aiGrant').click();
  await expect.poll(()=>runStarted).toBe(true);
  await page.locator('#aiCancel').click();
  await expect(page.locator('#aiDialog')).not.toBeVisible();
  await page.locator('#ai').click();
  await expect(page.locator('#aiState')).toContainText('Context review required');
  releaseRun();
  await page.waitForTimeout(100);
  await expect(page.locator('#aiState')).toContainText('Context review required');
  await expect(page.locator('#aiReview')).toBeHidden();
  await expect(page.locator('#aiGrant')).toBeEnabled();
});

test('onboarding retries a lost create response with the same intent and preserved fields',async({page})=>{
  await installPrivateWorkspace(page,{noStores:true});
  const accepted=new Map(),requests=[];
  await page.route('**/api/seller/stores',async route=>{
    if(route.request().method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({stores:[...accepted.values()],access:{'created-store':{role:'owner',permissions:['seller.read','catalog.write']}}})});
    const body=route.request().postDataJSON();requests.push(body);
    if(!accepted.has(body.IdempotencyKey))accepted.set(body.IdempotencyKey,{ID:'created-store',Name:body.Name,Policy:body.Policy,Status:'onboarding'});
    if(requests.length===1)return route.abort('connectionreset');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(accepted.get(body.IdempotencyKey))});
  });
  await page.getByRole('button',{name:'Start onboarding',exact:true}).click();
  await page.locator('#storeForm [name="name"]').fill('My QA store');
  await page.locator('#storeForm [name="policy"]').fill('Return within seven days');
  await page.getByRole('button',{name:'Save store',exact:true}).click();
  await expect(page.locator('#storeState')).not.toBeEmpty();
  await expect(page.locator('#storeForm [name="name"]')).toHaveValue('My QA store');
  await expect(page.getByRole('button',{name:'Save store',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Save store',exact:true}).click();
  await expect(page.locator('#storeDialog')).not.toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(accepted.size).toBe(1);
  await expect(page.locator('#storeSelect')).toContainText('My QA store');
});

test('fulfillment retries preserve the accepted shipment intent after a lost response',async({page})=>{
  const order={ID:'qa-order',StoreID:'storeA',Buyer:'qa-buyer',Status:'paid',TotalYNXT:10,Lines:[],Timeline:[]};
  await installPrivateWorkspace(page,{storeARole:'fulfillment',storeAPermissions:['seller.read','fulfillment.write'],orders:[order]});
  const accepted=new Set(),requests=[];
  await page.route('**/api/orders/qa-order/transition',async route=>{
    const body=route.request().postDataJSON();requests.push(body);accepted.add(body.IdempotencyKey);order.Status='shipped';
    if(requests.length===1)return route.abort('connectionreset');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(order)});
  });
  await page.locator('[data-view="orders"]').click();
  await page.getByRole('button',{name:'Add shipment'}).click();
  await page.locator('#orderForm [name="carrier"]').fill('QA carrier');
  await page.locator('#orderForm [name="trackingNumber"]').fill('QA123456');
  await page.getByRole('button',{name:'Confirm authorized action'}).click();
  await expect(page.locator('#orderState')).not.toBeEmpty();
  await expect(page.locator('#orderForm [name="trackingNumber"]')).toHaveValue('QA123456');
  await page.getByRole('button',{name:'Confirm authorized action'}).click();
  await expect(page.locator('#orderDialog')).not.toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(accepted.size).toBe(1);
  await expect(page.locator('#content')).toContainText('shipped');
});

test('logout while private configuration is pending prevents a late approval launch',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(globalThis,'__YNX_SELLER_RUNTIME__',{value:Object.freeze({endpoints:Object.freeze({sellerProductApi:Object.freeze({status:'VERIFIED'})})}),configurable:false,writable:false}));
  await installProvider(page);
  let release,started=false;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/auth/config?surface=seller',async route=>{
    started=true;await gate;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:'1',gateway:'available',chainId:'ynx_6423-1',requestingProduct:'shop-seller',productClientId:'ynx-seller-v1',bundleId:'com.ynxweb4.seller-console',productDeviceAlgorithm:'p256-sha256',callback:'ynxseller://wallet-auth/callback',scopes:['account:read','shop:seller:operate']})}).catch(()=>{});
  });
  await page.goto('/');await page.locator('#wallet').click();await page.locator('#privateSession').click();
  await expect.poll(()=>started).toBe(true);
  await page.locator('#disconnectWallet').click();release();
  await expect(page.locator('#state')).toContainText('Signed out.');
  await page.waitForTimeout(100);
  expect(await page.evaluate(()=>sessionStorage.getItem('ynx_wallet_pending'))).toBeNull();
  await expect(page.locator('#wallet')).toHaveText('Connect Wallet');
  await expect(page.locator('#state')).toContainText('Signed out.');
});

test('an authoritative expired session clears seller records and closes private editing',async({page})=>{
  await installPrivateWorkspace(page);
  await page.locator('[data-view="catalog"]').click();
  await expect(page.locator('#content')).toContainText('storeA product');
  await page.getByRole('button',{name:'Edit draft',exact:true}).click();
  await page.route('**/api/seller/products/product-storeA',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"session expired"}'}));
  await page.getByRole('button',{name:'Save unpublished draft'}).click();
  await expect(page.locator('#state')).toContainText('session expired');
  await expect(page.locator('#product')).not.toBeVisible();
  await expect(page.locator('#content')).toBeEmpty();
  await expect(page.locator('#storeSelect')).toContainText('No store');
  await expect(page.locator('#privateSession')).not.toHaveText('Private session active');
});
