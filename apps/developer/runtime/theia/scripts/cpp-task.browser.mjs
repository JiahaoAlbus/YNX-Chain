import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.YNX_QA_PLAYWRIGHT_MODULE || 'playwright');
const runtime = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert.match(runtime.qa, /^\/private\/tmp\/ynx-theia-extension-qa-[A-Za-z0-9]+$/);
assert.equal(runtime.workspace, `${runtime.qa}/project`);
const prefix = process.argv[3] || 'cpp-task'; assert.match(prefix, /^[a-z-]+$/);
const source = '#include <fstream>\nint main() { std::ofstream("cpp-task-proof.txt") << "YNX actual compiled C++ task"; return 0; }\n';
// A stale binary or old execution receipt cannot satisfy a new candidate run.
// Keep existing fixtures untouched and use a fresh owned project for this test.
for (const name of ['cpp-task-binary', 'cpp-task-proof.txt']) {
  try { await lstat(`${runtime.workspace}/${name}`); throw Error(`Existing ${name}: preserve this project and use a fresh owned QA fixture.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function retainOrCreate(path, content) {
  try { await writeFile(path, content, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await readFile(path, 'utf8'), content, 'Never overwrite an existing changed fixture.'); }
}
await retainOrCreate(`${runtime.workspace}/cpp-task.cpp`, source);
await mkdir(`${runtime.workspace}/.vscode`, { recursive: true });
const tasks = { version: '2.0.0', tasks: [
  { label: 'YNX QA Build C++', type: 'process', command: '/Library/Developer/CommandLineTools/usr/bin/clang++', args: ['-std=c++17', '-fmessage-length=0', '-isysroot', '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk', '${workspaceFolder}/cpp-task.cpp', '-o', '${workspaceFolder}/cpp-task-binary'], options: { cwd: '${workspaceFolder}' }, problemMatcher: ['$gcc'], group: { kind: 'build', isDefault: true }, presentation: { reveal: 'always' } },
  { label: 'YNX QA Run C++', type: 'process', command: '${workspaceFolder}/cpp-task-binary', options: { cwd: '${workspaceFolder}' }, problemMatcher: [], presentation: { reveal: 'always' } }
] };
await retainOrCreate(`${runtime.workspace}/.vscode/tasks.json`, JSON.stringify(tasks, null, 2));
const bytes = await readFile(fileURLToPath(import.meta.url)); await writeFile(`${runtime.qa}/${prefix}-runner.mjs`, bytes, { flag: 'wx', mode: 0o600 });
const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), errors = [], checks = [];
await context.route('**/*', route => new URL(route.request().url()).origin === runtime.url ? route.continue() : route.abort());
const page = await context.newPage(); page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
async function command(label) { await page.keyboard.press('Escape'); await page.keyboard.press('F1'); await page.locator('.quick-input-box input').fill(`>${label}`); await page.locator('.quick-input-list').getByText(label, { exact: true }).first().click(); }
async function savedSource(expected) {
  for (let i = 0; i < 120; i++) {
    if (await readFile(`${runtime.workspace}/cpp-task.cpp`, 'utf8') === expected) return;
    await page.waitForTimeout(50);
  }
  assert.equal(await readFile(`${runtime.workspace}/cpp-task.cpp`, 'utf8'), expected);
}
try {
  await page.goto(runtime.url); await page.locator('#theia-app-shell').waitFor(); await page.locator('.theia-preload').waitFor({ state: 'hidden' });
  const trust = page.getByRole('button', { name: 'Yes, I trust the authors', exact: true });
  if (await trust.count()) {
    assert.ok((await page.locator('body').innerText()).includes(runtime.workspace));
    await trust.click();
    await page.keyboard.press('Escape');
  }
  await page.keyboard.press('Meta+p'); await page.locator('input[placeholder^="Search files by name"]').fill('cpp-task.cpp');
  await page.locator('.quick-input-list').getByText('cpp-task.cpp', { exact: true }).first().click();
  const lines = page.locator('.monaco-editor .view-lines').filter({ visible: true }).last(); await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(source); await page.keyboard.press('Meta+s');
  await savedSource(source);
  await command('Task: Run Build Task');
  for (let i = 0; i < 200; i++) { try { if ((await readFile(`${runtime.workspace}/cpp-task-binary`)).length) break; } catch {} await page.waitForTimeout(50); }
  assert.ok((await readFile(`${runtime.workspace}/cpp-task-binary`)).length > 0);
  checks.push('Actual standard Run Build Task reads VS Code tasks.json and invokes installed LLVM C++ compiler to produce a native executable.');
  await command('Task: Run Task...'); await page.locator('.quick-input-list').getByText('YNX QA Run C++', { exact: true }).first().click();
  for (let i = 0; i < 100; i++) { try { if (await readFile(`${runtime.workspace}/cpp-task-proof.txt`, 'utf8') === 'YNX actual compiled C++ task') break; } catch {} await page.waitForTimeout(50); }
  assert.equal(await readFile(`${runtime.workspace}/cpp-task-proof.txt`, 'utf8'), 'YNX actual compiled C++ task');
  checks.push('Actual standard task execution runs the compiler-produced native binary in this workspace and reads back its real disk output.');
  const binaryHash = createHash('sha256').update(await readFile(`${runtime.workspace}/cpp-task-binary`)).digest('hex');
  await lines.click(); await page.keyboard.press('Meta+a');
  await page.keyboard.insertText('int main() { return YNX_MISSING_CPP_SYMBOL; }\n'); await page.keyboard.press('Meta+s');
  await savedSource('int main() { return YNX_MISSING_CPP_SYMBOL; }\n');
  await command('Task: Run Build Task');
  await page.locator('.monaco-editor .squiggly-error').filter({ visible: true }).first().waitFor();
  // Monaco paints the underline below its text layer. Move the real pointer to
  // its screen coordinates; Playwright's hit-target check otherwise waits on
  // the text span that correctly receives this normal user hover.
  const underline = await page.locator('.monaco-editor .squiggly-error').filter({ visible: true }).first().boundingBox();
  assert.ok(underline);
  await page.mouse.move(underline.x + underline.width / 2, underline.y + underline.height / 2);
  await page.getByText(/use of undeclared identifier.*YNX_MISSING_CPP_SYMBOL/).filter({ visible: true }).first().waitFor();
  assert.equal(createHash('sha256').update(await readFile(`${runtime.workspace}/cpp-task-binary`)).digest('hex'), binaryHash);
  checks.push('A real failed Clang build maps its undeclared-symbol diagnostic onto the exact editor file through $gcc; the previous executable is not relabeled as a successful new build.');
  await page.screenshot({ path: `${runtime.qa}/${prefix}-diagnostic.png` });
  await page.keyboard.press('Escape'); await lines.click(); await page.keyboard.press('Meta+a'); await page.keyboard.insertText(source); await page.keyboard.press('Meta+s');
  await savedSource(source);
  assert.deepEqual(errors, []); await page.screenshot({ path: `${runtime.qa}/${prefix}.png` });
} catch (error) { checks.push({ failure: String(error), text: await page.locator('body').innerText() }); process.exitCode = 1; }
finally {
  const receipt = { runtime, runnerSha256: createHash('sha256').update(bytes).digest('hex'), tasks, checks, errors, scope: 'Installed macOS LLVM compiler through genuine Theia standard tasks/PTY, synthetic owned project. No compiler download or scripted build substitute. This does not prove C++ semantic language extension, debugger, remote/other-platform toolchain or authenticated Chain operation.' };
  await writeFile(`${runtime.qa}/${prefix}-browser.json`, JSON.stringify(receipt, null, 2)); await browser.close(); console.log(JSON.stringify(receipt));
}
