import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const fixtureURL = process.env.YNX_QA_PANEL_URL;
if (!fixtureURL) throw new Error('YNX_QA_PANEL_URL must name the isolated Vite test/fixtures/native-panel.html entry');
const scenario = process.env.YNX_QA_PANEL_SCENARIO;
const browser = await chromium.launch({headless:true});
const checks = [], errors = [];
const catalog = (id, name = 'Current ' + id) => ({configured:true,kernel:'1.109.5',nativeProjects:[],sessions:[],walletProjectExists:true,projectRevision:1,walletProjects:[{projectId:id,name,revision:1}]});
const answer = (route, value, status = 200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
try {
  if (!scenario || scenario === 'catalog') {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let first, count = 0;
    await page.route('**/runtime/**', async route => {
      if (route.request().url().endsWith('/identity')) return answer(route,{connected:true,account:'account-A'});
      const id = new URL(route.request().url()).searchParams.get('projectId');
      if (id === 'A' && ++count === 1) { first = route; return; }
      return answer(route, catalog(id));
    });
    await page.goto(fixtureURL);
    await page.getByText('Wallet identity: account-A').waitFor();
    await page.evaluate(() => window.selectGuest('B'));
    await page.locator('strong').filter({hasText:'Current B'}).waitFor();
    await page.evaluate(() => window.selectGuest('A'));
    await page.locator('strong').filter({hasText:'Current A'}).waitFor();
    await answer(first, catalog('A', 'Retired A'));
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Retired A',{exact:true}).count(),0);
    await page.locator('strong').filter({hasText:'Current A'}).waitFor();
    checks.push('A -> B -> A: delayed first A cannot replace the current catalog');
    await page.close();
  }
  for (const logoutStatus of (!scenario || scenario === 'logout') ? [503, 200] : []) {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let held, logout, logoutCount = 0;
    await page.route('**/runtime/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/logout')) { logoutCount++; if (logoutCount === 1) { logout = route; return; } return answer(route,{centralRevoked:true,workspacesStopped:true}); }
      if (path.endsWith('/identity')) return answer(route,{connected:logoutCount===0,account:'account-A'});
      const id = new URL(route.request().url()).searchParams.get('projectId');
      if (id === 'B' && !held) { held = route; return; }
      return answer(route,catalog(id));
    });
    await page.goto(fixtureURL);
    await page.getByText('Wallet identity: account-A').waitFor();
    await page.evaluate(() => window.selectGuest('B'));
    await page.getByText('Wallet identity: account-A').waitFor();
    await page.getByRole('button',{name:'Sign out on this device',exact:true}).click();
    await page.waitForTimeout(100);
    await answer(held,catalog('B','Private retired project'));
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Private retired project',{exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Open project',exact:true}).count(),0);
    assert.equal(await page.getByRole('link',{name:'Sign in with YNX Wallet'}).count(),0);
    await page.getByRole('button',{name:'Retry sign-out'}).waitFor();
    await answer(logout,{centralRevoked:true,workspacesStopped:false,error:'unconfirmed'},logoutStatus);
    await page.getByRole('button',{name:'Retry sign-out'}).click();
    await page.getByRole('link',{name:'Sign in with YNX Wallet'}).waitFor();
    assert.equal(logoutCount,2);
    assert.equal(await page.getByText('Wallet identity: account-A').count(),0);
    checks.push(`logout (${logoutStatus}): delayed private catalog stays retired; unconfirmed stop retains retry; successful retry restores sign-in`);
    await page.close();
  }
  if (!scenario || scenario === 'launch') {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let held, identities = 0, launches = 0;
    await page.route('**/runtime/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/identity')) {
        identities++;
        if (identities === 2) { held = route; return; }
        return answer(route,{connected:true,account:'account-A',csrf:'review'});
      }
      if (path.endsWith('/activity')) return answer(route,{ok:true});
      if (route.request().method() === 'POST') { launches++; return answer(route,{ok:true}); }
      const id = new URL(route.request().url()).searchParams.get('projectId');
      return answer(route,{...catalog(id),nativeProjects:[id]});
    });
    await page.goto(fixtureURL);
    await page.getByRole('button',{name:'Open project',exact:true}).click();
    await page.waitForTimeout(50); assert.ok(held,'launch is awaiting trusted activity verification');
    await page.evaluate(() => window.selectGuest('B'));
    await page.locator('strong').filter({hasText:'Current B'}).waitFor();
    await page.evaluate(() => window.selectGuest('A'));
    await page.locator('strong').filter({hasText:'Current A'}).waitFor();
    await answer(held,{connected:true,account:'account-A',csrf:'old-review'});
    await page.waitForTimeout(100);
    assert.equal(launches,0,'a retired click must not start a workspace after A -> B -> A');
    assert.equal(await page.getByRole('button',{name:'Open project',exact:true}).isEnabled(),true);
    checks.push('retired launch: delayed activity completion cannot dispatch an old workspace start after A -> B -> A');
    await page.close();
  }
  if (!scenario || scenario === 'denied') {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let identities = 0, launches = 0;
    await page.route('**/runtime/**', async route => {
      if (new URL(route.request().url()).pathname.endsWith('/identity'))
        return answer(route,{connected:++identities === 1,account:'account-A',csrf:'review'});
      if (route.request().method() === 'POST') { launches++; return answer(route,{ok:true}); }
      return answer(route,{...catalog('A'),nativeProjects:['A']});
    });
    await page.goto(fixtureURL);
    await page.getByRole('button',{name:'Open project',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Sign in again before opening'}).waitFor();
    assert.equal(launches,0,'failed activity admission must not dispatch a launch');
    checks.push('failed current identity/activity admission preserves files and does not launch');
    await page.close();
  }
  assert.deepEqual(errors,[]);
} finally {
  await browser.close();
  if (process.env.YNX_QA_PANEL_RECEIPT) await writeFile(process.env.YNX_QA_PANEL_RECEIPT,JSON.stringify({checks,errors,actualChromium:true,actualReactPanel:true,backend:'controlled HTTP routes',fullWorkbench:false,public:false},null,2));
}
console.log(JSON.stringify({checks,errors}));
