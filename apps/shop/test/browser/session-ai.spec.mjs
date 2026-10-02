import {test,expect,installPrivateShop,orderFixture} from './shop-fixture.mjs';

test('authoritative 401 removes private records, address fields and open dialogs',async({page})=>{
  await installPrivateShop(page,{cart:[{ProductID:'qa-product',VariantID:'qa-variant',Quantity:1}],orders:[orderFixture()]});
  await page.locator('#ordersButton').click();await expect(page.locator('#orders')).toContainText('qa-order');await page.locator('#profileButton').click();await expect(page.locator('#profileForm [name="line1"]')).toHaveValue('Private QA address');
  await page.route('**/api/profile',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"Session expired"}'}));
  await page.getByRole('button',{name:'Save profile & address',exact:true}).click();
  await expect(page.locator('#status')).toContainText('Your Shop session expired');await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('#orders')).toBeEmpty();await expect(page.locator('#cartCount')).toHaveText('0');await expect(page.locator('#profileForm [name="line1"]')).toHaveValue('');await expect(page.locator('#checkout [name="line1"]')).toHaveValue('');
  expect(await page.evaluate(async()=> (await import('/wallet-auth.js')).token())).toBe('');
});

test('close and reopen fences late provider chunks and run responses',async({page})=>{
  await page.addInitScript(()=>{
    const original=globalThis.fetch;globalThis.qaStreams={};
    globalThis.fetch=(input,options)=>{
      if(String(input).endsWith('/stream'))return Promise.resolve(new Response(new ReadableStream({start(controller){globalThis.qaStreams.controller=controller},cancel(){globalThis.qaStreams.cancelled=true}}),{headers:{'Content-Type':'text/event-stream'}}));
      return original(input,options);
    };
  });
  await installPrivateShop(page);let releaseRun,started=false;const gate=new Promise(resolve=>releaseRun=resolve);const cancellations=[];
  await page.route('**/api/ai/jobs**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/run')){started=true;await gate;await route.fulfill({contentType:'application/json',body:'{"ID":"old-ai","Status":"review_required","Result":"OLD PRIVATE RESULT"}'}).catch(()=>{});return}
    if(path.endsWith('/cancel'))cancellations.push(path);
    await route.fulfill({contentType:'application/json',body:JSON.stringify({ID:'old-ai',Status:path.endsWith('/cancel')?'cancelled':'permission_granted'})});
  });
  await page.locator('#compare').click();await page.locator('#aiGrant').click();await expect.poll(()=>started).toBe(true);await expect(page.locator('#aiGrant')).toBeDisabled();await page.locator('#aiCancel').click();await page.locator('#compare').click();
  await page.evaluate(()=>qaStreams.controller.enqueue(new TextEncoder().encode('data: {"Status":"OLD PRIVATE CHUNK","ProviderStatus":"old"}\n\n')));releaseRun();
  await expect.poll(()=>cancellations.length).toBe(1);await expect.poll(()=>page.evaluate(()=>qaStreams.cancelled)).toBe(true);
  await expect(page.locator('#aiState')).toContainText('Context preview accepted only after review');await expect(page.locator('#aiReview')).toBeHidden();await expect(page.locator('#aiGrant')).toBeEnabled();
});

test('a late apply cannot open an order action or change a reopened AI dialog',async({page})=>{
  await installPrivateShop(page,{orders:[orderFixture()]});let releaseDecision,started=false;const gate=new Promise(resolve=>releaseDecision=resolve);
  await page.route('**/api/ai/jobs**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/stream'))return route.fulfill({contentType:'text/event-stream',body:'data: {"Status":"review_required","ProviderStatus":"available"}\n\n'});
    if(path.endsWith('/decision')){started=true;await gate;await route.fulfill({contentType:'application/json',body:'{"ID":"qa-ai","Status":"applied_draft","Result":"OLD RETURN EXPLANATION"}'}).catch(()=>{});return}
    await route.fulfill({contentType:'application/json',body:JSON.stringify({ID:'qa-ai',Status:path.endsWith('/run')?'review_required':'permission_granted',Result:'Return explanation for review'})});
  });
  await page.locator('#ordersButton').click();await page.getByRole('button',{name:'AI return explanation',exact:true}).click();await expect(page.locator('#aiContextPreview')).toContainText('Owned order qa-order');await page.locator('#aiGrant').click();await expect(page.locator('#aiReview')).toBeVisible();await page.locator('#aiApply').click();await expect.poll(()=>started).toBe(true);await page.locator('#aiCancel').click();await page.locator('#compare').click();releaseDecision();
  await expect(page.locator('#aiDialog h2')).toHaveText('AI product comparison');await expect(page.locator('#aiState')).toContainText('Context preview accepted only after review');await expect(page.locator('#actionDialog')).not.toBeVisible();await expect(page.locator('#aiReview')).toBeHidden();
});

