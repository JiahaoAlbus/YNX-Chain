import {test,expect,installPrivateShop} from './shop-fixture.mjs';

test('guest can read public seller policy without private proof or cart mutation',async({page})=>{
 let publicHeaders;
 const {requests}=await installPrivateShop(page,{prepareApproval:false,beforeNavigate:async()=>{
  await page.route('**/api/stores/qa-store',route=>{publicHeaders=route.request().headers();return route.fulfill({json:{Name:'Public original store',Policy:'Original public policy'}});});
 }});
 await page.locator('[data-product="qa-product"]').click();
 await expect(page.locator('#storeEvidence')).toContainText('Original public policy');
 for(const key of ['authorization','x-ynx-product-session-proof-v2','x-ynx-product-session-action-proof-v2'])expect(publicHeaders[key]).toBeUndefined();
 await page.locator('#add').click();
 expect(requests.filter(r=>r.path==='/api/cart'&&r.method==='PUT')).toHaveLength(0);
});

test('late seller read cannot replace a reopened product presentation',async({page})=>{
 let release,entered=false,first=true;const gate=new Promise(r=>release=r);
 await installPrivateShop(page,{beforeNavigate:async()=>{
  await page.route('**/api/stores/qa-store',async route=>{if(first){first=false;entered=true;await gate;await route.fulfill({json:{Name:'Old store response',Policy:'Old policy'}});}else await route.fulfill({json:{Name:'Current store response',Policy:'Current policy'}});});
 }});
 await page.locator('[data-product="qa-product"]').click();await expect.poll(()=>entered).toBe(true);
 await page.locator('#closeProduct').click();await page.locator('[data-product="qa-product"]').click();
 await expect(page.locator('#storeEvidence')).toContainText('Current policy');
 const readFinished=page.waitForResponse('**/api/stores/qa-store');release();await (await readFinished).finished();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('#storeEvidence')).toContainText('Current policy');
 await page.locator('#closeProduct').click();
 await page.locator('[data-product="qa-product"]').click();
 await expect(page.locator('#storeEvidence')).toContainText('Current policy');
});

for(const close of ['button','escape','pagehide'])test(`${close} during fresh proof prevents unsent cart change`,async({page})=>{
 const {requests}=await installPrivateShop(page);
 await page.locator('[data-product="qa-product"]').click();await expect(page.locator('#storeEvidence')).toContainText('Controlled QA policy');
 let release,entered=false;const gate=new Promise(r=>release=r);
 const hold=async route=>{entered=true;await gate;await route.fallback();};
 await page.route('**/api/sso/account',hold);
 await page.locator('#add').click();await expect.poll(()=>entered).toBe(true);
 if(close==='button')await page.locator('#closeProduct').click();else if(close==='escape')await page.keyboard.press('Escape');else await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
 await expect(page.locator('#productDialog')).not.toBeVisible();
 const resumed=page.waitForResponse('**/api/sso/account');release();await (await resumed).finished();await page.unroute('**/api/sso/account',hold);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.locator('[data-product="qa-product"]').click();await expect(page.locator('#storeEvidence')).toContainText('Controlled QA policy');
 // Readback completes after the released proof preparation; an unsent action
 // must still have no PUT, while the reopened product remains visible.
 await page.locator('#closeProduct').click();await page.locator('#cartButton').click();
 await expect(page.locator('#cartCount')).toHaveText('0');
 expect(requests.filter(r=>r.path==='/api/cart'&&r.method==='PUT')).toHaveLength(0);
});

test('late dispatched cart response cannot close a reopened product',async({page})=>{
 let release,entered=false;const gate=new Promise(r=>release=r);
 const {requests}=await installPrivateShop(page,{beforeNavigate:async()=>{
  await page.route('**/api/cart',async route=>{if(route.request().method()==='PUT'){entered=true;await gate;}await route.fallback();});
 }});
 await page.locator('[data-product="qa-product"]').click();await expect(page.locator('#storeEvidence')).toContainText('Controlled QA policy');
 await page.locator('#add').click();await expect.poll(()=>entered).toBe(true);
 await page.locator('#closeProduct').click();await page.locator('[data-product="qa-product"]').click();
 await expect(page.locator('#storeEvidence')).toContainText('Controlled QA policy');
 const completed=page.waitForResponse(response=>response.url().endsWith('/api/cart')&&response.request().method()==='PUT');release();await (await completed).finished();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('#productDialog')).toBeVisible();
 expect(requests.filter(r=>r.path==='/api/cart'&&r.method==='PUT')).toHaveLength(1);
});
