import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const receiptPath = process.argv[2], prefix = process.argv[3] || 'crash-cold';
const withCpp = process.argv[4] === '--with-cpp';
if (process.argv[4] && !withCpp) throw Error('Unknown cold recovery option.');
assert.match(prefix, /^[a-z-]+$/);
const runtime = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(receiptPath, `${runtime.qa}/runtime.json`);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const processState = execFileSync('/bin/ps', ['-p', String(runtime.pid), '-o', 'pgid=,command='], { encoding: 'utf8' }).trim();
assert.ok(processState.startsWith(String(runtime.pid) + ' '));
assert.ok(processState.includes(`${runtime.root}/lib/backend/main.js ${runtime.workspace} --hostname 127.0.0.1 --port ${runtime.port}`));
const bytes = await readFile(fileURLToPath(import.meta.url));
await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const original = await readFile(`${runtime.workspace}/main.js`, 'utf8');
await writeFile(`${runtime.qa}/${prefix}-saved-main.js`, original, { flag: 'wx', mode: 0o600 });
const preferences = await readFile(`${runtime.profile}/settings.json`, 'utf8');
const marker = '// YNX_CRASH_UNSAVED_DRAFT_20261004';
const draft = original + '\n' + marker + '\n';
const phases = [], errors = [];
let ownedChildren = [];
let observedClangd = [];
function processRows() {
  return execFileSync('/bin/ps', ['-ax', '-o', 'pid=,ppid=,pgid=,lstart='], { encoding: 'utf8' }).split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), started: match[4] }] : [];
  });
}
let context, page, resumed, next;
async function browser() {
  context = await chromium.launchPersistentContext(`${runtime.qa}/${prefix}-browser-profile`, { headless: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
  page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
}
async function command(name) {
  await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill(`>${name}`);
  await page.locator('.quick-input-list').getByText(name, { exact: true }).first().click();
}
async function openMain() {
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('main.js');
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
}
try {
  await browser();
  await command('Extensions: Show Built-in Extensions');
  await page.getByText(/^(YNX Tools|ynx\.ynx-tools)$/).filter({ visible: true }).first().dblclick();
  if (!(await readFile(`${runtime.profile}/backend-settings.json`, 'utf8')).includes('ynx.ynx-tools')) {
    await page.locator('.codicon-settings-gear').filter({ visible: true }).last().click(); await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
    await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Reload Window', exact: true }).last().click()]);
    await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  } else await page.getByText('Disabled', { exact: true }).filter({ visible: true }).first().waitFor();
  const disabled = await readFile(`${runtime.profile}/backend-settings.json`, 'utf8');
  assert.match(disabled, /ynx\.ynx-tools/);
  if (withCpp) {
    await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('wallet-main.cpp');
    await page.locator('.quick-input-list').getByText('wallet-main.cpp', { exact: true }).first().click();
    await page.locator('#theia-statusBar').filter({ hasText: 'C++' }).waitFor();
    for (let attempt = 0; attempt < 200 && !observedClangd.length; attempt++) {
      const rows = processRows(), family = new Set([runtime.pid]);
      for (let depth = 0; depth < 128; depth++) { const added = rows.filter(row => family.has(row.parent) && !family.has(row.pid)); if (!added.length) break; added.forEach(row => family.add(row.pid)); }
      for (const row of rows.filter(row => row.pid !== runtime.pid && family.has(row.pid))) {
        let command; try { command = execFileSync('/bin/ps', ['-p', String(row.pid), '-o', 'command='], { encoding: 'utf8' }).trim(); } catch { continue; }
        if (command.startsWith('/Library/Developer/CommandLineTools/usr/bin/clangd --background-index=false')) observedClangd.push({ ...row, command });
      }
      if (!observedClangd.length) await page.waitForTimeout(100);
    }
    assert.ok(observedClangd.length, 'A real owned Clangd must be live before the crash.');
  }
  await command('Terminal: Create New Terminal (In Active Workspace)');
  const terminal = page.locator('.xterm-helper-textarea').last(); await terminal.waitFor({ state: 'attached' }); await terminal.focus();
  await terminal.pressSequentially('node -e "require(\'node:fs\').writeFileSync(\'crash-before-pty.txt\',\'YNX before crash\')"'); await terminal.press('Enter');
  for (let attempt = 0; attempt < 100; attempt++) { try { if (await readFile(`${runtime.workspace}/crash-before-pty.txt`, 'utf8') === 'YNX before crash') break; } catch {} await page.waitForTimeout(50); }
  assert.equal(await readFile(`${runtime.workspace}/crash-before-pty.txt`, 'utf8'), 'YNX before crash');
  await openMain(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(draft);
  await page.locator('.lm-TabBar-tab.theia-mod-dirty').filter({ hasText: 'main.js' }).waitFor();
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), original);
  await page.waitForTimeout(1500); // allow a normal bounded draft checkpoint
  await page.screenshot({ path: `${runtime.qa}/${prefix}-before.png` });
  const beforeProcesses = processRows(), family = new Set([runtime.pid]);
  for (let depth = 0; depth < 128; depth++) {
    const added = beforeProcesses.filter(row => family.has(row.parent) && !family.has(row.pid));
    if (!added.length) break;
    for (const row of added) family.add(row.pid);
  }
  ownedChildren = beforeProcesses.filter(row => row.pid !== runtime.pid && family.has(row.pid));
  process.kill(-runtime.pid, 'SIGKILL');
  for (let attempt = 0; attempt < 100; attempt++) { try { process.kill(runtime.pid, 0); } catch (error) { if (error.code === 'ESRCH') break; throw error; } await new Promise(ok => setTimeout(ok, 50)); }
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' });
  let remaining = [];
  for (let attempt = 0; attempt < 100; attempt++) {
    const rows = processRows();
    remaining = ownedChildren.filter(child => rows.some(row => row.pid === child.pid && row.started === child.started));
    if (!remaining.length) break;
    await new Promise(ok => setTimeout(ok, 50));
  }
  phases.push({ check: 'Previously observed owned backend descendants exit after the crash, including detached children; no live killed-session execution is reported.', passed: remaining.length === 0, observedChildren: ownedChildren, remaining });
  if (withCpp) {
    const rows = processRows();
    phases.push({ check: 'The actual Clangd observed under this live editor exits after hard backend termination.', passed: observedClangd.every(child => !rows.some(row => row.pid === child.pid && row.started === child.started)), observedClangd });
  }
  await context.close(); context = undefined;
  resumed = spawn(process.execPath, [fileURLToPath(new URL('./start-isolated-qa.mjs', import.meta.url)), runtime.plugins, runtime.dapRoot || '', runtime.root, receiptPath], { stdio: ['ignore', 'pipe', 'pipe'] });
  resumed.stdout.pipe(process.stdout); resumed.stderr.pipe(process.stderr);
  for (let attempt = 0; attempt < 600; attempt++) {
    if (resumed.exitCode !== null) throw Error(`Resume exited ${resumed.exitCode}`);
    next = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (next.pid !== runtime.pid) { try { if ((await fetch(runtime.url)).ok) break; } catch {} }
    await new Promise(ok => setTimeout(ok, 100));
  }
  assert.notEqual(next.pid, runtime.pid);
  await browser(); await openMain();
  const editorText = await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().innerText();
  phases.push({ check: 'Unsaved editor draft is restored dirty after SIGKILL and a cold browser/workbench reopen.', passed: editorText.replaceAll('\u00a0', ' ').includes(marker) && await page.locator('.lm-TabBar-tab.theia-mod-dirty').filter({ hasText: 'main.js' }).count() > 0, editorText });
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), original);
  assert.equal(await readFile(`${runtime.profile}/settings.json`, 'utf8'), preferences);
  assert.equal(await readFile(`${runtime.profile}/backend-settings.json`, 'utf8'), disabled);
  phases.push({ check: 'Original saved file, user/language preferences and disabled extension state survive hard backend termination.', passed: true });
  if (withCpp) {
    const savedCpp = await readFile(`${runtime.workspace}/wallet-main.cpp`, 'utf8');
    await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('wallet-main.cpp');
    await page.locator('.quick-input-list').getByText('wallet-main.cpp', { exact: true }).first().click();
    await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click(); await page.keyboard.press('Meta+a');
    await page.keyboard.insertText('#include "wallet.hpp"\nint main() { WalletBalance wallet; wallet.');
    let suggestions = '', deadline = Date.now() + 30000;
    while (Date.now() < deadline) { await page.keyboard.press('Escape'); await page.keyboard.press('Control+Space'); await page.waitForTimeout(350); const widget = page.locator('.suggest-widget.visible'); suggestions = await widget.count() ? await widget.innerText() : ''; if (suggestions.includes('confirmedBalance') && suggestions.includes('pendingBalance')) break; }
    assert.match(suggestions, /confirmedBalance/); assert.match(suggestions, /pendingBalance/);
    await page.keyboard.press('Escape'); await page.keyboard.press('Meta+w');
    await page.getByRole('button', { name: /Don.t Save/, exact: true }).click();
    await page.getByRole('button', { name: /Don.t Save/, exact: true }).waitFor({ state: 'hidden' });
    await page.locator('.monaco-editor .view-lines').filter({ visible: true }).last().click();
    assert.equal(await readFile(`${runtime.workspace}/wallet-main.cpp`, 'utf8'), savedCpp);
    phases.push({ check: 'Clangd semantic cross-header completion works after cold reopen in the same project/profile; temporary probe text is explicitly discarded without replacing saved C++ source.', passed: true });
  }
  await command('Terminal: Create New Terminal (In Active Workspace)');
  const afterTerminal = page.locator('.xterm-helper-textarea').last(); await afterTerminal.waitFor({ state: 'attached' }); await afterTerminal.focus();
  await afterTerminal.pressSequentially('node -e "require(\'node:fs\').writeFileSync(\'crash-after-pty.txt\',\'YNX after crash\')"'); await afterTerminal.press('Enter');
  for (let attempt = 0; attempt < 100; attempt++) { try { if (await readFile(`${runtime.workspace}/crash-after-pty.txt`, 'utf8') === 'YNX after crash') break; } catch {} await page.waitForTimeout(50); }
  assert.equal(await readFile(`${runtime.workspace}/crash-after-pty.txt`, 'utf8'), 'YNX after crash');
  phases.push({ check: 'A new actual PTY executes Node after cold recovery; a killed terminal process is not represented as still running.', passed: true });
  await page.screenshot({ path: `${runtime.qa}/${prefix}-after.png` });
} catch (error) { phases.push({ failure: String(error), text: page && !page.isClosed() ? await page.locator('body').innerText() : '' }); }
finally {
  if (phases.some(phase => phase.failure || phase.passed === false) || errors.length) process.exitCode = 1;
  const receipt = { runtime, resumedRuntime: next, runnerSha256: createHash('sha256').update(bytes).digest('hex'), originalFileSha256: createHash('sha256').update(original).digest('hex'), draft, phases, errors, scope: 'Controlled owned synthetic macOS SIGKILL/cold persistent-browser profile. Process observations compare only the pre-crash owned family PIDs and start timestamps. No reseeding. Not formal native App, canonical user identity, signing, multi-owner capacity or survival of a killed terminal process.' };
  await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(receipt, null, 2));
  if (context) await context.close(); if (resumed) resumed.kill('SIGTERM');
  console.log(JSON.stringify(receipt));
}