test('stream 401 clears the active private session and AI presentation',async({page})=>{
  await installPrivateShop(page,{orders:[orderFixture()]});
  await page.route('**/api/ai/jobs**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/stream'))return route.fulfill({status:401,contentType:'application/json',body:'{"error":"Session revoked"}'});
    await route.fulfill({contentType:'application/json',body:JSON.stringify({ID:'qa-ai',Status:path.endsWith('/run')?'review_required':'permission_granted',Result:'Discard this result'})});
  });
  await page.locator('#compare').click();await page.locator('#aiGrant').click();await expect(page.locator('#status')).toContainText('Your Shop session expired');await expect(page.locator('#aiDialog')).not.toBeVisible();await expect(page.locator('#aiState')).toBeEmpty();await expect(page.locator('#orders')).toBeEmpty();
});

test('logout while Gateway challenge is pending prevents session completion',async({page})=>{
  let release,started=false;const gate=new Promise(resolve=>release=resolve);
  const {requests}=await installPrivateShop(page,{waitForSession:false,beforeNavigate:async()=>{
    await page.route('**/api/auth/gateway/challenges',async route=>{started=true;await gate;await route.fulfill({contentType:'application/json',body:'{"challenge":{"nonce":"obsolete"}}'}).catch(()=>{})});
  }});
  await expect.poll(()=>started).toBe(true);await page.locator('#disconnectWallet').click();release();await expect(page.locator('#status')).toContainText('Signed out.');
  expect(await page.evaluate(()=>sessionStorage.getItem('ynx_wallet_pending'))).toBeNull();expect(requests.filter(request=>request.path.endsWith('/gateway/sessions'))).toHaveLength(0);expect(await page.evaluate(async()=> (await import('/wallet-auth.js')).token())).toBe('');
});

test('changing buyer view closes AI and prevents a late result entering that view',async({page})=>{
  await installPrivateShop(page);let release,started=false;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/ai/jobs**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/run')){started=true;await gate;await route.fulfill({contentType:'application/json',body:'{"ID":"qa-ai","Status":"review_required","Result":"OLD VIEW RESULT"}'}).catch(()=>{});return}
    if(path.endsWith('/stream'))return route.fulfill({contentType:'text/event-stream',body:'data: {"Status":"running"}\n\n'});
    return route.fulfill({contentType:'application/json',body:'{"ID":"qa-ai","Status":"permission_granted"}'});
  });
  await page.locator('#compare').click();await page.locator('#aiGrant').click();await expect.poll(()=>started).toBe(true);
  // Modal UI blocks the underlying navigation. Exercise the view transition
  // event itself, as keyboard/app navigation may issue it independently.
  await page.locator('#profileButton').evaluate(button=>button.click());release();await expect(page.locator('#aiDialog')).not.toBeVisible();await expect(page.locator('#profileDialog')).toBeVisible();await expect(page.locator('#aiState')).toBeEmpty();await expect(page.locator('#profileForm [name="line1"]')).toHaveValue('Private QA address');
});

test('current approved AI result can be reviewed and applied only as a draft',async({page})=>{
  const {requests}=await installPrivateShop(page);const decisions=[];
  await page.route('**/api/ai/jobs**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path.endsWith('/stream'))return route.fulfill({contentType:'text/event-stream',body:'data: {"Status":"running","ProviderStatus":"available"}\n\n'});
    if(path.endsWith('/decision'))decisions.push(request.postDataJSON());
    await route.fulfill({contentType:'application/json',body:JSON.stringify({ID:'qa-ai',Status:path.endsWith('/run')?'review_required':path.endsWith('/decision')?'applied_draft':'permission_granted',Result:'Controlled product comparison'})});
  });
  await page.locator('#compare').click();await page.locator('#aiGrant').click();await expect(page.locator('#aiReview')).toBeVisible();await expect(page.locator('#aiState')).toHaveText('Controlled product comparison');await page.locator('#aiApply').click();
  await expect(page.locator('#aiDialog')).not.toBeVisible();await expect(page.locator('#status')).toContainText('Comparison draft for review: Controlled product comparison');expect(decisions).toEqual([{Decision:'apply'}]);expect(requests.filter(request=>request.path==='/api/orders'&&request.method==='POST')).toHaveLength(0);
});
