import {test,expect,installPrivateShop} from './shop-fixture.mjs';

test('original private approval survives missing Browser identity and offers explicit sign-in',async({page})=>{
 await installPrivateShop(page,{waitForSession:false,beforeNavigate:async()=>{
  await page.route('https://shop.ynxweb4.com/api/sso/account',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'SSO_LOGIN_REQUIRED'})}));
 }});
 await expect(page.locator('#browserSignIn')).toBeVisible();
 await expect(page.locator('#browserSignIn')).toHaveAttribute('href','/sso/start?target=overview');
 await expect(page.locator('#privateSession')).toHaveText(/active|已连接|已授权/i);
 await expect(page.locator('#wallet')).not.toHaveText('Wallet session active');
 await expect(page.locator('#status')).not.toContainText('Your Shop session expired');
 await page.locator('#profileButton').click();
 await expect(page.locator('#browserSignIn')).toBeVisible();
 await expect(page.locator('#status')).not.toContainText('Your Shop session expired');
});
