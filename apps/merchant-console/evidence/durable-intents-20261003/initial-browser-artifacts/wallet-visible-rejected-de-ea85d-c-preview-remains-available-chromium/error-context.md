# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: wallet-visible.spec.mjs >> rejected deterministic Wallet creates no account and public preview remains available
- Location: test/browser/wallet-visible.spec.mjs:57:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 404 (Not Found)",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Skip to content" [ref=e2] [cursor=pointer]:
    - /url: "#main"
  - navigation "Commerce" [ref=e3]:
    - link "YNX Pay Merchant home" [ref=e4] [cursor=pointer]:
      - /url: /merchant/
      - img "YNX" [ref=e5]
      - generic [ref=e6]: YNX Pay
    - link "Shop" [ref=e7] [cursor=pointer]:
      - /url: https://shop.ynxweb4.com/
    - link "Sell products" [ref=e8] [cursor=pointer]:
      - /url: https://shop.ynxweb4.com/seller/
    - link "Merchant invoices" [ref=e9] [cursor=pointer]:
      - /url: https://pay.ynxweb4.com/merchant/
  - main [ref=e11]:
    - generic [ref=e12]:
      - img "YNX" [ref=e14]
      - heading "Merchant Console" [level=1] [ref=e15]
      - paragraph [ref=e16]: Real YNX Testnet records
      - generic [ref=e17]:
        - generic [ref=e18]: Console language
        - combobox "Console language" [ref=e19]:
          - option "English" [selected]
          - option "简体中文"
          - option "繁體中文"
          - option "日本語"
          - option "한국어"
          - option "Español"
          - option "Français"
          - option "Deutsch"
          - option "Português"
          - option "Русский"
          - option "العربية"
          - option "Bahasa Indonesia"
      - generic [ref=e20]:
        - strong [ref=e21]: Standard Wallet
        - text: Not connected. Public information remains available.
        - strong [ref=e22]: Private merchant service
        - text: Degraded — accepted Endpoint Manifest marks App Gateway unavailable
      - generic [ref=e23]:
        - button "Connect Wallet" [ref=e24] [cursor=pointer]
        - button "Hide public capabilities" [ref=e25] [cursor=pointer]
      - generic [ref=e26]:
        - strong [ref=e27]: Public capability preview
        - paragraph [ref=e28]: Create invoices, reconcile finalized payments, manage webhooks, refunds, disputes and team roles after a private merchant session is available. No merchant records, balances or transactions are fabricated in preview mode.
      - generic [ref=e29]:
        - generic [ref=e30]:
          - generic [ref=e31]: Merchant ID
          - textbox "Merchant ID" [ref=e32]:
            - /placeholder: mrc_…
        - button "Continue to private merchant session" [disabled] [ref=e34]
      - alert [ref=e35]: User rejected the request.
      - generic [ref=e36]: Standard Wallet connection never depends on the private App Gateway. Private approval is product-, device-, callback-, scope-, nonce- and request-bound, and a private-service failure does not disconnect the wallet.
    - complementary [ref=e37]:
      - heading "Operations, not a payment demo." [level=2] [ref=e38]
      - paragraph [ref=e39]: Committed revenue appears only from matching authoritative YNXT transaction evidence. A button or timer can never mark an invoice paid.
      - paragraph [ref=e40]: Cross-chain settlement is unavailable because no approved live bridge route exists.
