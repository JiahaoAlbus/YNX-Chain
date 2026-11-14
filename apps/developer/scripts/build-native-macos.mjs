import { readFile, writeFile, mkdir, lstat, realpath, copyFile } from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { selectNativeSources, createNativeLinkPlan, ownedUndefinedSymbols } from './native-macos-link-plan.mjs';
const exec = promisify(execFile), developer = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function pinned(row) {
  const s = await lstat(row.path);
  if (!s.isFile() || s.isSymbolicLink() || await realpath(row.path) !== row.path || s.size !== row.bytes) throw Error('Invalid pinned input: ' + row.path);
  const h = createHash('sha256'); for await (const b of createReadStream(row.path)) h.update(b);
  if (h.digest('hex') !== row.sha256) throw Error('Pinned native input changed: ' + row.path);
}
async function jsonPin(row) { await pinned(row); return JSON.parse(await readFile(row.path)); }
const [mode, handoff, workRoot, binary, minimumOS] = process.argv.slice(2);
if(mode==='--root63-supplier-qa'){
 const {runRoot63}=await import('./root63-product.mjs');await runRoot63(handoff);process.exit(0);
}
if(mode==='--current-product-supplier-qa'){
  if(process.argv.length!==5)throw Error('Use --current-product-supplier-qa --plan|--execute exact-current-handoff');
  const {runCurrentProductQA}=await import('./current-product-supplier-qa.mjs');
  console.log(JSON.stringify(await runCurrentProductQA(workRoot,handoff)));process.exit(0);
}
if(mode==='--isolated-supplier-qa'){
  if(process.argv.length!==5)throw Error('Use --isolated-supplier-qa --plan|--execute exact-isolated-QA-handoff');
  const {runIsolatedCocoaSupplierQA}=await import('./isolated-cocoa-supplier-qa.mjs');
  console.log(JSON.stringify(await runIsolatedCocoaSupplierQA(workRoot,handoff)));process.exit(0);
}
if (!['--plan', '--execute'].includes(mode) || !handoff || !workRoot || !binary || !minimumOS) throw Error('Use --plan|--execute exact-wholelink-handoff fresh-work-root App-binary measured-minimum-OS');
const root63=await import('./root63-product.mjs');
const r21=await import('./r21-cocoa-product.mjs');
const cocoaVariant=r21.cocoaVariantForHandoff(resolve(handoff));
if(cocoaVariant){
 console.log(JSON.stringify(await r21.buildR21Product({workRoot:resolve(workRoot),binary:resolve(binary),minimumOS,execute:mode==='--execute',variant:cocoaVariant})));process.exit(0);
}
const c6=await import('./c6-diagnostic-product.mjs');
if(resolve(handoff)===c6.C6_HANDOFF.path){
 const sourceRoot=(await exec('/usr/bin/git',['rev-parse','--show-toplevel'],{cwd:developer})).stdout.trim();
 const sourceCommit=(await exec('/usr/bin/git',['rev-parse','HEAD'],{cwd:sourceRoot})).stdout.trim();
 console.log(JSON.stringify(await c6.buildC6Product({workRoot:resolve(workRoot),binary:resolve(binary),minimumOS,sourceCommit,sourceRoot,execute:mode==='--execute'})));process.exit(0);
}
if(resolve(handoff)===root63.ROOT63_HANDOFF){
 const sourceRoot=(await exec('/usr/bin/git',['rev-parse','--show-toplevel'],{cwd:developer})).stdout.trim();
 const sourceCommit=(await exec('/usr/bin/git',['rev-parse','HEAD'],{cwd:sourceRoot})).stdout.trim();
 if((await exec('/usr/bin/git',['status','--porcelain','--untracked-files=no'],{cwd:sourceRoot})).stdout.trim())throw Error('Committed producer required');
 console.log(JSON.stringify(await root63.adoptRoot63({workRoot:resolve(workRoot),binary:resolve(binary),minimumOS,sourceCommit,sourceRoot,execute:mode==='--execute'})));process.exit(0);
}
if(resolve(handoff)==='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-current-r2-product-normal-qa-successor-20261101/execution-current/HANDOFF.json'){
  const {adoptCurrentProductBuild}=await import('./adopt-current-product-build.mjs');
  const sourceRoot=(await exec('/usr/bin/git',['rev-parse','--show-toplevel'],{cwd:developer})).stdout.trim();
  const sourceCommit=(await exec('/usr/bin/git',['rev-parse','HEAD'],{cwd:sourceRoot})).stdout.trim();
  if((await exec('/usr/bin/git',['status','--porcelain','--untracked-files=no'],{cwd:sourceRoot})).stdout.trim())throw Error('Committed current producer required');
  console.log(JSON.stringify(await adoptCurrentProductBuild({handoff,workRoot:resolve(workRoot),binary:resolve(binary),minimumOS,sourceCommit,sourceRoot,execute:mode==='--execute'})));process.exit(0);
}
const h = await jsonPin({ path: resolve(handoff), bytes: 1969, sha256: '365bbc7d8259f1c14bea7c82f3f14991a204355985d831743fb2a42e85d4c096' });
const recipe = await jsonPin(h.exactAExecutionData), sdkMap = await jsonPin(h.SDKMap), physical = await jsonPin(h.physicalReadback);
const current = await jsonPin(sdkMap.currentHandoff);
if (sdkMap.sourceRecord.commit !== '8edbfc57e2beb91b58360ae781d5c39ef1d56950'
  || current.source.commit !== sdkMap.sourceRecord.commit || physical.sourceCount !== 373
  || physical.SourceFiles.length !== 373 || sdkMap.SDKRows.length !== 188) throw Error('Matching complete source identity required');
