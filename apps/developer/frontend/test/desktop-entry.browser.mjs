import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const buildURL = process.env.YNX_QA_BUILD_URL;
if (!buildURL) throw Error('YNX_QA_BUILD_URL must name the exact local production build preview');
const origin = 'https://developer.ynxweb4.com', browser = await chromium.launch({ headless: true });
const checks = [], errors = [], calls = []; let passed = false, context, failure;
const project = { id: 'legacy-desktop-project', name: 'Existing desktop project', revision: 4, remoteRevision: 1, files: { 'main.js': 'console.log("preserved")' }, folders: [], open: ['main.js'], active: 'main.js' };
async function readyHost(page) {
  const deadline = Date.now() + 30000;
  let state;
  do {
    state = await page.evaluate(() => window.__ynxDesktopHost?.({ command: 'state' }));
    if (state?.state?.workspaceReady && state.state.editorReady) return state;
    await page.waitForTimeout(50);
  } while (Date.now() < deadline);
  throw Error(`Desktop host did not become ready: ${JSON.stringify(state)}`);
}
try {
  context = await browser.newContext();
  await context.routeWebSocket('**', ws => ws.close());
  let saved = { ...project }, writes = 0;
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (![origin, new URL(buildURL).origin].includes(url.origin)) return route.abort();
    if (url.pathname.startsWith('/runtime/')) {
      const path = url.pathname; calls.push({ method: req.method(), path }); let body, status = 200;
      if (path === '/runtime/codeoss') { body = { error: 'Controlled signed-out catalog' }; status = 401; }
      else if (path === '/runtime/health') body = { sandboxReady: true };
      else if (path.startsWith('/runtime/workspaces/')) {
        if (req.method() === 'PUT') { writes++; saved = { ...req.postDataJSON().workspace, revision: saved.revision + 1 }; }
        body = { workspace: saved };
      } else if (path === '/runtime/chain/status') body = { status: { chainId: 6423, catchingUp: false, height: 42 } };
      else body = { extensions: [], sessions: [], activities: [], terminals: [] };
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    }
    // Serve reviewed build bytes at the exact document origin. No HTTP request
    // or WebSocket is forwarded to the real product/Wallet/model/host runtime.
    const response = await context.request.get(new URL(url.pathname + url.search, buildURL).href);
    return route.fulfill({ response });
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  const assets = []; page.on('request', request => assets.push(request.url()));
  await page.addInitScript(value => { if (!localStorage.getItem('ynx-code-project-v1')) localStorage.setItem('ynx-code-project-v1', JSON.stringify(value)); }, project);
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
  const rejected = await page.evaluate(async () => ({ save: await window.__ynxDesktopHost({ command: 'save' }), extra: await window.__ynxDesktopHost({ command: 'state', path: 'ignored.js' }) }));
  assert.equal(rejected.save.status, 'blocked'); assert.equal(rejected.extra.status, 'blocked'); assert.equal(writes, 0);
  assert.equal(await page.locator('.monaco-editor').count(), 0);
  assert.equal(assets.some(url => /GuestWorkspace-[^/]+\.js(?:\?|$)/.test(url)), false);
  checks.push('before handshake: file commands and state with unknown fields reject without guest initialization/writes');
  await page.evaluate(() => { const frame = document.createElement('iframe'); frame.id = 'entry-boundary-frame'; frame.src = '/?entry-frame=1'; document.body.appendChild(frame); });
  await page.locator('#entry-boundary-frame').waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('#entry-boundary-frame')?.contentWindow?.__ynxDesktopHost));
  const framed = await page.evaluate(() => document.querySelector('#entry-boundary-frame').contentWindow.__ynxDesktopHost({ command: 'state' }));
  assert.equal(framed.status, 'blocked'); assert.equal(framed.reason, 'untrusted-document'); assert.equal(writes, 0);
  await page.evaluate(() => document.querySelector('#entry-boundary-frame').remove());
  checks.push('even same-origin child-frame state queries cannot activate the desktop route');
  const first = await page.evaluate(() => window.__ynxDesktopHost({ command: 'state' }));
  assert.equal(first.schema, 'ynx-desktop-host/v1'); assert.equal(first.status, 'not-ready');
  const state = await readyHost(page);
  assert.equal(state.status, 'handled'); assert.equal(state.state.projectId, project.id); assert.equal(state.state.revision, project.revision);
  assert.equal(assets.some(url => /GuestWorkspace-[^/]+\.js(?:\?|$)/.test(url)), true);
  assert.equal(writes, 0); assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ynx-code-project-v1')).files['main.js']), project.files['main.js']);
  checks.push('old unmarked installed-client state poll selects retained Workbench, real Monaco ready and restored project identity; no automatic overwrite');
  const created = await page.evaluate(() => window.__ynxDesktopHost({ command: 'new-file', path: 'reviewed.js' }));
  assert.equal(created.status, 'handled');
  const save = await page.evaluate(() => window.__ynxDesktopHost({ command: 'save' }));
  assert.equal(save.status, 'handled'); assert.equal(save.localSaved, true); assert.equal(save.remoteSaved, false);
  assert.ok(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('ynx-code-project-v1')).files, 'reviewed.js'))); assert.equal(writes, 0);
  checks.push('existing host v1 new-file/local-save remains functional; unknown disconnected terminal still blocks server overwrite, no fabricated stop');
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
  await page.evaluate(() => window.__ynxDesktopHost({ command: 'state' }));
  await readyHost(page);
  assert.ok(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('ynx-code-project-v1')).files, 'reviewed.js')));
  checks.push('same-profile reload plus legacy state handshake preserves the explicitly saved new file');
  await page.goto(origin + '/projects');
  await page.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
  const projectsEntry = await page.evaluate(() => window.__ynxDesktopHost({ command: 'state' }));
  assert.equal(projectsEntry.status, 'blocked'); assert.equal(projectsEntry.reason, 'untrusted-document');
  assert.equal(await page.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).getAttribute('href'), '/sso/start');
  assert.ok(await page.evaluate(() => Object.hasOwn(JSON.parse(localStorage.getItem('ynx-code-project-v1')).files, 'reviewed.js')));
  await page.getByRole('link', { name: 'Guest text workspace', exact: true }).click();
  await page.waitForURL(origin + '/guest-workspace');
  await readyHost(page);
  assert.equal((await page.evaluate(() => window.__ynxDesktopHost({ command: 'state' }))).state.projectId, project.id);
  checks.push('explicit /projects route stays on Wallet home despite desktop state polling; guest entry reopens the preserved project with its host contract');
  await page.close();
  const damaged = await context.newPage(); damaged.on('pageerror', e => errors.push(e.message));
  await damaged.addInitScript(() => localStorage.setItem('ynx-code-project-v1', '{original damaged desktop draft'));
  await damaged.goto(origin); await damaged.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
  const before = writes; await damaged.evaluate(() => window.__ynxDesktopHost({ command: 'state' }));
  await damaged.getByRole('heading', { name: 'Your saved workspace needs recovery', exact: true }).waitFor();
  assert.equal(await damaged.evaluate(() => localStorage.getItem('ynx-code-project-v1')), '{original damaged desktop draft'); assert.equal(writes, before);
  checks.push('legacy handshake cannot bypass damaged-profile recovery or overwrite original bytes');
  await damaged.close();
  const untrusted = await context.newPage(); untrusted.on('pageerror', e => errors.push(e.message));
  await untrusted.goto(buildURL); await untrusted.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
  assert.equal((await untrusted.evaluate(() => window.__ynxDesktopHost({ command: 'state' }))).status, 'blocked');
  await untrusted.getByRole('heading', { name: 'Your development workspace', exact: true }).waitFor();
  checks.push('wrong document origin cannot activate desktop entry through a state query');
  await untrusted.close();
  const local = await context.newPage(); local.on('pageerror', e => errors.push(e.message));
  await local.addInitScript(value => { localStorage.setItem('ynx-code-project-v1', JSON.stringify(value)); window.ynxDesktopWorkspace = { initialProject: value, saveProject: async () => {}, exportProject: async () => {} }; }, project);
  const catalogReads = calls.filter(call => call.path === '/runtime/codeoss').length;
  await local.goto(buildURL); await local.getByRole('button', { name: 'YNX Native IDE', exact: true }).click();
  const hostedLink = local.getByRole('link', { name: 'Open Wallet projects ↗', exact: true }); await hostedLink.waitFor();
  assert.equal(await hostedLink.getAttribute('href'), origin + '/projects');
  assert.equal(calls.filter(call => call.path === '/runtime/codeoss').length, catalogReads);
  assert.equal(await local.getByRole('link', { name: 'Sign in with YNX Wallet', exact: true }).count(), 0);
  assert.equal(await local.evaluate(() => JSON.parse(localStorage.getItem('ynx-code-project-v1')).files['main.js']), project.files['main.js']);
  checks.push('local desktop marker fixture directs native project entry to hosted projects without loopback canonical requests, synthetic sign-in or guest data adoption');
  await local.close();
  await untrusted.close();
  assert.deepEqual(errors, []); passed = true;
} catch (error) { failure = error.message; throw error; } finally {
  await context?.unrouteAll({ behavior: 'ignoreErrors' });
  await browser.close();
  if (process.env.YNX_QA_DESKTOP_ENTRY_RECEIPT) await writeFile(process.env.YNX_QA_DESKTOP_ENTRY_RECEIPT, JSON.stringify({ passed, failure, checks, errors, calls, actualReact: true, actualProductionBuild: true, actualMonaco: true, backend: 'controlled local routes', installedWindows: false, fullNativeWorkbench: false, realTerminal: false, public: false }, null, 2));
}
console.log(JSON.stringify({ checks, errors }));
