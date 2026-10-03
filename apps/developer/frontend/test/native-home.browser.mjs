import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.YNX_QA_HOME_URL) throw Error('YNX_QA_HOME_URL must name the isolated frontend root');
const browser = await chromium.launch({ headless: true }), checks = [], errors = [], requests = [];
let passed = false;
const answer = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    const raw = '{saved guest draft needing recovery';
    await page.addInitScript(value => localStorage.setItem('ynx-code-project-v1', value), raw);
    await page.route('**/runtime/**', route => { const path = new URL(route.request().url()).pathname; if (!path.startsWith('/runtime/')) return route.continue(); requests.push({ method: route.request().method(), path }); return answer(route, { error: 'Sign in with your Wallet', code: 'core_identity_invalid' }, 401); });
    await page.goto(process.env.YNX_QA_HOME_URL);
    await page.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).waitFor();
    assert.equal(await page.locator('.monaco-editor').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.getItem('ynx-code-project-v1')), raw);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.getByRole('link', { name: 'Guest text workspace', exact: true }).getAttribute('href'), '/guest-workspace');
    if (width === 390 && process.env.YNX_QA_HOME_SCREENSHOT) await page.screenshot({ path: process.env.YNX_QA_HOME_SCREENSHOT, fullPage: true });
    await page.getByRole('link', { name: 'Guest text workspace', exact: true }).click();
    await page.getByRole('heading', { name: 'Your saved workspace needs recovery', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('ynx-code-project-v1')), raw);
    checks.push(`${width}px: native project home, no guest autosave/editor, preserved corrupt draft and explicit recovery route`);
    await page.close();
  }
  for (const mode of ['mac-workspace', 'windows-hosted']) {
    const desktop = await browser.newPage(); desktop.on('pageerror', e => errors.push(e.message));
    await desktop.addInitScript(kind => {
      localStorage.setItem('ynx-code-project-v1', '{desktop draft needing recovery');
      if (kind === 'mac-workspace') window.ynxDesktopWorkspace = { initialProject: null, saveProject: async () => {}, exportProject: async () => {} };
      else window.ynxHostedDesktop = true;
    }, mode);
    await desktop.goto(process.env.YNX_QA_HOME_URL);
    await desktop.getByRole('heading', { name: 'Your saved workspace needs recovery', exact: true }).waitFor();
    assert.equal(await desktop.getByRole('heading', { name: 'Your development workspace', exact: true }).count(), 0);
    assert.equal(await desktop.evaluate(() => localStorage.getItem('ynx-code-project-v1')), '{desktop draft needing recovery');
    checks.push(`${mode}: controlled document-start marker retains existing desktop recovery/workbench route; no installed-device claim`);
    await desktop.close();
  }
  const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
  page.on('pageerror', e => errors.push(e.message));
  let projects = [{ projectId: 'existing', name: 'Existing Wallet project', revision: 1 }], sessions = [], account = 'account-A', key = 'identity-A', creates = 0;
  await page.route('**/runtime/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, body = req.postDataJSON();
    if (!path.startsWith('/runtime/')) return route.continue();
    requests.push({ method: req.method(), path, body });
    if (path === '/runtime/identity') return answer(route, { connected: true, account, csrf: 'fixture-activity' });
    if (path === '/runtime/identity/activity') return answer(route, { accepted: true });
    if (path === '/runtime/identity/projects') {
      assert.equal(req.headers()['x-ynx-agent-identity'], key); creates++;
      const created = { projectId: 'wallet-' + body.approvalId, name: body.name, revision: 1 }; projects.push(created);
      return answer(route, { created: true, projectId: created.projectId, revision: 1 }, 201);
    }
    if (path === '/runtime/codeoss' && req.method() === 'POST') {
      assert.equal(req.headers()['x-ynx-agent-identity'], key);
      sessions = [{ sessionId: '12345678-1234-1234-1234-123456789012', projectId: body.projectId, status: 'running', failure: null, launchURL: '/sso/core-open?sessionId=12345678-1234-1234-1234-123456789012' }];
      return answer(route, { session: sessions[0] }, 201);
    }
    const id = url.searchParams.get('projectId');
    return answer(route, { account, generation: 1, identityKey: key, configured: true, kernel: '1.109.5', nativeProjects: sessions.map(row => row.projectId), sessions, walletProjectExists: projects.some(row => row.projectId === id), projectRevision: 1, walletProjects: projects });
  });
  await page.goto(process.env.YNX_QA_HOME_URL);
  await page.locator('strong').filter({ hasText: 'Existing Wallet project' }).waitFor();
  assert.equal(await page.getByLabel('Native Wallet projects', { exact: true }).inputValue(), 'existing');
  assert.equal(await page.getByRole('option', { name: /Current guest project/ }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Copy project', exact: true }).count(), 0);
  checks.push('real root selects authenticated existing project; no invented guest copy target');
  await page.getByText('New Wallet project', { exact: true }).click();
  await page.getByLabel('New project name', { exact: true }).fill('My Wallet app');
  await page.getByRole('checkbox', { name: 'Create an empty project for account-A.', exact: true }).check();
  await page.getByRole('button', { name: 'Create Wallet project', exact: true }).click();
  await page.locator('strong').filter({ hasText: 'My Wallet app' }).waitFor();
  assert.equal(creates, 1);
  await page.getByRole('checkbox', { name: 'Use the native workspace for this project.', exact: true }).check();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('link', { name: 'Return to editor ↗', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Return to editor ↗', exact: true }).getAttribute('href'), sessions[0].launchURL);
  assert.ok(requests.some(row => row.path === '/runtime/identity/activity'));
  checks.push('normal root creation -> selected project -> explicit admission -> existing editor ticket link; no mocked editor acceptance');
  projects = []; sessions = []; account = 'account-B'; key = 'identity-B';
  await page.getByRole('button', { name: 'Refresh Wallet projects', exact: true }).click();
  await page.getByText('No Wallet projects yet. Create your first project below.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Return to editor ↗', exact: true }).count(), 0);
  assert.equal(await page.locator('strong').filter({ hasText: 'My Wallet app' }).count(), 0);
  assert.equal(await page.getByLabel('Native Wallet projects', { exact: true }).count(), 0);
  checks.push('account switch to empty catalog retires prior project/session UI and allows reviewed first-project creation');
  await page.close();
  assert.ok(requests.filter(row => row.method !== 'GET').every(row => ['/runtime/identity/projects', '/runtime/identity/activity', '/runtime/codeoss'].includes(row.path)), 'home must not dispatch guest saves/terminal/model actions');
  assert.deepEqual(errors, []); passed = true;
} finally {
  await browser.close();
  if (process.env.YNX_QA_HOME_RECEIPT) await writeFile(process.env.YNX_QA_HOME_RECEIPT, JSON.stringify({ passed, checks, errors, requests, actualReactEntry: true, actualChromium: true, backend: 'controlled HTTP routes', nativeEditorAccepted: false, public: false }, null, 2));
}
console.log(JSON.stringify({ checks, errors }));