```

# Test source

```ts
  1   | import {test, expect} from "@playwright/test";
  2   | import {mkdir, readFile} from "node:fs/promises";
  3   | import {resolve} from "node:path";
  4   | 
  5   | const origin="https://pay.ynxweb4.com";
  6   | const evidence=resolve("evidence/visible");
  7   | const assets=new Map([
  8   |   ["/",["index.html","text/html; charset=utf-8"]],
  9   |   ["/index.html",["index.html","text/html; charset=utf-8"]],
  10  |   ["/app.js",["app.js","text/javascript; charset=utf-8"]],
  11  |   ["/runtime-config.js",["runtime-config.js","text/javascript; charset=utf-8"]],
  12  |   ["/styles.css",["styles.css","text/css; charset=utf-8"]],
  13  |   ["/manifest.webmanifest",["manifest.webmanifest","application/manifest+json"]],
  14  |   ["/assets/ynx-logo.png",["assets/ynx-logo.png","image/png"]]
  15  | ]);
  16  | test.beforeAll(async()=>{await mkdir(evidence,{recursive:true})});
  17  | // Registered HTTPS origin intercepted to owned dist; no live product traffic.
  18  | test.beforeEach(async({page})=>{await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){await route.abort();return}const path=url.pathname.startsWith('/merchant/')?'/'+url.pathname.slice('/merchant/'.length):url.pathname;const asset=assets.get(path);if(!asset){await route.fulfill({status:404,body:'not found'});return}await route.fulfill({contentType:asset[1],body:await readFile(resolve('dist',asset[0]))})})});
  19  | 
  20  | async function installProvider(page,{reject=false}={}){
  21  |   await page.addInitScript(({reject})=>{
  22  |     const provider={
  23  |       isYNXWallet:true,providerInfo:{rdns:"com.ynx.wallet"},
  24  |       async request({method}){
  25  |         if(method==="eth_requestAccounts"||method==="eth_accounts"){
  26  |           if(reject)throw Object.assign(new Error("User rejected the request."),{code:4001});
  27  |           return ["0x1111111111111111111111111111111111111111"];
  28  |         }
  29  |         if(method==="eth_chainId")return "0x1917";
  30  |         throw Object.assign(new Error(`Unsupported deterministic method: ${method}`),{code:4200});
  31  |       },
  32  |       on(){},
  33  |       removeListener(){}
  34  |     };
  35  |     const detail=Object.freeze({info:Object.freeze({uuid:"11111111-1111-4111-8111-111111111111",name:"YNX Test Wallet",icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",rdns:"com.ynx.wallet"}),provider});
  36  |     addEventListener("eip6963:requestProvider",()=>dispatchEvent(new CustomEvent("eip6963:announceProvider",{detail})));
  37  |   },{reject});
  38  | }
  39  | 
  40  | test("approved deterministic YNX Wallet keeps public preview and private service separated",async({page})=>{
  41  |   const errors=[];
  42  |   page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  43  |   await installProvider(page);
  44  |   await page.goto("/");
  45  |   await expect(page.getByRole("heading",{name:"Merchant Console"})).toBeVisible();
  46  |   await page.getByRole("button",{name:"Explore without signing in"}).click();
  47  |   await expect(page.getByText("Public capability preview")).toBeVisible();
  48  |   await page.getByRole("button",{name:"Connect Wallet"}).click();
  49  |   await expect(page.getByText(/Connected 0x11111111…11111111 · 0x1917 · YNX Test Wallet/)).toBeVisible();
  50  |   await expect(page.getByText(/Degraded — accepted Endpoint Manifest marks App Gateway unavailable/)).toBeVisible();
  51  |   await expect(page.getByRole("button",{name:"Continue to private merchant session"})).toBeDisabled();
  52  |   await expect(page.getByText("Public capability preview")).toBeVisible();
  53  |   await page.screenshot({path:resolve(evidence,"merchant-wallet-approved-private-degraded-1440x900.png"),fullPage:true});
  54  |   expect(errors).toEqual([]);
  55  | });
  56  | 
  57  | test("rejected deterministic Wallet creates no account and public preview remains available",async({page})=>{
  58  |   const errors=[];
  59  |   page.on("console",message=>{if(message.type()==="error")errors.push(message.text())});
  60  |   await installProvider(page,{reject:true});
  61  |   await page.goto("/");
  62  |   await page.getByRole("button",{name:"Connect Wallet"}).click();
  63  |   await expect(page.getByText(/Not connected\. Public information remains available\./)).toBeVisible();
  64  |   await expect(page.getByText(/rejected/i)).toBeVisible();
  65  |   await expect(page.getByRole("button",{name:"Continue to private merchant session"})).toBeDisabled();
  66  |   await page.getByRole("button",{name:"Explore without signing in"}).click();
  67  |   await expect(page.getByText("Public capability preview")).toBeVisible();
  68  |   await page.screenshot({path:resolve(evidence,"merchant-wallet-rejected-public-preview-1440x900.png"),fullPage:true});
> 69  |   expect(errors).toEqual([]);
      |                  ^ Error: expect(received).toEqual(expected) // deep equality
  70  | });
  71  | 
  72  | test("Commerce roles and original logo remain usable on mobile",async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('navigation',{name:'Commerce'})).toBeVisible();await expect(page.getByRole('link',{name:'Merchant invoices'})).toHaveAttribute('aria-current','page');await expect(page.locator('.auth-mark img')).toBeVisible();expect(await page.locator('.auth-mark img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'merchant-commerce-mobile-390x844.png'),fullPage:true})});
  73  | 
  74  | // Controlled legacy API fixtures exercise product UI only. They are not an
  75  | // installed Wallet, canonical v2 approval, public service, or true SSO receipt.
  76  | async function installPrivateFixture(page,{role='owner',invoice}={}){
  77  |   await page.addInitScript(({role})=>{
  78  |     sessionStorage.setItem('ynx-merchant-id','mrc_qa');sessionStorage.setItem('ynx-merchant-session','controlled-qa-session');sessionStorage.setItem('ynx-merchant-role',role);sessionStorage.setItem('ynx-merchant-account','ynx1'+'q'.repeat(38));
  79  |   },{role});
  80  |   await page.route('**/runtime-config.js',route=>route.fulfill({contentType:'text/javascript',body:'globalThis.YNX_PAY_API_URL=location.origin;globalThis.YNX_APP_GATEWAY_URL="";'}));
  81  |   const state={merchants:{mrc_qa:{id:'mrc_qa',displayName:'Controlled Merchant',payoutAddress:'ynx1'+'q'.repeat(38)}},invoices:{},audit:[]};
  82  |   await page.route('**/v1/merchant/**',async route=>{
  83  |     const path=new URL(route.request().url()).pathname;
  84  |     if(path.endsWith('/invoices')&&invoice){await invoice(route);return}
  85  |     const value=path.endsWith('/state')?state:{netYnxt:0,grossYnxt:0,refundedYnxt:0,committedCount:0,invoiceCount:0,refundRequestCount:0,disputeCount:0,failedWebhookCount:0};
  86  |     await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
  87  |   });
  88  | }
  89  | 
  90  | test('failed invoice retains input and retry identity; successful invoice keeps unrelated draft',async({page})=>{
  91  |   const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  92  |   await installPrivateFixture(page,{invoice:async route=>{requests.push(route.request().postDataJSON());await route.fulfill({status:requests.length<3?503:201,contentType:'application/json',body:JSON.stringify(requests.length<3?{error:'Controlled unavailable'}:{id:'invoice-controlled'})})}});
  93  |   await page.goto('/');await page.getByRole('button',{name:'Create invoice',exact:true}).click();
  94  |   await page.locator('#description').fill('Order 42');await page.locator('#amount').fill('8');await page.locator('#tipAmount').fill('1');
  95  |   await page.locator('#itemName').fill('Keep this catalog draft');await page.locator('#itemAmount').fill('12');
  96  |   await page.getByRole('button',{name:'Create through central Pay API'}).click();
  97  |   await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('#description')).toHaveValue('Order 42');await expect(page.locator('#amount')).toHaveValue('8');await expect(page.locator('#tipAmount')).toHaveValue('1');
  98  |   await page.getByRole('button',{name:'Create through central Pay API'}).click();
  99  |   await expect.poll(()=>requests.length).toBe(2);await expect(page.getByRole('alert')).toBeVisible();expect(requests[1]).toEqual(requests[0]);
  100 |   await page.locator('#description').fill('Order 42 revised');await page.getByRole('button',{name:'Create through central Pay API'}).click();
  101 |   await expect(page.getByRole('alert')).toContainText('earlier merchant request');expect(requests).toHaveLength(2);
  102 |   await page.locator('#description').fill('Order 42');await page.getByRole('button',{name:'Create through central Pay API'}).click();
  103 |   await expect.poll(()=>requests.length).toBe(3);await expect(page.locator('#description')).toHaveValue('');await expect(page.locator('#itemName')).toHaveValue('Keep this catalog draft');
  104 |   expect(requests[2]).toEqual(requests[1]);expect(requests[2].amount).toBe(8);expect(requests[2].tipAmount).toBe(1);expect(requests[2].expiresInMinutes).toBe(30);
  105 |   await page.getByRole('button',{name:'Overview',exact:true}).first().click();await page.getByRole('button',{name:'Create invoice',exact:true}).click();await expect(page.locator('#itemName')).toHaveValue('Keep this catalog draft');
  106 |   await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText('Keep this catalog draft')).toHaveCount(0);
  107 |   expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();expect(errors).toEqual([]);
  108 | });
  109 | 
  110 | test('logout during a mutation never restores private workspace from its late response',async({page})=>{
  111 |   let release,started;const pending=new Promise(resolve=>started=resolve);
  112 |   await installPrivateFixture(page,{invoice:async route=>{started();await new Promise(resolve=>release=resolve);await route.fulfill({contentType:'application/json',body:'{"id":"late-invoice"}'}).catch(()=>{})}});
  113 |   await page.goto('/');await page.getByRole('button',{name:'Create invoice',exact:true}).click();await page.locator('#description').fill('Old account');await page.locator('#amount').fill('8');await page.getByRole('button',{name:'Create through central Pay API'}).click();await pending;
  114 |   await expect(page.getByRole('button',{name:'Create through central Pay API'})).toBeDisabled();await page.getByRole('button',{name:'Sign out',exact:true}).click();release();
  115 |   await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText('Controlled Merchant')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();
  116 | });
  117 | 
  118 | test('viewer overview hides invoice creation and merchant forms',async({page})=>{
  119 |   await installPrivateFixture(page,{role:'viewer'});await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();await expect(page.getByRole('button',{name:'Create invoice',exact:true})).toHaveCount(0);await expect(page.locator('#invoice-form')).toHaveCount(0);
  120 | });
  121 | 
  122 | test('authenticated mobile navigation reaches settings without document overflow',async({page})=>{
  123 |   await page.setViewportSize({width:390,height:844});await installPrivateFixture(page,{role:'viewer'});await page.goto('/');await expect(page.getByText('Controlled Merchant')).toHaveCount(1);
  124 |   await page.locator('.mobile-nav').getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByRole('heading',{name:'Security',exact:true})).toBeVisible();await expect(page.locator('[data-locale]')).toBeVisible();
  125 |   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,'merchant-private-controlled-mobile-390x844.png'),fullPage:true});
  126 | });
  127 | 
  128 | test('authoritative session rejection clears private records and requires new approval',async({page})=>{
  129 |   await installPrivateFixture(page);await page.goto('/');await expect(page.getByText('Controlled Merchant')).toBeVisible();
  130 |   await page.route('**/v1/merchant/state',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"Session expired"}'}));
  131 |   await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('heading',{name:'Merchant Console'})).toBeVisible();await expect(page.getByText(/Your merchant session expired/)).toBeVisible();await expect(page.getByText('Controlled Merchant')).toHaveCount(0);expect(await page.evaluate(()=>sessionStorage.getItem('ynx-merchant-session'))).toBeNull();
  132 | });
  133 | 
  134 | 
  135 | test('reload retains opaque original invoice key and blocks replacement until exact retry',async({page})=>{
  136 |  const sent=[];await installPrivateFixture(page,{invoice:async route=>{sent.push(route.request().postDataJSON());await route.fulfill({status:sent.length===1?503:201,contentType:'application/json',body:sent.length===1?'{"error":"response unknown"}':'{"id":"original-recovered"}'})}});
  137 |  await page.goto('/');await page.getByRole('button',{name:'Create invoice',exact:true}).click();await page.locator('#description').fill('Original invoice');await page.locator('#amount').fill('8');await page.getByRole('button',{name:'Create through central Pay API'}).click();await expect(page.getByRole('alert')).toBeVisible();
  138 |  const journal=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('ynx-merchant-mutation-v1:')));expect(journal).toHaveLength(1);expect(JSON.stringify(journal)).not.toContain('Original invoice');
  139 |  await page.reload();await page.getByRole('button',{name:'Create invoice',exact:true}).click();await page.locator('#description').fill('Different invoice');await page.locator('#amount').fill('9');await page.getByRole('button',{name:'Create through central Pay API'}).click();await expect(page.getByRole('alert')).toContainText('earlier merchant request');expect(sent).toHaveLength(1);
  140 |  await page.locator('#description').fill('Original invoice');await page.locator('#amount').fill('8');await page.getByRole('button',{name:'Create through central Pay API'}).click();await expect.poll(()=>sent.length).toBe(2);expect(sent[1]).toEqual(sent[0]);await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx-merchant-mutation-v1:')).length)).toBe(0);
  141 | });
  142 | 
```