for (const row of sdkMap.SDKRows) {
  if (row.current.path !== join(sdkMap.currentSourceRoot, row.captured.relativePath)) throw Error('Current SDK mapping escaped its root');
}
const ownPins = new Map();
const sourceRoot = (await exec('/usr/bin/git', ['rev-parse', '--show-toplevel'], { cwd: developer })).stdout.trim();
const sourceCommit = (await exec('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: sourceRoot })).stdout.trim();
for (const row of physical.SourceFiles.filter(row => row.relativePath.startsWith('apps/developer/desktop/macos/'))) {
  const path = join(sourceRoot, row.relativePath), bytes = await readFile(path);
  const original = await exec('/usr/bin/git', ['show', sourceCommit + ':' + row.relativePath], { cwd: sourceRoot, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 });
  if (!bytes.equals(original.stdout)) throw Error('Own native App source is not committed');
  ownPins.set(row.relativePath, { path, bytes: bytes.length, sha256: hash(bytes) });
}
if (mode === '--execute' && (await exec('/usr/bin/git', ['status', '--porcelain', '--untracked-files=no'], { cwd: sourceRoot })).stdout.trim()) throw Error('Commit source before normal App execution');
const inputs = selectNativeSources(physical.SourceFiles, sdkMap, ownPins);
for (const input of inputs) await pinned(input);
const plan = createNativeLinkPlan({ recipe, inputs, workRoot: resolve(workRoot), binary: resolve(binary), minimumOS });
plan.sourceCommit = sourceCommit; plan.SDKSourceCommit = sdkMap.sourceRecord.commit;
plan.SDKHandoff = sdkMap.currentHandoff;
plan.producerFiles = [];
for (const name of ['build-native-macos.mjs', 'native-macos-link-plan.mjs', 'package-local-macos.sh']) {
  const path = join(developer, 'scripts', name), bytes = await readFile(path);
  if (mode === '--execute') {
    const original = await exec('/usr/bin/git', ['show', sourceCommit + ':apps/developer/scripts/' + name], { cwd: sourceRoot, encoding: 'buffer' });
    if (!bytes.equals(original.stdout)) throw Error('Native producer is not the committed source');
  }
  plan.producerFiles.push({ path, sha256: hash(bytes) });
}
plan.supplierHandoff = { path: resolve(handoff), sha256: '365bbc7d8259f1c14bea7c82f3f14991a204355985d831743fb2a42e85d4c096' };
plan.executionPerformed = false;
await mkdir(plan.workRoot, { mode: 0o700 }); // New output only; reconcile any prior attempt.
await writeFile(join(plan.workRoot, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
if (mode === '--plan') { console.log(JSON.stringify({ validated: true, sourceInputs: inputs.length, objects: plan.commands.length, compilerExecuted: false, plan: join(plan.workRoot, 'plan.json') })); }
else {
  // Only the original permitted A builder executes this path. No platform
  // rejection, signing permission or business admission is supplied by argv.
  const outputParent = await lstat(dirname(plan.binary));
  if (!outputParent.isDirectory() || outputParent.isSymbolicLink() || outputParent.uid !== process.getuid()
    || (outputParent.mode & 0o022) || await realpath(dirname(plan.binary)) !== dirname(plan.binary)) throw Error('Unsafe App output parent');
  await mkdir(join(plan.workRoot, 'objects')); await mkdir(join(plan.workRoot, 'source'));
  for (const input of inputs) {
    const to = join(plan.workRoot, 'source', input.relativePath);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(input.path, to, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    await pinned({ ...input, path: to });
  }
  try { await lstat(plan.binary); throw Error('Refusing to replace an App binary'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const results = [];
  for (const command of [...plan.commands, { name: 'strict-normal-App-link', argv: plan.linkArgv }]) {
    let result;
    try { result = await exec(command.argv[0], command.argv.slice(1), { cwd: plan.workRoot, timeout: 900000, maxBuffer: 8 * 1024 * 1024 }); }
    catch (error) {
      results.push({ name: command.name, exit: error.code, signal: error.signal, stdout: error.stdout, stderr: error.stderr });
      await writeFile(join(plan.workRoot, 'execution.json'), JSON.stringify({ sourceCommit, results, complete: false }, null, 2) + '\n');
      throw error;
    }
    results.push({ name: command.name, exit: 0, stdout: result.stdout, stderr: result.stderr });
    await writeFile(join(plan.workRoot, 'execution.json'), JSON.stringify({ sourceCommit, results, complete: false }, null, 2) + '\n');
  }
  for (const input of inputs) await pinned(input);
  const undefinedResult = await exec('/usr/bin/nm', ['-u', plan.binary], { maxBuffer: 4 * 1024 * 1024 });
  await writeFile(join(plan.workRoot, 'undefined.txt'), undefinedResult.stdout, { flag: 'wx', mode: 0o600 });
  const ownedUndefined = ownedUndefinedSymbols(undefinedResult.stdout);
  if (ownedUndefined.length) throw Error('Owned native symbols remain undefined: ' + ownedUndefined.join(', '));
  const image = await readFile(plan.binary);
  await writeFile(join(plan.workRoot, 'execution.json'), JSON.stringify({ sourceCommit, results, complete: true, ownedUndefined, binarySHA256: hash(image), RootAdmission: false, SourceAdmission: false, NativeAdmission: false }, null, 2) + '\n');
  console.log(JSON.stringify({ linked: true, binary: plan.binary, sourceCommit, RootAdmission: false }));
}
