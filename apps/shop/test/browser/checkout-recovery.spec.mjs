import {test,expect,installPrivateShop,orderFixture,fixtureAccount} from './shop-fixture.mjs';
const confirmedOrder=overrides=>orderFixture({Buyer:fixtureAccount,CartConsumption:{PreviousRevision:'qa-cart-v1',Revision:'qa-cart-consumed'},...overrides});
const item={ProductID:'qa-product',VariantID:'qa-variant',Quantity:1};
const submit=async page=>{await page.locator('#cartButton').click();await page.locator('#checkout').evaluate(form=>form.requestSubmit());};
test('confirmed order survives cart refresh failure and no cleanup PUT is issued',async({page})=>{
 let created=false,posts=0,puts=0;await installPrivateShop(page,{cart:[item],beforeNavigate:async({state})=>{
 await page.route('**/api/cart',async route=>{if(route.request().method()==='PUT')puts++;if(created){await route.fulfill({status:503,json:{error:'cart read unavailable'}});return}await route.fallback()});
 await page.route('**/api/orders',async route=>{if(route.request().method()!=='POST'){await route.fallback();return}posts++;created=true;state.cart=[];await route.fulfill({status:201,json:confirmedOrder({ID:'confirmed-checkout',Status:'payment_pending'})})});
 }});await submit(page);await expect(page.locator('#orderState')).toContainText('Order confirmed-checkout confirmed');await expect(page.locator('#orderState')).toContainText('Cart refresh');expect(posts).toBe(1);expect(puts).toBe(0);const durable=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('ynx-shop-checkout-v1:')));expect(durable).toHaveLength(1);expect(durable[0][1]).not.toContain('Private QA address');
});
test('lost response keeps exact key, changed address cannot create replacement, explicit recovery returns receipt',async({page})=>{
 let allowLookup=false,posts=[];await installPrivateShop(page,{cart:[item],beforeNavigate:async()=>{
 await page.route('**/api/orders',async route=>{if(route.request().method()!=='POST'){await route.fallback();return}posts.push(route.request().postDataJSON());await route.abort('failed')});
 await page.route('**/api/orders/intent-lookup',async route=>{await route.fulfill(allowLookup?{json:confirmedOrder({ID:'recovered-checkout',Status:'payment_pending'})}:{status:404,json:{error:'not yet seen'}})});
 }});await submit(page);await expect(page.locator('#orderState')).toContainText('unconfirmed');await page.locator('#checkout [name=line1]').fill('Changed address');await page.locator('#checkout').evaluate(form=>form.requestSubmit());await expect(page.locator('#orderState')).toContainText('unconfirmed');expect(posts).toHaveLength(1);
 await page.locator('#checkout [name=line1]').fill('Private QA address');await page.locator('#checkout').evaluate(form=>form.requestSubmit());await expect(page.locator('#orderState')).toContainText('unconfirmed');expect(posts).toHaveLength(1);await expect(page.locator('#orderState')).toContainText('unconfirmed');allowLookup=true;await page.getByRole('button',{name:'Recover unconfirmed checkout'}).click();await expect(page.locator('#orderState')).toContainText('Order recovered-checkout confirmed');await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx-shop-checkout-v1:')).length)).toBe(0);
});
test('failed cart removal preserves visible original cart and concurrent clicks send one update',async({page})=>{
 let puts=0,release;const gate=new Promise(resolve=>release=resolve);await installPrivateShop(page,{cart:[item],beforeNavigate:async()=>{await page.route('**/api/cart',async route=>{if(route.request().method()!=='PUT'){await route.fallback();return}puts++;await gate;await route.fulfill({status:503,json:{error:'save unavailable'}})})}});
 await page.locator('#cartButton').click();await page.locator('[data-remove]').evaluate(button=>{button.click();button.click()});await expect.poll(()=>puts).toBe(1);release();await expect(page.locator('#orderState')).toContainText('save unavailable');await expect(page.locator('#cartLines')).toContainText('QA product');await expect(page.locator('#cartCount')).toHaveText('1');
});
test('reload and new approval recover the persisted key without saving an address',async({page})=>{
 const posts=[];let allowLookup=false;
 const intercept=async()=>{
  await page.route('**/api/orders',async route=>{if(route.request().method()!=='POST'){await route.fallback();return}posts.push(route.request().postDataJSON());await route.abort('failed')});
  await page.route('**/api/orders/intent-lookup',async route=>{await route.fulfill(allowLookup?{json:confirmedOrder({ID:'after-reapproval',Status:'payment_pending'})}:{status:404,json:{error:'unknown'}})});
 };
 await installPrivateShop(page,{cart:[item],beforeNavigate:intercept});await submit(page);await expect(page.locator('#orderState')).toContainText('unconfirmed');const key=posts[0].IdempotencyKey;
 await page.reload();allowLookup=true;await installPrivateShop(page,{cart:[],beforeNavigate:intercept});await page.locator('#cartButton').click();await page.getByRole('button',{name:'Recover unconfirmed checkout'}).click();await expect(page.locator('#orderState')).toContainText('Order after-reapproval confirmed');expect(posts).toHaveLength(1);expect(key).toBeTruthy();
});
test('two tabs prepare one durable checkout and deletion cannot overtake it',async({page,context})=>{
 const {account,requests}=await installPrivateShop(page);const second=await context.newPage();await second.goto('/');
 const prepare=target=>target.evaluate(async account=>{const {createCheckoutRecovery}=await import('/checkout-recovery.js');return createCheckoutRecovery().prepare(account,{CartRevision:'original',Items:[{ProductID:'p',VariantID:'v',Quantity:1}],Address:{Line1:'private'}},'original')},account);
 const [a,b]=await Promise.all([prepare(page),prepare(second)]);expect(a.key).toBe(b.key);
 await page.locator('#profileButton').click();await page.locator('#deleteConfirmation').fill('DELETE_MY_SHOP_DATA');await page.locator('#deleteData').click();await expect(page.locator('#privacyState')).toContainText('Recover the unconfirmed checkout');expect(requests.filter(r=>r.path==='/api/privacy/delete')).toHaveLength(0);await second.close();
});
test('a mismatched receipt never clears durable checkout evidence',async({page})=>{
 await installPrivateShop(page,{cart:[item],beforeNavigate:async()=>{
  await page.route('**/api/orders',async route=>{if(route.request().method()!=='POST'){await route.fallback();return}await route.fulfill({status:201,json:confirmedOrder({Buyer:'ynx1'+'p'.repeat(38),ID:'wrong-account'})})});
 }});await submit(page);await expect(page.locator('#orderState')).toContainText('owned order receipt is invalid');expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ynx-shop-checkout-v1:')).length)).toBe(1);
});
