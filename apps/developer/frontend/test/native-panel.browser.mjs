import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const fixtureURL = process.env.YNX_QA_PANEL_URL;
if (!fixtureURL) throw new Error('YNX_QA_PANEL_URL must name the isolated Vite test/fixtures/native-panel.html entry');
const scenario = process.env.YNX_QA_PANEL_SCENARIO;
const browser = await chromium.launch({headless:true});
const checks = [], errors = [];
let passed = false;
const catalog = (id, name = 'Current ' + id) => ({account:'account-A',generation:1,identityKey:'identity-A',configured:true,kernel:'1.109.5',nativeProjects:[],sessions:[],walletProjectExists:true,projectRevision:1,walletProjects:[{projectId:id,name,revision:1}]});
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
    await page.getByRole('button',{name:'Loading Wallet projects…',exact:true}).waitFor();
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
      if (logoutCount > 0) return answer(route,{error:'Signed out',code:'workspace_session_required'},401);
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
        if (identities === 1) { held = route; return; }
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
        return answer(route,{connected:false,account:'account-A',csrf:'review'});
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
  for (const action of (!scenario || scenario === 'binding') ? ['launch', 'stop', 'copy'] : []) {
    for (const changed of [false, true]) {
      const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
      let key = 'identity-A', actor = 'account-A', identityReads = 0, effects = 0, seenKey, walletExists = action !== 'copy';
      let sessions = action === 'stop' ? [{sessionId:'native-session',projectId:'A',status:'running',failure:null,launchURL:'/codeoss/'}] : [];
      await page.route('**/runtime/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (path === '/runtime/identity') { identityReads++; return answer(route,{connected:true,account:actor,csrf:'activity-proof'}); }
        if (path === '/runtime/identity/activity') return answer(route,{ok:true});
        if (path === '/runtime/codeoss' && request.method() === 'GET') return answer(route,{...catalog('A'),account:actor,identityKey:key,nativeProjects:['A'],walletProjectExists:walletExists,sessions});
        seenKey = request.headers()['x-ynx-agent-identity'];
        if (seenKey !== key) return answer(route,{error:'The displayed Wallet session changed. Sign in again.',code:'core_consumer_identity_changed'},401);
        effects++;
        if (action === 'launch') sessions = [{sessionId:'new-session',projectId:'A',status:'running',failure:null,launchURL:'/codeoss/'}];
        if (action === 'stop') sessions = [];
        if (action === 'copy') walletExists = true;
        return answer(route,{ok:true});
      });
      await page.goto(fixtureURL); await page.getByText('Wallet identity: account-A',{exact:true}).waitFor();
      assert.equal(identityReads,0,'the displayed identity must come from the same catalog, not an independent identity fetch');
      if (action === 'copy') await page.getByRole('checkbox',{name:'Copy this project to the account shown above.',exact:true}).check();
      if (changed) { key = 'identity-B'; actor = 'account-B'; }
      await page.getByRole('button',{name:action === 'launch' ? 'Open project' : action === 'stop' ? 'Stop workspace' : 'Copy project',exact:true}).click();
      if (changed) {
        await page.getByRole('link',{name:'Sign in with YNX Wallet',exact:true}).waitFor();
        assert.equal(effects,0); assert.equal(await page.getByText('Wallet identity: account-A',{exact:true}).count(),0);
        assert.equal(await page.getByRole('link',{name:'Return to editor ↗',exact:true}).count(),0);
      } else {
        await page.getByRole('button',{name:action === 'launch' ? 'Stop workspace' : 'Open project',exact:true}).waitFor();
        assert.equal(effects,1);
        if (action === 'launch' && process.env.YNX_QA_PANEL_SCREENSHOT) await page.screenshot({path:process.env.YNX_QA_PANEL_SCREENSHOT,fullPage:true});
      }
      assert.equal(seenKey,'identity-A');
      checks.push(`${action}: ${changed ? 'cookie switch before dispatch preserves the displayed actor binding, rejects all effects and retires private UI' : 'explicit action carries catalog identity and refreshes authenticated recovery state'}`);
      await page.close();
    }
  }
  if (!scenario || scenario === 'refresh') {
    const page = await browser.newPage(); let pending, hold = false;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/runtime/**', async route => {
      if (hold) { pending = route; return; }
      return answer(route,{...catalog('A'),nativeProjects:['A']});
    });
    await page.goto(fixtureURL); await page.getByText('Wallet identity: account-A',{exact:true}).waitFor();
    hold = true; await page.getByRole('button',{name:'Refresh Wallet projects',exact:true}).click();
    await page.getByRole('button',{name:'Loading Wallet projects…',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Open project',exact:true}).isDisabled(),true);
    assert.equal(await page.getByLabel('Native Wallet projects',{exact:true}).isDisabled(),true);
    assert.ok(pending); hold = false;
    await answer(pending,{...catalog('A'),account:'account-B',generation:2,identityKey:'identity-B',nativeProjects:['A']});
    await page.getByText('Wallet identity: account-B',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Open project',exact:true}).isEnabled(),true);
    checks.push('Native catalog refresh immediately disables mutation and project selection until the new single-source actor is installed');
    await page.close();
  }
  if (!scenario || scenario === 'recovery') {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let recovery = false, stopped = false; const bindings = [];
    await page.route('**/runtime/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (path === '/runtime/identity') return answer(route,{connected:true,account:'account-A',csrf:'activity'});
      if (path === '/runtime/identity/activity') return answer(route,{ok:true});
      if (request.method() === 'POST') { bindings.push(request.headers()['x-ynx-agent-identity']); recovery = true; return answer(route,{error:'The workspace needs safe stop recovery.',code:'core_launch_recovery_required'},503); }
      if (request.method() === 'DELETE') { bindings.push(request.headers()['x-ynx-agent-identity']); stopped = true; return answer(route,{ok:true}); }
      return answer(route,{...catalog('A'),nativeProjects:['A'],sessions:recovery && !stopped ? [{sessionId:'recover-me',projectId:'A',status:'recovery-required',failure:'driver-stop-unconfirmed'}] : []});
    });
    await page.goto(fixtureURL); await page.getByRole('button',{name:'Open project',exact:true}).click();
    await page.getByRole('button',{name:'Stop workspace',exact:true}).click();
    await page.getByRole('button',{name:'Open project',exact:true}).waitFor();
    assert.equal(stopped,true); assert.deepEqual(bindings,['identity-A','identity-A']);
    checks.push('A 503 launch recovery response re-reads the authenticated catalog and exposes the preserved session for explicit Stop');
    await page.close();
  }
  if (!scenario || scenario === 'project-identity') {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let actor = 'A'; const reads = [];
    await page.route('**/runtime/**', async route => {
      const selected = new URL(route.request().url()).searchParams.get('projectId'); reads.push(selected);
      return answer(route,{...catalog(selected),account:`account-${actor}`,identityKey:`identity-${actor}`,nativeProjects:[selected],walletProjects:[{projectId:`owned-${actor}`,name:`Owned ${actor}`,revision:1}]});
    });
    await page.goto(fixtureURL); await page.getByText('Wallet identity: account-A',{exact:true}).waitFor();
    await page.getByLabel('Native Wallet projects',{exact:true}).selectOption('owned-A');
    await page.locator('strong').filter({hasText:'Owned A'}).waitFor(); actor = 'B';
    await page.getByRole('button',{name:'Refresh Wallet projects',exact:true}).click();
    await page.getByText('Wallet identity: account-B',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Open project',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Native Wallet projects',{exact:true}).inputValue(),'owned-B');
    assert.ok(reads.includes('owned-B'));
    assert.equal(await page.getByRole('button',{name:'Copy project',exact:true}).count(),0);
    checks.push('Account refresh retires a missing old private project and re-reads an available project; it never offers to import another private project as guest data');
    await page.close();
  }
  for (const mode of (!scenario || scenario === 'create') ? ['normal', 'lost-response', 'switched-account'] : []) {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    let created, key = 'identity-A'; const creates = [];
    await page.route('**/runtime/**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname === '/runtime/identity/projects') {
        const body = req.postDataJSON(); creates.push({body,key:req.headers()['x-ynx-agent-identity']});
        if (creates.at(-1).key !== key) return answer(route,{error:'The displayed Wallet session changed.',code:'core_consumer_identity_changed'},401);
        created = {projectId:'wallet-'+body.approvalId,name:body.name,revision:1};
        if (mode === 'lost-response' && creates.length === 1) return answer(route,{error:'Creation confirmation was interrupted.'},503);
        return answer(route,{created:true,projectId:created.projectId,revision:1,replayed:creates.length > 1},creates.length > 1 ? 200 : 201);
      }
      const id = url.searchParams.get('projectId') || 'A';
      return answer(route,{...catalog(id,id === created?.projectId ? created.name : 'Current '+id),walletProjects:[{projectId:'A',name:'Current A',revision:1},...(created ? [created] : [])]});
    });
    await page.goto(fixtureURL); await page.getByText('Wallet identity: account-A',{exact:true}).waitFor();
    await page.getByText('New Wallet project',{exact:true}).click();
    await page.getByLabel('New project name',{exact:true}).fill(' My new project ');
    assert.equal(await page.getByRole('button',{name:'Create Wallet project',exact:true}).isDisabled(),true);
    await page.getByRole('checkbox',{name:'Create an empty project for account-A.',exact:true}).check();
    if (mode === 'switched-account') key = 'identity-B';
    await page.getByRole('button',{name:'Create Wallet project',exact:true}).click();
    if (mode === 'switched-account') {
      await page.getByRole('link',{name:'Sign in with YNX Wallet',exact:true}).waitFor();
      assert.equal(created,undefined); assert.equal(await page.getByLabel('New project name',{exact:true}).count(),0);
    } else {
      if (mode === 'lost-response') {
        await page.getByRole('alert').filter({hasText:'Creation confirmation was interrupted.'}).waitFor();
        await page.getByRole('button',{name:'Create Wallet project',exact:true}).click();
        assert.deepEqual(creates[0],creates[1]);
      }
      await page.locator('strong').filter({hasText:'My new project'}).waitFor();
      assert.equal(await page.getByLabel('Native Wallet projects',{exact:true}).inputValue(),created.projectId);
      assert.equal(await page.getByLabel('New project name',{exact:true}).inputValue(),'');
      assert.equal(await page.getByRole('button',{name:'Create Wallet project',exact:true}).isDisabled(),true);
    }
    assert.equal(creates[0].body.name,'My new project'); assert.equal(creates[0].key,'identity-A');
    checks.push(`new Wallet project (${mode}): explicit displayed-account approval, scoped creation, no automatic retry, durable UUID on manual retry`);
    await page.close();
  }
  assert.deepEqual(errors,[]); passed = true;
} finally {
  await browser.close();
  if (process.env.YNX_QA_PANEL_RECEIPT) await writeFile(process.env.YNX_QA_PANEL_RECEIPT,JSON.stringify({passed,checks,errors,actualChromium:true,actualReactPanel:true,backend:'controlled HTTP routes',fullWorkbench:false,public:false},null,2));
}
console.log(JSON.stringify({checks,errors}));
