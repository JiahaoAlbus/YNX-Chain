import assert from 'node:assert/strict';
import { readFile, writeFile, lstat, realpath, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBinary } from '../../../scripts/verify-macos-compatibility.mjs';
const source = fileURLToPath(new URL('./native-macos-trash.m', import.meta.url));
const compiler = '/Library/Developer/CommandLineTools/usr/bin/clang';
const sdk = '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function regular(path) {
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(await realpath(path), path);
}
// Shared by packaging and this finite QA: identical compiler/source/target.
export async function buildNativeTrash(output) {
  assert.equal(process.platform, 'darwin'); assert.equal(resolve(output), output);
  await regular(source); await regular(compiler);
  const bytes = await readFile(source), version = spawnSync(compiler, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  const handle = await import('node:fs/promises').then(fs => fs.open(output, 'wx', 0o700));
  await handle.close(); // Only our freshly reserved output may be compiled.
  const args = ['-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-isysroot', sdk,
    '-mmacosx-version-min=15.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64',
    '-framework', 'Foundation', source, '-o', output];
  const compiled = spawnSync(compiler, args, { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr || String(compiled.error));
  await regular(output); assert.deepEqual(await readFile(source), bytes);
  const slices = inspectBinary(output);
  assert.equal(slices.length, 1); assert.equal(slices[0].architecture, process.arch === 'arm64' ? 'arm64' : 'x86_64');
  assert.equal(slices[0].minimumOS, '15.0');
  const receipt = { sourceSha256: hash(bytes), binarySha256: hash(await readFile(output)), slices,
    compiler: { path: compiler, sha256: hash(await readFile(compiler)), version: version.stdout.trim(), args },
    sdk: { path: await realpath(sdk), settingsSha256: hash(await readFile(join(sdk, 'SDKSettings.json'))) },
    systemAPI: 'NSFileManager trashItemAtURL:resultingItemURL:error:', permanentDeleteFallback: false };
  await writeFile(`${output}.receipt.json`, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}

async function qualify(base, resources, inherited) {
  const { localWorkbenchSandboxPolicy, localWorkbenchPathIdentities } = await import('../../../desktop/local-workbench.mjs');
  const root = await realpath(await mkdtemp(join(base, 'trash-qa-')));
  const context = { workspace: join(root, 'workspace'), profile: join(root, 'profile'), temporary: join(root, 'temporary') };
  for (const path of Object.values(context)) await mkdir(path, { mode: 0o700 });
  const runtime = { root: join(root, 'runtime') }; await mkdir(runtime.root, { mode: 0o700 });
  const previous = join(runtime.root, 'inherited-trash'); await cp(inherited, previous, { errorOnExist: true, force: false });
  const next = join(runtime.root, 'native-trash'), build = await buildNativeTrash(next);
  const node = await realpath(join(resources, 'runtime/node'));
  const lockHelper = await realpath(join(resources, 'runtime/ynx-local-workbench-lock'));
  const input = { node, lockHelper, runtime, context, port: 43119 };
  const pathIdentities = await localWorkbenchPathIdentities({ ...input, helper: join(resources, 'runtime/workspace-path-identity') });
  const policy = localWorkbenchSandboxPolicy({ ...input, pathIdentities });
  await writeFile(join(root, 'policy.sb'), policy, { flag: 'wx' });
  // All operation/readback runs inside the same sandbox and native profile lock.
  const driver = join(runtime.root, 'driver.cjs');
  await writeFile(driver, `const fs=require('node:fs'),cp=require('node:child_process');
const [helper,file,expected,mode]=process.argv.slice(2);
const run=cp.spawnSync(helper,[file],{encoding:'utf8',timeout:10000,env:{...process.env,YNX_NATIVE_TRASH_QA_RECEIPT:mode==='receipt'?'1':'0'}});
let retained=false,recoverable=false,receiptError=null;
try{retained=fs.readFileSync(file,'utf8')===expected}catch(e){if(e.code!=='ENOENT')throw e}
if(run.status===0&&mode==='receipt'){try{if(Buffer.byteLength(run.stdout)>65537)throw Error('Oversize QA receipt');const receipt=JSON.parse(run.stdout.trim());
 if(receipt.source!==file)throw Error('Wrong source receipt');
 recoverable=fs.readFileSync(receipt.resultingPath,'utf8')===expected;
 }catch(e){receiptError=e.message}}
console.log(JSON.stringify({status:run.status,signal:run.signal,error:run.error?.message,stdout:run.stdout,stderr:run.stderr,retained,recoverable,receiptError}));
`, { flag: 'wx' });
  const results = [];
  for (const [label, helper, mode] of [['inherited', previous, 'production'], ['candidate', next, 'receipt'], ['production', next, 'production']]) {
    const file = join(context.workspace, `${label}-${randomUUID()}.txt`), expected = `YNX QA ${randomUUID()}\n`;
    await writeFile(file, expected, { flag: 'wx' });
    const run = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, lockHelper, context.profile, node, driver, helper, file, expected, mode],
      { cwd: context.workspace, env: { ...process.env, TMPDIR: context.temporary }, encoding: 'utf8', timeout: 20000 });
    await writeFile(join(root, `${label}.raw.json`), JSON.stringify({ status: run.status, signal: run.signal, error: run.error?.message, stdout: run.stdout, stderr: run.stderr }, null, 2), { flag: 'wx' });
    assert.equal(run.status, 0, run.stderr || String(run.error));
    const result = JSON.parse(run.stdout.trim());
    if (result.status !== 0) assert.equal(result.retained, true, 'Trash failure must preserve the source bytes');
    if (label === 'production') assert.equal(result.stdout, '', 'Ordinary helper must emit no success receipt');
    if (label === 'candidate') assert.ok(Buffer.byteLength(result.stdout || '') <= 65537, 'Single QA receipt must fit the unchanged caller buffer');
    results.push({ label, mode, source: file, helperSha256: hash(await readFile(helper)), ...result,
      accepted: result.status === 0 && result.recoverable && !result.retained });
  }
  // Per-item failure must not silently succeed or remove another item in the
  // same 1000-argument chunk. Exercise the caller's actual multi-item shape.
  const mixedFile = join(context.workspace, `mixed-${randomUUID()}.txt`), mixedBytes = `mixed ${randomUUID()}\n`;
  await writeFile(mixedFile, mixedBytes, { flag: 'wx' });
  const mixedDriver = join(runtime.root, 'mixed.cjs');
  await writeFile(mixedDriver, `const fs=require('node:fs'),cp=require('node:child_process');
const [helper,file,expected]=process.argv.slice(2);
const result=cp.spawnSync(helper,[file+'.absent',file],{encoding:'utf8',timeout:10000,env:{...process.env,YNX_NATIVE_TRASH_QA_RECEIPT:'1'}});
console.log(JSON.stringify({status:result.status,signal:result.signal,stdout:result.stdout,stderr:result.stderr,retained:fs.readFileSync(file,'utf8')===expected}));
`, { flag: 'wx' });
  // Only meaningful when the previous system operation was denied. If it was
  // recoverable, success/readback above is the applicable acceptance instead.
  let mixed = null;
  if (results[1].status !== 0) {
    const run = spawnSync('/usr/bin/sandbox-exec', ['-p', policy, lockHelper, context.profile, node, mixedDriver, next, mixedFile, mixedBytes],
      { cwd: context.workspace, env: { ...process.env, TMPDIR: context.temporary }, encoding: 'utf8', timeout: 20000 });
    await writeFile(join(root, 'mixed.raw.json'), JSON.stringify({ status: run.status, signal: run.signal, stdout: run.stdout, stderr: run.stderr }, null, 2), { flag: 'wx' });
    assert.equal(run.status, 0, run.stderr || String(run.error)); mixed = JSON.parse(run.stdout.trim());
    assert.equal(mixed.status, 1); assert.equal(mixed.retained, true);
    assert.equal(mixed.stdout, '', 'Multi-item invocation must not emit QA receipts even with its flag set');
    assert.ok(mixed.stderr.includes(mixedFile + '.absent') && mixed.stderr.includes(mixedFile), 'Each failed item must be reported');
  }
  const report = { root, build, policySha256: hash(policy), unchangedSandbox: true, results,
    mixedItemFailure: mixed,
    outputContract: { productionSuccess: 'silent', QA: 'argc2 and exact explicit flag only; <=65536 receipt bytes plus newline',
      successfulBulkExecution: 'NOT_VERIFIED; denied controls cannot prove successful Trash', nonzeroMeansNoEffect: false },
    normalNativeAppAcceptance: 'NOT_VERIFIED', operationalTrash: results[1].accepted ? 'RECOVERABLE' : 'BLOCKED_OR_NOT_VERIFIED' };
  await writeFile(join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 5, 'Supply isolated QA base, exact App Resources, inherited helper');
  await qualify(...process.argv.slice(2));
}
