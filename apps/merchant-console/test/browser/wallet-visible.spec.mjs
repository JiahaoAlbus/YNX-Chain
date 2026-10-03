import {test, expect} from "@playwright/test";
import {mkdir, readFile} from "node:fs/promises";
import {resolve} from "node:path";

const origin="https://pay.ynxweb4.com";
const evidence=resolve("evidence/visible");
const assets=new Map([
  ["/",["index.html","text/html; charset=utf-8"]],
  ["/index.html",["index.html","text/html; charset=utf-8"]],
  ["/app.js",["app.js","text/javascript; charset=utf-8"]],
  ["/display-settings.js",["display-settings.js","text/javascript; charset=utf-8"]],
  ["/runtime-config.js",["runtime-config.js","text/javascript; charset=utf-8"]],
  ["/styles.css",["styles.css","text/css; charset=utf-8"]],
  ["/manifest.webmanifest",["manifest.webmanifest","application/manifest+json"]],
  ["/assets/ynx-logo.png",["assets/ynx-logo.png","image/png"]]
]);
test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})});
// Registered HTTPS origin intercepted to owned dist; no live product traffic.
test.beforeEach(async({page})=>{await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){await route.abort();return}const path=url.pathname.startsWith('/merchant/')?'/'+url.pathname.slice('/merchant/'.length):url.pathname;const asset=assets.get(path);if(!asset){await route.fulfill({status:404,body:'not found'});return}await route.fulfill({contentType:asset[1],body:await readFile(resolve('dist',asset[0]))})})});

async function installProvider(page,{reject=false}={}){
  await page.addInitScript(({reject})=>{
    const provider={
      isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"},
      async request({method}){
        if(method==="eth_requestAccounts"||method==="eth_accounts"){
          if(reject)throw Object.assign(new Error("User rejected the request."),{code:4001});
          return ["0x1111111111111111111111111111111111111111"];
        }
        if(method==="eth_chainId")return "0x1917";
        throw Object.assign(new Error(`Unsupported deterministic method: ${method}`),{code:4200});
      },
      on(){},
      removeListener(){}
    };
    const detail=Object.freeze({info:Object.freeze({uuid:"11111111-1111-4111-8111-111111111111",name:"YNX Test Wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:"com.ynx.wallet"}),provider});
    addEventListener("eip6963:requestProvider",()=>dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail})));
  },{reject});
}

test("approved deterministic YNX Wallet keeps public preview and private service separated",async({page})=>{
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  await installProvider(page);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Merchant Console"})).toBeVisible();
  await page.getByRole("button",{name:"Explore without signing in"}).click();
  await expect(page.getByText("Public capability preview")).toBeVisible();
  await page.getByRole("button",{name:"Connect Wallet"}).click();
  await expect(page.getByText(/Connected 0x11111111…11111111 · 0x1917 · YNX Test Wallet/)).toBeVisible();
  await expect(page.getByText(/Degraded — accepted Endpoint Manifest marks App Gateway unavailable/)).toBeVisible();
  await expect(page.getByRole("button",{name:"Continue to private merchant session"})).toBeDisabled();
  await expect(page.getByText("Public capability preview")).toBeVisible();
  await page.screenshot({path:resolve(evidence,"merchant-wallet-approved-private-degraded-1440x900.png"),fullPage:true});
  expect(errors).toEqual([]);
});

test("rejected deterministic Wallet creates no account and public preview remains available",async({page})=>{
  const errors=[];
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  await installProvider(page,{reject:true});
  await page.goto("/");
  await page.getByRole("button",{name:"Connect Wallet"}).click();
  await expect(page.getByText(/Not connected\. Public information remains available\./)).toBeVisible();
  await expect(page.getByText(/rejected/i)).toBeVisible();
  await expect(page.getByRole("button",{name:"Continue to private merchant session"})).toBeDisabled();
  await page.getByRole("button",{name:"Explore without signing in"}).click();
  await expect(page.getByText("Public capability preview")).toBeVisible();
  await page.screenshot({path:resolve(evidence,"merchant-wallet-rejected-public-preview-1440x900.png"),fullPage:true});
  expect(errors).toEqual([]);
});

test("Commerce roles and original logo remain usable on mobile",async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('navigation',{name:'Commerce'})).toBeVisible();await expect(page.getByRole('link',{name:'Merchant invoices'})).toHaveAttribute('aria-current','page');await expect(page.locator('.auth-mark img')).toBeVisible();expect(await page.locator('.auth-mark img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'merchant-commerce-mobile-390x844.png'),fullPage:true})});

// Controlled legacy API fixtures exercise product UI only. They are not an
// installed Wallet, canonical v2 approval, public service, or true SSO receipt.
async function installPrivateFixture(page,{role='owner',savedRole=role,invoice}={}){
  await page.addInitScript(({role})=>{
    sessionStorage.setItem('ynx-merchant-id','mrc_qa_original');sessionStorage.setItem('ynx-merchant-session','controlled-qa-session');sessionStorage.setItem('ynx-merchant-role',role);sessionStorage.setItem('ynx-merchant-account','ynx1'+'q'.repeat(38));
  },{role:savedRole});
  await page.route('**/runtime-config.js',route=>route.fulfill({contentType:'text/javascript',body:'globalThis.YNX_PAY_API_URL=location.origin;globalThis.YNX_APP_GATEWAY_URL="";'}));
  const state={merchants:{mrc_qa_original:{id:'mrc_qa_original',displayName:'Controlled Merchant',status:'active',payoutAddress:'ynx1'+'q'.repeat(38)}},merchantMembers:{current:{id:'mem_controlled',merchantId:'mrc_qa_original',account:'ynx1'+'q'.repeat(38),role,status:'active'}},invoices:{},audit:[]};
  await page.route('**/v1/merchant/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/invoices')&&invoice){await invoice(route);return}
    const value=path.endsWith('/state')?state:{merchantId:'mrc_qa_original',netYnxt:0,grossYnxt:0,refundedYnxt:0,committedCount:0,invoiceCount:0,refundRequestCount:0,disputeCount:0,failedWebhookCount:0};
    await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  });
  return state;
}

