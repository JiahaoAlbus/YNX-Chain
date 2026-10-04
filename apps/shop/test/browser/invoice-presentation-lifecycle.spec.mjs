import {test,expect,installPrivateShop,orderFixture} from './shop-fixture.mjs';
const pending=()=>orderFixture({Status:'payment_pending',InvoiceID:'',PayIntentID:'',Settlement:null});
const originals=page=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('ynx-shop-invoice-v1:')&&!key.endsWith(':current')).map(([,value])=>JSON.parse(value)));
const settled=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

for(const close of ['button','escape','pagehide'])test(`${close} during invoice proof prevents dispatch and retry uses the original key`,async({page})=>{
 const f=await installPrivateShop(page,{orders:[pending()]});await page.locator('#ordersButton').click();
 let release,entered=false;const gate=new Promise(r=>release=r);
 const hold=async route=>{entered=true;await gate;await route.fallback();};await page.route('**/api/sso/account',hold);
 await page.locator('[data-action=pay]').click();await expect.poll(()=>entered).toBe(true);
 const [original]=await originals(page);expect(original.phase).toBe('prepared');
 if(close==='button')await page.locator('#closeInvoice').click();else if(close==='escape')await page.keyboard.press('Escape');else await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 const response=page.waitForResponse('**/api/sso/account');release();await (await response).finished();await page.unroute('**/api/sso/account',hold);await settled(page);
 await expect(page.locator('#invoiceDialog')).not.toBeVisible();
 expect(f.requests.filter(r=>r.path.endsWith('/pay-handoff')&&r.method==='POST')).toHaveLength(0);
 expect((await originals(page))[0].phase).toBe('prepared');
 await page.locator('[data-action=pay]').click();await expect(page.locator('#openInvoiceWallet')).toHaveAttribute('href','ynxpay://invoice/inv_original');
 const posts=f.requests.filter(r=>r.path.endsWith('/pay-handoff')&&r.method==='POST');expect(posts).toHaveLength(1);expect(posts[0].body.IdempotencyKey).toBe(original.key);
});

test('background after invoice dispatch preserves unknown and only reads the original invoice',async({page})=>{
 let release,entered=false;const gate=new Promise(r=>release=r);
 const f=await installPrivateShop(page,{orders:[pending()],beforeNavigate:async()=>{
  await page.route('**/api/orders/qa-order/pay-handoff',async route=>{if(route.request().method()==='POST'){entered=true;await gate;}await route.fallback();});
 }});
 await page.locator('#ordersButton').click();await page.locator('[data-action=pay]').click();await expect.poll(()=>entered).toBe(true);
 const [original]=await originals(page);expect(original.phase).toBe('unknown');
 await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 const response=page.waitForResponse('**/api/orders/qa-order/pay-handoff');release();await (await response).finished();await settled(page);
 await expect(page.locator('#invoiceDialog')).not.toBeVisible();expect((await originals(page))[0].phase).toBe('unknown');
 await page.locator('[data-action=pay]').click();await expect(page.locator('#openInvoiceWallet')).toHaveAttribute('href','ynxpay://invoice/inv_original');
 expect(f.requests.filter(r=>r.path.endsWith('/pay-handoff')&&r.method==='POST')).toHaveLength(1);
 expect(f.requests.filter(r=>r.path.endsWith('/pay-handoff')&&r.method==='GET')).toHaveLength(1);
 expect((await originals(page))[0].key).toBe(original.key);
});

test('Escape cancels Wallet request queued behind the original invoice lock',async({page})=>{
 await installPrivateShop(page,{orders:[pending()]});await page.locator('#ordersButton').click();await page.locator('[data-action=pay]').click();
 await expect(page.locator('#openInvoiceWallet')).toHaveAttribute('href','ynxpay://invoice/inv_original');
 await page.evaluate(async()=>{const base=Object.keys(localStorage).find(k=>k.startsWith('ynx-shop-invoice-v1:')&&k.endsWith(':current')).slice(0,-8);await new Promise(ready=>{window.invoiceHeld=navigator.locks.request(base,()=>new Promise(release=>{window.releaseInvoiceLock=release;ready();}));});});
 await page.locator('#openInvoiceWallet').click();await page.keyboard.press('Escape');await expect(page.locator('#invoiceDialog')).not.toBeVisible();
 await page.evaluate(async()=>{window.releaseInvoiceLock();await window.invoiceHeld;});await settled(page);
 expect((await originals(page))[0].phase).toBe('invoice_ready');
 await page.locator('[data-action=pay]').click();await expect(page.locator('#openInvoiceWallet')).toHaveAttribute('href','ynxpay://invoice/inv_original');
});
