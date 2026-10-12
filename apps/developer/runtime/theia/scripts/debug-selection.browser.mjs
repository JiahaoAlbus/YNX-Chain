import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, runtime.qa + '/project');
const runner = await readFile(fileURLToPath(import.meta.url));
await writeFile(runtime.qa + '/debug-selection-runner.mjs', runner, { flag: 'wx', mode: 0o600 });
const launchPath = runtime.workspace + '/.vscode/launch.json', previous = await readFile(launchPath, 'utf8');
await writeFile(runtime.qa + '/debug-selection-previous-launch.json', previous, { flag: 'wx', mode: 0o600 });
const launch = JSON.parse(previous);
assert.equal(launch.configurations.length, 1);
const source = 'const marker = "YNX selected configuration";\nconsole.log(marker);\nrequire("node:fs").writeFileSync("selection-proof.txt", marker);\n';
await writeFile(runtime.workspace + '/selection-debug.js', source, { flag: 'wx', mode: 0o600 });
launch.configurations.push({ ...launch.configurations[0], name: 'YNX Selected reference', program: '${workspaceFolder}/selection-debug.js' });
const launchBytes = JSON.stringify(launch, null, 2);
await writeFile(launchPath, launchBytes);
const browser = await chromium.launch({ headless: true }), page = await browser.newPage(), checks = [], errors = [];
await page.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(30000);
async function picker(label = 'Debug: Select and Start Debugging') {
  await page.keyboard.press('F1');
  await page.locator('.quick-input-box input').fill('>' + label);
  await page.locator('.quick-input-list').getByText(label, { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.quick-input-box input')?.value === 'debug ');
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
  if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('selection-debug.js');
  await page.locator('.quick-input-list').getByText('selection-debug.js', { exact: true }).first().click();
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.waitFor();
  await lines.locator('.view-line').nth(1).click(); await page.keyboard.press('F9');
  await picker(process.argv[3] === '--with-api-fixture' ? 'YNX QA: Select Through VS Code API' : undefined);
  await page.locator('.quick-input-list').getByText('YNX JavaScript reference', { exact: true }).waitFor();
  await page.locator('.quick-input-list').getByText('YNX Selected reference', { exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.locator('.quick-input-box').waitFor({ state: 'hidden' });
  await assert.rejects(readFile(runtime.workspace + '/selection-proof.txt'), { code: 'ENOENT' });
  await assert.rejects(readFile(runtime.workspace + '/debug-proof.txt'), { code: 'ENOENT' });
  assert.equal(await readFile(launchPath, 'utf8'), launchBytes);
  checks.push('Command palette lists both actual launch configurations; cancelling preserves launch.json and starts neither target.');
  if (process.argv[3] === '--with-api-fixture') checks.push('Actual isolated VS Code extension invokes workbench.action.debug.selectandstart through vscode.commands.executeCommand and opens the standard configuration picker.');
  await lines.click(); await picker();
  await page.locator('.quick-input-list').getByText('YNX Selected reference', { exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.theia-debug-thread .status')].some(n => /paused|stopped/i.test(n.textContent || '')));
  await page.locator('.theia-debug-console-variable').filter({ has: page.locator('.name', { hasText: /^marker:/ }) }).first().locator('.value').filter({ hasText: 'YNX selected configuration' }).waitFor();
  await assert.rejects(readFile(runtime.workspace + '/selection-proof.txt'), { code: 'ENOENT' });
  checks.push('Selecting the second configuration starts its real JavaScript DAP session and pauses at its own breakpoint with the actual variable value.');
  await page.keyboard.press('F5');
  for (let i = 0; i < 200; i++) { try { if (await readFile(runtime.workspace + '/selection-proof.txt', 'utf8') === 'YNX selected configuration') break; } catch {} await page.waitForTimeout(50); }
  assert.equal(await readFile(runtime.workspace + '/selection-proof.txt', 'utf8'), 'YNX selected configuration');
  await assert.rejects(readFile(runtime.workspace + '/debug-proof.txt'), { code: 'ENOENT' });
  assert.equal(await readFile(launchPath, 'utf8'), launchBytes);
  checks.push('Continue completes the selected target and writes its exact disk output; the other configuration never runs and launch.json remains unchanged.');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: runtime.qa + '/debug-selection.png' });
} catch (e) { checks.push({ failure: String(e), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally {
  const result = { runtime, runnerSha256: createHash('sha256').update(runner).digest('hex'), checks, errors, scope: 'Actual isolated editor command selection and JS debugger; not native LLDB, canonical admission or real Wallet/Chain/AI acceptance.' };
  await writeFile(runtime.qa + '/debug-selection-browser.json', JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  await browser.close(); console.log(JSON.stringify(result));
}