test('failed invoice retains input and retry identity; successful invoice keeps unrelated draft',async({page})=>{
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await installPrivateFixture(page,{invoice:async route=>{requests.push(route.request().postDataJSON());await route.fulfill({status:requests.length<3?503:201,contentType:'application/json',body:JSON.stringify(requests.length<3?{error:'Controlled unavailable'}:{id:'invoice-controlled'})})}});
  await page.goto('/');await page.getByRole('button',{name:'Create invoice',exact:true}).click();
  await page.locator('#description').fill('Order 42');await page.locator('#amount').fill('8');await page.locator('#tipAmount').fill('1');
  await page.locator('#itemName').fill('Keep this catalog draft');await page.locator('#itemAmount').fill('12');
  await page.getByRole('button',{name:'Create through central Pay API'}).click();
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('#description')).toHaveValue('Order 42');await expect(page.locator('#amount')).toHaveValue('8');await expect(page.locator('#tipAmount')).toHaveValue('1');
  await page.getByRole('button',{name:'Create through central Pay API'}).click();
  await expect.poll(()=>requests.length).toBe(2);await expect(page.getByRole('alert')).toBeVisible();expect(requests[1]).toEqual(requests[0]);
  await page.locator('#description').fill('Order 42 revised');await page.getByRole('button',{name:'Create through central Pay API'}).click();
  await expect(page.getByRole('alert')).toContainText('earlier merchant request');expect(requests).toHaveLength(2);
  await page.locator('#description').fill('Order 42');await page.getByRole('button',{name:'Create through central Pay API'}).click();
  await expect.poll(()=>requests.length).toBe(3);await expect(page.locator('#description')).toHaveValue('');await expect(page.locator('#itemName')).toHaveValue('Keep this catalog draft');
  expect(requests[2]).toEqual(requests[1]);expect(requests[2].amount).toBe(8);expect(requests[2].tipAmount).toBe(1);expect(requests[2].expiresInMinutes).toBe(30);
  await page.getByRole('button',{name:'Overview',exact:true}).first().click();await page.getByRole('button',{name:'Create invoice',exact:true}).click();await expect(page.locator('#itemName')).toHaveValue('Keep this catalog draft');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText('Keep this catalog draft')).toHaveCount(0);
  expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();expect(errors).toEqual([]);
});

test('logout during a mutation never restores private workspace from its late response',async({page})=>{
  let release,started;const pending=new Promise(resolve=>started=resolve);
  await installPrivateFixture(page,{invoice:async route=>{started();await new Promise(resolve=>release=resolve);await route.fulfill({contentType:'application/json',body:'{"id":"late-invoice"}'}).catch(()=>{})}});
  await page.goto('/');await page.getByRole('button',{name:'Create invoice',exact:true}).click();await page.locator('#description').fill('Old account');await page.locator('#amount').fill('8');await page.getByRole('button',{name:'Create through central Pay API'}).click();await pending;
  await expect(page.getByRole('button',{name:'Create through central Pay API'})).toBeDisabled();await page.getByRole('button',{name:'Sign out',exact:true}).click();release();
  await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText('Controlled Merchant')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();
});

