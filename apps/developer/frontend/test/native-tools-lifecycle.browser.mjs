import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const target = process.env.YNX_QA_TOOLS_URL, output = process.env.YNX_QA_TOOLS_LIFECYCLE_RECEIPT;
if (!target || !output) throw Error('An owned fixture URL and new receipt path are required.');
const origin = new URL(target).origin;
assert.equal(new URL(target).hostname, '127.0.0.1');
const browser = await chromium.launch({ headless: true }), checks = [], errors = [], calls = [];
let release;
try {
  for (const mode of ['foreground-change', 'session-expiry', 'review-expiry', 'foreground-offline']) {
    const context = await browser.newContext();
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message));
    let changed = false, heldRequest = false;
    const held = new Promise(resolve => { release = resolve; });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/runtime/native-tools/')) return route.continue();
      calls.push({ mode, path: url.pathname, checkOnly: url.searchParams.get('checkOnly'), body: route.request().postDataJSON() });
      if (changed && mode === 'foreground-offline') return route.abort('failed');
      let value;
      if (url.pathname.endsWith('/context')) value = { ...(url.searchParams.has('checkOnly') ? {} : { csrf: 'review' }), account: changed ? 'account-B' : 'account-A', projectId: changed ? 'project-B' : 'project-A', expiresAt: Date.now() + 300, sessionExpiresAt: Date.now() + (mode === 'session-expiry' ? 1500 : 60000) };
      else if (url.pathname.endsWith('/proposals')) value = { ...route.request().postDataJSON(), proposalId: 'reviewed', csrf: 'approval', contextBytes: 5, model: 'qwen3:4b', expiresAt: Date.now() + (mode === 'review-expiry' ? 500 : 60000) };
      else if (url.pathname.includes('/contracts/')) {
        if (mode === 'session-expiry') { heldRequest = true; await held; }
        value = { artifact: { address: '0x' + 'a'.repeat(40), artifactKind: 'OLD_PROJECT_ARTIFACT', runtimeMode: 'controlled', functions: [], limitations: [] } };
      } else if (url.pathname.endsWith('/approve')) throw Error('This lifecycle test must never send model context.');
      else value = {};
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) }).catch(() => {});
    });
    await page.goto(target);
    await page.getByLabel('Request', { exact: true }).fill('Keep my unsent request');
    await page.getByLabel('Selected context', { exact: true }).fill('Keep my unsent selected text');
    if (mode === 'review-expiry') {
      await page.getByRole('button', { name: 'Preview request', exact: true }).click();
      await page.getByRole('heading', { name: 'Approve this request' }).waitFor();
      await page.getByRole('alert').filter({ hasText: 'This request review expired' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Send reviewed context once' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Preview request' }).isEnabled(), true);
      await page.getByRole('link', { name: 'Return to editor' }).waitFor();
      checks.push('Expired review is removed without ending the longer-lived workspace session or sending AI context.');
    } else if (mode === 'session-expiry') {
      await page.getByLabel('Contract address', { exact: true }).fill('0x' + 'a'.repeat(40));
      await page.getByRole('button', { name: 'Inspect contract', exact: true }).click();
      for (let i = 0; i < 100 && !heldRequest; i++) await page.waitForTimeout(10);
      assert.equal(heldRequest, true);
      await page.getByRole('alert').filter({ hasText: 'The Wallet project session ended' }).waitFor();
      release(); await page.waitForTimeout(100);
      assert.equal(await page.getByText('OLD_PROJECT_ARTIFACT', { exact: false }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Inspect contract' }).count(), 0);
      checks.push('Actual session deadline retires the tool tree and late contract response without resurrecting private results.');
    } else {
      if (mode === 'foreground-change') {
        await page.getByLabel('Contract address', { exact: true }).fill('0x' + 'a'.repeat(40));
        await page.getByRole('button', { name: 'Inspect contract' }).click();
        await page.getByText('Artifact: OLD_PROJECT_ARTIFACT', { exact: false }).waitFor();
      }
      changed = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('button', { name: 'Refresh workspace connection' }).waitFor();
      assert.equal(await page.getByText('Artifact: OLD_PROJECT_ARTIFACT', { exact: false }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Preview request' }).count(), 0);
      assert.equal(await page.getByText('account-B · project-B', { exact: true }).count(), 0);
      changed = false; await page.getByRole('button', { name: 'Refresh workspace connection' }).click();
      assert.equal(await page.getByLabel('Request', { exact: true }).inputValue(), 'Keep my unsent request');
      assert.equal(await page.getByLabel('Selected context', { exact: true }).inputValue(), 'Keep my unsent selected text');
      checks.push(mode === 'foreground-change' ? 'Foreground account/project mismatch retires old contract/results and preserves only unsent user input for explicit refreshed review.' : 'Failed foreground verification closes tools; explicit refresh recovers the unchanged unsent draft without model dispatch.');
    }
    release(); await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  release?.(); await browser.close();
  await writeFile(output, JSON.stringify({ checks, errors, calls, runnerSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'), actualReact: true, actualChromium: true, backend: 'controlled browser routes', realWallet: false, realModel: false, public: false }, null, 2), { flag: 'wx' });
}
console.log(JSON.stringify({ checks: checks.length, errors }));
