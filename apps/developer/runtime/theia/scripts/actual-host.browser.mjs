import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, realpath, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const receiptPath = process.argv[2];
const runtime = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.match(runtime.qa, /\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const runnerBytes = await readFile(fileURLToPath(import.meta.url));
const runnerSha256 = createHash('sha256').update(runnerBytes).digest('hex');
await writeFile(`${runtime.qa}/actual-host-runner.mjs`, runnerBytes, { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true });
const checks = [], errors = [];
let page;
try {
  const context = await browser.newContext();
  await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(runtime.url);
  await page.locator('#theia-app-shell').waitFor();
  await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
  if (await trust.count()) {
    assert.match(await page.locator('body').innerText(), new RegExp(runtime.workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await trust.click();
  }
  console.log('real framework ready');
  await page.keyboard.press('Meta+p');
  const input = page.locator('input[placeholder^="Search files by name"]');
  await input.fill('main.js');
  await page.locator('.quick-input-list .monaco-list-row.focused').getByText('main.js', { exact: true }).first().waitFor();
  await input.press('Enter');
  await page.locator('.monaco-editor .view-lines').first().waitFor();
  console.log('real disk file opened');
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('import { wallet } from "./wallet-model.js";\nwallet.');
  // First-file language activation is asynchronous. An existing word list does
  // not refresh when the semantic provider arrives; re-request via the keyboard.
  let suggestions = '';
  const semanticDeadline = Date.now() + 30000;
  while (Date.now() < semanticDeadline) {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Space');
    await page.waitForTimeout(500);
    const widget = page.locator('.suggest-widget.visible');
    suggestions = await widget.count() ? await widget.innerText() : '';
    if (suggestions.includes('address') && suggestions.includes('balance')) break;
  }
  assert.match(suggestions, /address/);
  assert.match(suggestions, /balance/);
  checks.push('actual TypeScript VS Code extension resolves wallet properties from an unopened imported file, beyond words present in the active editor');
  await page.keyboard.press('Escape');
  async function savedText(expected) {
    await page.keyboard.press('Meta+s');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await readFile(`${runtime.workspace}/main.js`, 'utf8') === expected) return;
      await page.waitForTimeout(25);
    }
    assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), expected);
  }
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type('('); await savedText('()');
  await page.keyboard.type('"'); await savedText('("")');
  await page.keyboard.press('Meta+a'); await page.keyboard.type('['); await savedText('[("")]');
  checks.push('real keyboard input pairs brackets and quotes and surrounds selected text, verified by saving each result to disk');
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('const savedMarker = "YNX actual extension host";\n');
  // Other open files may deliberately retain unsaved drafts. Verify this
  // project file on disk without requiring unrelated buffers to be saved.
  await savedText('const savedMarker = "YNX actual extension host";\n');
  // Disk readback, rather than a mocked model, is the save assertion.
  let saved;
  for (let attempt = 0; attempt < 100; attempt++) {
    saved = await readFile(`${runtime.workspace}/main.js`, 'utf8');
    if (saved.includes('YNX actual extension host')) break;
    await page.waitForTimeout(25);
  }
  assert.match(saved, /YNX actual extension host/);
  checks.push('actual editor save writes the selected project file, confirmed on disk');
  assert.equal(await page.locator('.ynx-workbench-brand img[alt="YNX"]').count(), 1);
  assert.ok(await page.locator('.ynx-workbench-brand img[alt="YNX"]').isVisible());
  const logoBounds = await page.locator('.ynx-workbench-brand img[alt="YNX"]').boundingBox();
  assert.ok(logoBounds && logoBounds.width >= 20 && logoBounds.height >= 20);
  assert.equal(await page.locator('.ynx-workbench-brand strong').innerText(), 'YNX Developer');
  checks.push('the inherited YNX logo and product name render in the actual framework workbench');
  let brandExtension;
  try { brandExtension = JSON.parse(await readFile(`${runtime.plugins}/ynx.ynx-developer-brand/package.json`, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (brandExtension) {
    await page.waitForFunction(() => {
      const status = document.getElementById('theia-statusBar');
      return status && getComputedStyle(status).backgroundColor === 'rgb(0, 47, 167)';
    });
    checks.push('the inherited YNX Klein Light theme loads through the actual extension mechanism and applies the original blue workbench color');
  }
  await page.keyboard.press('Meta+w');
  await page.locator('.monaco-editor').waitFor({ state: 'hidden' });
  await page.keyboard.press('Meta+p');
  await input.fill('main.js'); await page.locator('.quick-input-list .monaco-list-row.focused').getByText('main.js', { exact: true }).first().waitFor(); await input.press('Enter');
  await page.locator('.monaco-editor .view-lines').first().waitFor();
  assert.match(await page.locator('.monaco-editor .view-lines').first().innerText(), /YNX\sactual\sextension\shost/);
  checks.push('closing and reopening the actual file restores saved disk content');
  const mainLines = page.locator('.monaco-editor .view-lines').filter({ hasText: /YNX\sactual\sextension\shost/ });
  await mainLines.click(); await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('const preservedDraft = "YNX dirty close";\n');
  await page.locator('.lm-TabBar-tab.theia-mod-dirty').waitFor();
  await page.keyboard.press('Meta+w');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.monaco-editor .view-lines').filter({ hasText: /YNX\sdirty\sclose/ }).waitFor();
  assert.match(await readFile(`${runtime.workspace}/main.js`, 'utf8'), /YNX actual extension host/);
  await page.keyboard.press('Meta+w');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.monaco-editor').waitFor({ state: 'hidden' });
  assert.equal(await readFile(`${runtime.workspace}/main.js`, 'utf8'), 'const preservedDraft = "YNX dirty close";\n');
  await page.keyboard.press('Meta+p'); await input.fill('main.js');
  await page.locator('.quick-input-list .monaco-list-row.focused').getByText('main.js', { exact: true }).first().waitFor(); await input.press('Enter');
  const preservedLines = page.locator('.monaco-editor .view-lines').filter({ hasText: /YNX\sdirty\sclose/ });
  await preservedLines.waitFor(); await preservedLines.click(); await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('const savedMarker = "YNX actual extension host";\n'); await page.keyboard.press('Meta+s');
  checks.push('real dirty-close Cancel preserves the unsaved draft and saved disk file; Save closes and reopens the actual saved draft');
  await mkdir(`${runtime.workspace}/contracts`, { mode: 0o700 });
  const arbitraryPath = `${runtime.workspace}/contracts/合约.ynxnotes`;
  await writeFile(arbitraryPath, 'YNX arbitrary file\n', { mode: 0o600 });
  await page.keyboard.press('Meta+p'); await input.fill('合约.ynxnotes');
  await page.locator('.quick-input-list .monaco-list-row.focused').getByText('合约.ynxnotes', { exact: true }).first().waitFor(); await input.press('Enter');
  const arbitraryLines = page.locator('.monaco-editor .view-lines').filter({ hasText: /YNX\sarbitrary\sfile/ });
  await arbitraryLines.waitFor(); await arbitraryLines.click(); await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('用户自己的文件与后缀\n'); await page.keyboard.press('Meta+s');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await readFile(arbitraryPath, 'utf8') === '用户自己的文件与后缀\n') break;
    await page.waitForTimeout(25);
  }
  assert.equal(await readFile(arbitraryPath, 'utf8'), '用户自己的文件与后缀\n');
  checks.push('real Quick Open and editor preserve a nested Unicode filename, arbitrary text suffix and saved Unicode contents');
  const symbolsPath = `${runtime.workspace}/symbols.js`;
  await writeFile(symbolsPath, 'function balanceFor(wallet){return wallet.balance;}\nconst wallet={balance:42};\nconsole.log(balanceFor(wallet));\n', { mode: 0o600 });
  await page.keyboard.press('Meta+p'); await input.fill('symbols.js');
  await page.locator('.quick-input-list .monaco-list-row.focused').getByText('symbols.js', { exact: true }).first().waitFor(); await input.press('Enter');
  const symbolLines = page.locator('.monaco-editor .view-lines').filter({ hasText: 'balanceFor' });
  await symbolLines.waitFor(); await symbolLines.locator('.view-line').nth(2).click();
  await page.keyboard.press('Meta+ArrowLeft');
  for (let index = 0; index < 14; index++) await page.keyboard.press('ArrowRight');
  await page.locator('#theia-statusBar').filter({ hasText: /Ln 3, Col/ }).waitFor();
  await page.keyboard.press('F12');
  await page.locator('#theia-statusBar').filter({ hasText: /Ln 1, Col/ }).waitFor();
  await symbolLines.locator('.view-line').nth(0).click();
  await page.keyboard.press('Meta+ArrowLeft');
  for (let index = 0; index < 11; index++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('F2');
  const rename = page.locator('.rename-box input'); await rename.waitFor();
  await rename.fill('readBalance'); await rename.press('Enter'); await page.keyboard.press('Meta+s');
  let renamed;
  for (let attempt = 0; attempt < 100; attempt++) {
    renamed = await readFile(symbolsPath, 'utf8');
    if (renamed.includes('readBalance') && !renamed.includes('balanceFor')) break;
    await page.waitForTimeout(25);
  }
  assert.equal((renamed.match(/readBalance/g) || []).length, 2); assert.ok(!renamed.includes('balanceFor'));
  await page.keyboard.press('Shift+Alt+f');
  // Formatting comes back asynchronously from the language server. Save the
  // completed edit, rather than saving the previous buffer before it arrives.
  await page.locator('.monaco-editor .view-lines').filter({ hasText: /function\sreadBalance\(wallet\)\s\{/ }).waitFor();
  await page.keyboard.press('Meta+s');
  let formatted;
  for (let attempt = 0; attempt < 100; attempt++) {
    formatted = await readFile(symbolsPath, 'utf8');
    if (/function readBalance\(wallet\) \{/.test(formatted)) break;
    await page.waitForTimeout(25);
  }
  assert.match(formatted, /function readBalance\(wallet\) \{/);
  checks.push('actual JS language extension navigates from call to definition, renames the symbol and reference, formats and saves the real file');
  await page.locator('.monaco-editor .view-lines').filter({ hasText: 'readBalance' }).click();
  await page.keyboard.press('Meta+a'); await page.keyboard.insertText('const invalid = ;\n');
  await page.keyboard.press('Meta+s');
  await page.locator('.monaco-editor .squiggly-error').first().waitFor();
  checks.push('actual JavaScript language extension reports a syntax diagnostic in the real editor');
  await page.keyboard.press('Meta+p'); await input.fill('main.js');
  // Select the requested visible result, rather than accepting the previously
  // focused recent file while the asynchronous search results update.
  await page.locator('.quick-input-list').getByText('main.js', { exact: true }).first().click();
  await page.locator('.monaco-editor .view-lines').filter({ hasText: /YNX\sactual\sextension\shost/ }).waitFor();
  await page.keyboard.press('F1');
  const command = page.locator('.quick-input-box input');
  await command.fill('>Terminal: Create New Terminal (In Active Workspace)');
  await page.getByText('Terminal: Create New Terminal (In Active Workspace)', { exact: true }).first().waitFor();
  await command.press('Enter');
  const terminal = page.locator('.xterm-helper-textarea').last(); await terminal.waitFor({ state: 'attached' }); await terminal.focus();
  await terminal.pressSequentially('node -e "require(\'node:fs\').writeFileSync(\'terminal-proof.txt\',\'YNX real PTY\')"');
  await terminal.press('Enter');
  let marker;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { marker = await readFile(`${runtime.workspace}/terminal-proof.txt`, 'utf8'); } catch {}
    if (marker) break;
    await page.waitForTimeout(50);
  }
  assert.equal(marker, 'YNX real PTY');
  checks.push('actual integrated PTY executes installed Node in this project, confirmed by its disk output');
  let gitExtension;
  try { gitExtension = JSON.parse(await readFile(`${runtime.plugins}/vscode.git-1.95.3/package.json`, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (gitExtension) {
    await terminal.focus();
    await terminal.pressSequentially('export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1; git init --initial-branch=ynx-qa && git config --local user.name "YNX QA" && git config --local user.email "qa@example.invalid" && node -e "require(\'node:fs\').writeFileSync(\'git-ready.txt\',\'ready\')"');
    await terminal.press('Enter');
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if (await readFile(`${runtime.workspace}/git-ready.txt`, 'utf8') === 'ready') break; } catch {}
      await page.waitForTimeout(50);
    }
    assert.equal(await readFile(`${runtime.workspace}/git-ready.txt`, 'utf8'), 'ready');
    // Wait until the real extension has discovered the repository before
    // opening a command list whose enabled entries are captured at creation.
    await page.locator('#theia-statusBar').filter({ hasText: 'ynx-qa' }).waitFor();
    await page.keyboard.press('F1');
    await command.fill('>Git: Stage All Changes');
    await page.getByText('Git: Stage All Changes', { exact: true }).first().waitFor();
    await command.press('Enter');
    let index;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { index = await readFile(`${runtime.workspace}/.git/index`); } catch {}
      if (index?.length) break;
      await page.waitForTimeout(50);
    }
    assert.ok(index?.length, 'The Git extension did not write the actual repository index');
    await terminal.focus();
    await terminal.pressSequentially('git diff --cached --name-only > git-staged.txt && git commit -m "YNX real workbench Git" && git log -1 --format=%s > git-commit-proof.txt');
    await terminal.press('Enter');
    let commit;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { commit = await readFile(`${runtime.workspace}/git-commit-proof.txt`, 'utf8'); } catch {}
      if (commit) break;
      await page.waitForTimeout(50);
    }
    assert.equal(commit?.trim(), 'YNX real workbench Git');
    assert.match(await readFile(`${runtime.workspace}/git-staged.txt`, 'utf8'), /^main\.js$/m);
    checks.push('official VS Code Git extension stages real project files through the command palette; installed Git commits the actual index through the PTY, verified from repository output');
  }
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'ynx-other-project-boundary-')));
  const otherFile = join(outside, 'public-marker.txt'), otherWrite = join(outside, 'new-file.txt');
  await writeFile(otherFile, 'public other-project marker', { mode: 0o600 });
  const probe = `const fs=require('node:fs'),net=require('node:net');const result={};for(const [name,operation] of [['read',()=>fs.readFileSync(${JSON.stringify(otherFile)})],['write',()=>fs.writeFileSync(${JSON.stringify(otherWrite)},'refused')]]){try{operation();result[name]='ALLOWED'}catch(e){result[name]=e.code}}const socket=net.createConnection({host:'203.0.113.1',port:443});let done=false;function finish(value){if(done)return;done=true;result.network=value;socket.destroy();fs.writeFileSync('boundary-results.json',JSON.stringify(result));process.exit(0)}socket.on('error',e=>finish(e.code));socket.on('connect',()=>finish('ALLOWED'));setTimeout(()=>finish('TIMEOUT'),1000);`;
  await writeFile(`${runtime.workspace}/boundary-probe.cjs`, probe, { mode: 0o600 });
  await terminal.focus(); await terminal.pressSequentially('node boundary-probe.cjs'); await terminal.press('Enter');
  let boundary;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { boundary = JSON.parse(await readFile(`${runtime.workspace}/boundary-results.json`, 'utf8')); } catch {}
    if (boundary) break;
    await page.waitForTimeout(50);
  }
  assert.ok(boundary, 'The real terminal did not return boundary results');
  for (const key of ['read', 'write', 'network']) assert.ok(['EACCES', 'EPERM'].includes(boundary[key]), `${key}: ${boundary[key]}`);
  await assert.rejects(readFile(otherWrite), { code: 'ENOENT' });
  checks.push('OS-enforced terminal boundary refuses another synthetic project read/write and outbound TCP, with real permission errors and no write side effect');
  if (runtime.dapRoot) {
    await page.keyboard.press('Meta+p'); await input.fill('debug.js');
    await page.locator('.quick-input-list .monaco-list-row.focused').getByText('debug.js', { exact: true }).first().waitFor(); await input.press('Enter');
    const debugLines = page.locator('.monaco-editor .view-lines').filter({ hasText: 'console.log(marker);' });
    await debugLines.waitFor();
    // Click the rendered executable line. Ctrl+Home is not the macOS editor
    // binding and previously left the caret on the trailing empty line.
    await debugLines.locator('.view-line').nth(1).click();
    await page.keyboard.press('F9');
    await page.keyboard.press('F5');
    await page.waitForFunction(() => [...document.querySelectorAll('.theia-debug-thread .status')].some(node => /paused on (entry|breakpoint)/i.test(node.textContent || '')));
    await page.waitForFunction(() => document.body.innerText.includes('marker:') && document.body.innerText.includes("'YNX debugger reference'"));
    await assert.rejects(readFile(`${runtime.workspace}/debug-proof.txt`), { code: 'ENOENT' });
    await page.screenshot({ path: `${runtime.qa}/actual-debug-breakpoint.png` });
    console.log('actual debugger paused');
    await page.keyboard.press('F10');
    // DAP may supply its own description (js-debug uses "Paused" for a step).
    // Verify the paused thread AND the changed real stack source line.
    await page.waitForFunction(() => [...document.querySelectorAll('.theia-debug-thread .status')].some(node => /^paused\b/i.test(node.textContent || '')));
    await page.waitForFunction(() => document.body.innerText.includes('debug.js3:1'));
    await assert.rejects(readFile(`${runtime.workspace}/debug-proof.txt`), { code: 'ENOENT' });
    checks.push('official JavaScript DAP reaches a real paused session, steps over and exposes the real marker value in the debugger UI');
    await page.keyboard.press('F5');
    let debugProof;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { debugProof = await readFile(`${runtime.workspace}/debug-proof.txt`, 'utf8'); } catch {}
      if (debugProof) break;
      await page.waitForTimeout(50);
    }
    assert.equal(debugProof, 'YNX debugger reference');
    checks.push('continuing the actual debug session executes the target program, confirmed by its disk output');
  }
  let ynxTools;
  try { ynxTools = JSON.parse(await readFile(`${runtime.plugins}/ynx.ynx-tools/package.json`, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (ynxTools) {
    assert.equal(ynxTools.publisher, 'ynx');
    await page.keyboard.press('F1');
    await command.fill('>YNX: Create Read-only Testnet SDK Starter');
    await page.getByText('YNX: Create Read-only Testnet SDK Starter', { exact: true }).first().waitFor();
    await command.press('Enter');
    if (runtime.fixtureSessionId) {
      await page.getByText(/^Create the read-only YNX Testnet SDK starter at /).filter({ visible: true }).waitFor();
      await page.keyboard.press('Escape');
    } else {
      await page.waitForFunction(() => document.body.innerText.includes('Create this starter from an active YNX project runtime.'));
    }
    await assert.rejects(readFile(`${runtime.workspace}/ynx-testnet-readonly.mjs`), { code: 'ENOENT' });
    checks.push('inherited YNX Tools activates in the real extension host; controlled-locator starter cancellation or unbound refusal preserves files without canonical authentication');
  }
  await page.screenshot({ path: `${runtime.qa}/actual-language-editor.png` });
  await writeFile(`${runtime.qa}/actual-host-browser.json`, JSON.stringify({ runtime, runnerSha256, checks, errors, boundary, outside }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  const text = page && !page.isClosed() ? await page.locator('body').innerText() : '';
  const editorDiagnostics = page && !page.isClosed() ? await page.evaluate(() => ({
    focusedElement: document.activeElement?.outerHTML.slice(0, 600),
    renameWidgets: [...document.querySelectorAll('.rename-box')].map(node => ({ className: node.className, text: node.textContent })),
    editors: (window.monaco?.editor?.getEditors?.() || []).map(editor => ({
      language: editor.getModel()?.getLanguageId(), position: editor.getPosition(), hasTextFocus: editor.hasTextFocus(),
      renameSupported: editor.getAction('editor.action.rename')?.isSupported(),
    })),
  })) : undefined;
  await writeFile(`${runtime.qa}/actual-host-browser-failure.json`, JSON.stringify({ runnerSha256, checks, errors, message: String(error), text, editorDiagnostics }, null, 2));
  if (page && !page.isClosed()) await page.screenshot({ path: `${runtime.qa}/actual-host-browser-failure.png` });
  console.error(JSON.stringify({ checks, errors, failure: String(error), text: text.slice(-6000) }));
  throw error;
} finally {
  await browser.close();
}
