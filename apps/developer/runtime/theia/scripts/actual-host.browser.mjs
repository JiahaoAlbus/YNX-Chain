import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const receiptPath = process.argv[2];
const runtime = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.match(runtime.qa, /\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
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
  await page.getByText('main.js', { exact: true }).first().waitFor();
  await input.press('Enter');
  await page.locator('.monaco-editor .view-lines').first().waitFor();
  console.log('real disk file opened');
  await page.locator('.monaco-editor .view-lines').first().click();
  await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('const wallet = { address: "ynx-public-test", balance: 42 };\nwallet.');
  await page.keyboard.press('Control+Space');
  await page.locator('.suggest-widget.visible').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => { const text = document.querySelector('.suggest-widget.visible')?.textContent || ''; return text.includes('address') && text.includes('balance'); });
  const suggestions = await page.locator('.suggest-widget.visible').innerText();
  assert.match(suggestions, /address/);
  assert.match(suggestions, /balance/);
  checks.push('actual TypeScript VS Code extension provides wallet property IntelliSense in the real framework editor');
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
  await page.keyboard.press('Meta+s');
  await page.waitForFunction(() => !document.querySelector('.lm-TabBar-tab.lm-mod-closable.theia-mod-dirty'));
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
  await page.keyboard.press('Meta+w');
  await page.locator('.monaco-editor').waitFor({ state: 'hidden' });
  await page.keyboard.press('Meta+p');
  await input.fill('main.js'); await page.getByText('main.js', { exact: true }).first().waitFor(); await input.press('Enter');
  await page.locator('.monaco-editor .view-lines').first().waitFor();
  assert.match(await page.locator('.monaco-editor .view-lines').first().innerText(), /YNX\sactual\sextension\shost/);
  checks.push('closing and reopening the actual file restores saved disk content');
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
    await page.getByText('debug.js', { exact: true }).first().waitFor(); await input.press('Enter');
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
  await page.screenshot({ path: `${runtime.qa}/actual-language-editor.png` });
  await writeFile(`${runtime.qa}/actual-host-browser.json`, JSON.stringify({ runtime, checks, errors, boundary, outside }, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  const text = page && !page.isClosed() ? await page.locator('body').innerText() : '';
  await writeFile(`${runtime.qa}/actual-host-browser-failure.json`, JSON.stringify({ checks, errors, message: String(error), text }, null, 2));
  if (page && !page.isClosed()) await page.screenshot({ path: `${runtime.qa}/actual-host-browser-failure.png` });
  console.error(JSON.stringify({ checks, errors, failure: String(error), text: text.slice(-6000) }));
  throw error;
} finally {
  await browser.close();
}
