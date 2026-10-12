import assert from 'node:assert/strict';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8')), prefix = process.argv[3] || 'cpp-debug';
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/); assert.match(prefix, /^[a-z-]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
for (const name of ['cpp-debug-binary', 'cpp-debug-proof.txt']) {
  try { await lstat(`${runtime.workspace}/${name}`); throw Error('Existing debug output must be preserved; use a fresh own fixture.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
const source = '#include <fstream>\nint main() {\n  int marker = 41;\n  marker += 1;\n  std::ofstream("cpp-debug-proof.txt") << marker;\n  return 0;\n}\n';
await writeFile(`${runtime.workspace}/cpp-debug.cpp`, source, { flag: 'wx', mode: 0o600 });
const launchPath = `${runtime.workspace}/.vscode/launch.json`, previous = await readFile(launchPath, 'utf8');
await writeFile(`${runtime.qa}/${prefix}-previous-launch.json`, previous, { flag: 'wx', mode: 0o600 });
const launch = JSON.parse(previous); assert.equal(launch.version, '0.2.0'); assert.ok(Array.isArray(launch.configurations));
launch.configurations.push({ type: 'lldb-dap', request: 'launch', name: 'YNX C++ reference', program: '${workspaceFolder}/cpp-debug-binary', cwd: '${workspaceFolder}', preLaunchTask: 'YNX QA Build Debug C++', stopOnEntry: false });
await writeFile(launchPath, JSON.stringify(launch, null, 2));
await writeFile(`${runtime.workspace}/.vscode/settings.json`, JSON.stringify({ 'lldb-dap.executable-path': '/Library/Developer/CommandLineTools/usr/bin/lldb-dap', 'lldb-dap.serverMode': false, 'lldb-dap.captureSessionLogs': true, 'lldb-dap.logFolder': `${runtime.qa}/tmp/lldb-logs` }, null, 2), { flag: 'wx', mode: 0o600 });
await writeFile(`${runtime.workspace}/.vscode/tasks.json`, JSON.stringify({ version: '2.0.0', tasks: [{ label: 'YNX QA Build Debug C++', type: 'process', command: '/Library/Developer/CommandLineTools/usr/bin/clang++', args: ['-g', '-O0', '-fmessage-length=0', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '${workspaceFolder}/cpp-debug.cpp', '-o', '${workspaceFolder}/cpp-debug-binary'], options: { cwd: '${workspaceFolder}' }, problemMatcher: ['$gcc'], group: { kind: 'build', isDefault: true } }] }, null, 2), { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), checks = [], errors = [];
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true }); if (await trust.count()) { assert.ok((await page.locator('body').innerText()).includes(runtime.workspace)); await trust.click(); }
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('cpp-debug.cpp'); await page.locator('.quick-input-list').getByText('cpp-debug.cpp', { exact: true }).first().click();
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.waitFor();
  await lines.locator('.view-line').nth(3).click(); await page.keyboard.press('F9');
  // Select the actual standard launch configuration in the Debug UI.
  await page.keyboard.press('Meta+Shift+d');
  await page.locator('.theia-select-component').filter({ hasText: 'YNX JavaScript reference' }).first().click();
  await page.locator('.theia-select-component-option-value').getByText('YNX C++ reference', { exact: true }).click();
  await lines.click(); await page.keyboard.press('F5');
  for (let i = 0; i < 200; i++) { try { if ((await readFile(`${runtime.workspace}/cpp-debug-binary`)).length) break; } catch {} await page.waitForTimeout(50); }
  assert.ok((await readFile(`${runtime.workspace}/cpp-debug-binary`)).length);
  checks.push('Standard launch.json preLaunchTask invokes the real LLVM compiler with debug symbols; no stale binary or scripted build substitute.');
  await page.waitForFunction(() => [...document.querySelectorAll('.theia-debug-thread .status')].some(n => /paused|stopped/i.test(n.textContent || '')));
  const marker = page.locator('.theia-debug-console-variable').filter({ has: page.locator('.name', { hasText: /^marker:/ }) }).first();
  await marker.locator('.value').filter({ hasText: /^41$/ }).waitFor();
  await assert.rejects(readFile(`${runtime.workspace}/cpp-debug-proof.txt`), { code: 'ENOENT' });
  checks.push('Unmodified LLVM LLDB extension pauses the real native C++ executable at the source breakpoint and exposes marker=41 before the write.');
  await page.screenshot({ path: `${runtime.qa}/${prefix}-breakpoint.png` });
  await page.keyboard.press('F10'); await marker.locator('.value').filter({ hasText: /^42$/ }).waitFor();
  await assert.rejects(readFile(`${runtime.workspace}/cpp-debug-proof.txt`), { code: 'ENOENT' });
  checks.push('Normal Step Over advances the native program and changes its real variable to 42 without executing the following file write.');
  await page.keyboard.press('F5');
  for (let i = 0; i < 200; i++) { try { if (await readFile(`${runtime.workspace}/cpp-debug-proof.txt`, 'utf8') === '42') break; } catch {} await page.waitForTimeout(50); }
  assert.equal(await readFile(`${runtime.workspace}/cpp-debug-proof.txt`, 'utf8'), '42');
  checks.push('Normal Continue executes the native target to completion and produces its exact own disk output.');
  assert.deepEqual(errors, []); await page.screenshot({ path: `${runtime.qa}/${prefix}.png` });
} catch (e) { checks.push({ failure: String(e), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally { const result = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), sourceSha256: createHash('sha256').update(source).digest('hex'), launch, checks, errors, scope: 'Actual isolated editor, unchanged cached LLVM debugger extension and installed LLDB/Clang compiler. Own native target only; no wider network/read policy, real canonical user or other-platform acceptance.' }; await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(result, null, 2)); await browser.close(); console.log(JSON.stringify(result)); }