test('viewer overview hides invoice creation and merchant forms',async({page})=>{
  await installPrivateFixture(page,{role:'viewer'});await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();await expect(page.getByRole('button',{name:'Create invoice',exact:true})).toHaveCount(0);await expect(page.locator('#invoice-form')).toHaveCount(0);
});

test('authenticated mobile navigation reaches settings without document overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await installPrivateFixture(page,{role:'viewer'});await page.goto('/');await expect(page.getByText('Controlled Merchant')).toHaveCount(1);
  await page.locator('.mobile-nav').getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Security',exact:true})).toBeVisible();await expect(page.locator('[data-locale]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'merchant-private-controlled-mobile-390x844.png'),fullPage:true});
});

test('authoritative session rejection clears private records and requires new approval',async({page})=>{
  await installPrivateFixture(page);await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();
  await page.route('**/v1/merchant/state',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"Session expired"}'}));
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText(/Your merchant session expired/)).toBeVisible();await expect(page.getByText('Controlled Merchant')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();
});


test('reload retains opaque original invoice key and blocks replacement until exact retry',async({page})=>{
 const sent=[];await installPrivateFixture(page,{invoice:async route=>{sent.push(route.request().postDataJSON());await route.fulfill({status:sent.length===1?503:201,contentType:'application/json',body:sent.length===1?'{"error":"response unknown"}':'{"id":"original-recovered"}'})}});
 await page.goto('/');await page.getByRole('button',{name:'Create invoice',exact:true}).click();await page.locator('#description').fill('Original invoice');await page.locator('#amount').fill('8');await page.getByRole('button',{name:'Create through central Pay API'}).click();await expect(page.getByRole('alert')).toBeVisible();
 const journal=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('ynx-merchant-mutation-v1:')));expect(journal).toHaveLength(1);expect(JSON.stringify(journal)).not.toContain('Original invoice');
 await page.reload();await page.getByRole('button',{name:'Create invoice',exact:true}).click();await page.locator('#description').fill('Different invoice');await page.locator('#amount').fill('9');await page.getByRole('button',{name:'Create through central Pay API'}).click();await expect(page.getByRole('alert')).toContainText('earlier merchant request');expect(sent).toHaveLength(1);
 await page.locator('#description').fill('Original invoice');await page.locator('#amount').fill('8');await page.getByRole('button',{name:'Create through central Pay API'}).click();await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx-merchant-mutation-v1:')).length)).toBe(0);
});


test('the selected merchant wins over a foreign first row and excludes foreign invoices',async({page})=>{
 const state=await installPrivateFixture(page);state.merchants={foreign:{id:'mrc_foreign',displayName:'Foreign private merchant',status:'active'},...state.merchants};state.merchantMembers.foreign={merchantId:'mrc_foreign',account:'ynx1'+'q'.repeat(38),role:'owner',status:'active'};state.invoices.foreign={id:'foreign-secret-invoice',merchantId:'mrc_foreign',description:'Foreign order',amount:999,status:'pending'};
 await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();await expect(page.getByText('Foreign private merchant')).toHaveCount(0);await expect(page.getByText('foreign-secret-invoice')).toHaveCount(0);await page.getByRole('button',{name:'Transactions',exact:true}).first().click();await expect(page.getByText('Foreign order')).toHaveCount(0);
});

test('a forged saved owner role cannot expose owner controls when current membership is viewer',async({page})=>{
 await installPrivateFixture(page,{role:'viewer',savedRole:'owner'});await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();await expect(page.getByRole('button',{name:'Create invoice',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Settings',exact:true}).first().click();await expect(page.locator('#member-form')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-role'))).toBe('viewer');
});

for(const change of ['revoked','different-role'])test('current merchant membership '+change+' clears the old workspace and requires approval',async({page})=>{
 const state=await installPrivateFixture(page);await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();if(change==='revoked')state.merchantMembers.current.status='revoked';else state.merchantMembers.current.role='viewer';await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText(/selected merchant or membership changed/)).toBeVisible();await expect(page.getByText('Controlled Merchant')).toHaveCount(0);await expect(page.locator('#invoice-form')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();
});

test('analytics for another merchant never enters the selected dashboard',async({page})=>{
 await installPrivateFixture(page);await page.route('**/v1/merchant/analytics',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({merchantId:'mrc_other',netYnxt:999999,grossYnxt:999999})}));await page.goto('/');await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText(/selected merchant or membership changed/)).toBeVisible();await expect(page.getByText('999999')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();
});
