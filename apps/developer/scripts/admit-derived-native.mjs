// Build-time custody only. The unchanged runtime guard still accepts exact pins.
import { readFile, writeFile, lstat, realpath, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCanonicalNativeBuildReceipt } from './package-identity-admission-source.mjs';
import { inspectBinary } from './verify-macos-compatibility.mjs';

export const PARENT_COMMIT = '67676e96bc309810c9d5b8b0a31430d114a0b6f1';
export const PARENT_TREE = 'c50cc0b42418d511add752285de8509b0b5ac3cd';
export const PARENT_INPUT_SHA = '0a9fae0c74d03e6a62fb308595a44faf043202369a89066f7d4a111c9e49ba48';
const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '../../..');
const inputPath = 'apps/developer/scripts/canonical-identity-inputs.json';
const guardPath = 'apps/developer/scripts/package-identity-admission-source.mjs';
const modulePath = 'apps/wallet-desktop/native/original-auth-identity.node';
const receiptPath = 'apps/wallet-desktop/native/original-auth-identity-build.json';
const sha = b => createHash('sha256').update(b).digest('hex');
const builderRelative = 'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs';
const NORMAL_TOOLS = [
  { path: 'apps/wallet-desktop/package.json', bytes: 3610, sha256: '580c96b2b5951e0ee74d4c24e29d7244000fca06444d259123781b6175e8c632' },
  { path: 'apps/wallet-desktop/scripts/canonical-package.mjs', bytes: 8671, sha256: '6ca1e82f40d4910a5a69e3dc789eb30bfa3647c432037e1bae4502638aedcc2b' },
  { path: builderRelative, bytes: 6020, sha256: 'd4cc52db89b5ff455823d3b39d90cea9d69abb6015a8b825355ed4dfe1feef43' },
];
const git = (...args) => execFileSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8' }).trim();
const units = ['apps/wallet-desktop/native/original-auth-identity-node.mm',
  ...['original-auth-identity-source-authority.mm', 'original-auth-identity-joint-owner.mm',
    'original-ide-parent-source-binding.mm', 'original-ide-parent-kernel.mm', 'original-ide-parent-node.mm']
    .map(name => 'packages/wallet-auth/native/' + name)];

export function pinnedParent() {
  const raw = execFileSync('/usr/bin/git', ['show', PARENT_COMMIT + ':' + inputPath], { cwd: repo });
  if (sha(raw) !== PARENT_INPUT_SHA) throw Error('Derived Native parent pin differs');
  return JSON.parse(raw);
}

export function validateDerivedReceipt(record, parent, nativeRoot, headerRoot) {
  if (record.sourceRoot !== nativeRoot || record.headerRoot !== headerRoot || record.readbackOnly !== false ||
      record.commandsKind !== 'executed-normal-build' || JSON.stringify(record.architectures) !== '["arm64"]')
    throw Error('Derived Native executed receipt/root/architecture differs');
  const expectedHeaders = parent.node22HeaderPins.filter(p => !p.path.includes('/') && p.path.endsWith('.h'));
  const normalHeaders = record.headers?.map(p => ({ path: p.relative, bytes: p.bytes, sha256: p.sha256 }));
  if (expectedHeaders.length !== 63 || JSON.stringify(normalHeaders) !== JSON.stringify(expectedHeaders))
    throw Error('Derived Native complete Node22 header closure differs');
  const argv = ['-std=c++17', '-fobjc-arc', '-dynamiclib', '-undefined', 'dynamic_lookup',
    '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=original_auth_identity', '-mmacosx-version-min=13.0',
    '-I' + headerRoot, '-I' + join(nativeRoot, 'packages/wallet-auth/native'),
    '-framework', 'Foundation', '-framework', 'Security', '-lbsm', '-arch', 'arm64',
    ...units.map(p => join(nativeRoot, p)), '-o', join(nativeRoot, modulePath)];
  if (JSON.stringify(record.commands) !== JSON.stringify([{ tool: '/usr/bin/clang++', argv }]))
    throw Error('Derived Native exact normal six-TU command differs');
  if (!record.output || record.output.bytes > 64 * 1024 * 1024) throw Error('Derived Native output limit differs');
  // Rebind only the output of a verified new build; every source/header and
  // qualification check in the original validator remains in force.
  const derived = { ...parent, nativeComponent: { ...parent.nativeComponent,
    module: { path: modulePath, bytes: record.output.bytes, sha256: record.output.sha256 } } };
  validateCanonicalNativeBuildReceipt(record, derived, 'arm64');
  return derived;
}

const exactKeys = (value, keys) => value && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function fail(condition) { if (!condition) throw Error('Derived Native independent execution/load evidence differs'); }
export function validateDerivedEvidence(execution, passive, record, receiptPin, buildTerminal, loadTerminal, names, electronPath) {
  const common = ['schemaVersion', 'sourceCommit', 'sourceTree', 'githubRunId', 'githubRunAttempt', 'githubJob', 'module', 'terminal'];
  fail(exactKeys(execution, [...common, 'sourceRoot', 'headerRoot', 'builderCommand', 'builderExitCode', 'receipt']));
  fail(exactKeys(passive, [...common, 'electronVersion', 'platform', 'arch', 'exports', 'exitCode']));
  for (const item of [execution, passive]) {
    fail(item.schemaVersion === 1 && item.sourceCommit === PARENT_COMMIT && item.sourceTree === PARENT_TREE &&
      /^[1-9][0-9]*$/.test(item.githubRunId) && typeof item.githubRunId === 'string' &&
      /^[1-9][0-9]*$/.test(item.githubRunAttempt) && typeof item.githubRunAttempt === 'string' && item.githubJob === 'macos-arm64-native');
    fail(exactKeys(item.module, ['relative', 'bytes', 'sha256']) && item.module.relative === 'source/' + modulePath &&
      item.module.bytes === record.output.bytes && item.module.sha256 === record.output.sha256);
    fail(exactKeys(item.terminal, ['relative', 'bytes', 'sha256']) && Number.isSafeInteger(item.terminal.bytes) &&
      item.terminal.bytes > 0 && /^[a-f0-9]{64}$/.test(item.terminal.sha256));
  }
  fail(execution.terminal.relative === 'normal-build.terminal.json' && passive.terminal.relative === 'passive-load.terminal.json');
  for (const field of ['githubRunId', 'githubRunAttempt', 'githubJob']) fail(execution[field] === passive[field]);
  fail(execution.sourceRoot === record.sourceRoot && execution.headerRoot === record.headerRoot &&
    execution.headerRoot.endsWith('/node22-headers') && execution.builderExitCode === 0);
  fail(exactKeys(execution.receipt, ['relative', 'bytes', 'sha256']) && execution.receipt.relative === 'source/' + receiptPath &&
    execution.receipt.bytes === receiptPin.bytes && execution.receipt.sha256 === receiptPin.sha256);
  const command = execution.builderCommand;
  fail(exactKeys(command, ['tool', 'argv']) && typeof command.tool === 'string' && resolve(command.tool) === command.tool &&
    command.tool.endsWith('/node') && JSON.stringify(command.argv) === JSON.stringify([join(record.sourceRoot, builderRelative), 'arm64', record.headerRoot]));
  for (const terminal of [buildTerminal, loadTerminal]) fail(exactKeys(terminal, ['tool', 'argv', 'exitCode', 'signal', 'error']) &&
    terminal.exitCode === 0 && terminal.signal === null && terminal.error === null);
  fail(buildTerminal.tool === command.tool && JSON.stringify(buildTerminal.argv) === JSON.stringify(command.argv));
  fail(typeof electronPath === 'string' && resolve(electronPath) === electronPath && loadTerminal.tool === electronPath &&
    JSON.stringify(loadTerminal.argv) === JSON.stringify([join(dirname(record.sourceRoot), 'passive-load.cjs'), join(record.sourceRoot, modulePath)]));
  fail(names.length === 63 && new Set(names).size === 63 && JSON.stringify([...names].sort()) === JSON.stringify(names));
  fail(passive.electronVersion === '42.10.0' && passive.platform === 'darwin' && passive.arch === 'arm64' && passive.exitCode === 0 &&
    JSON.stringify(passive.exports) === JSON.stringify(names));
  return true;
}

async function exactDirectory(path) {
  const st = await lstat(path);
  if (resolve(path) !== path || await realpath(path) !== path || !st.isDirectory() || st.isSymbolicLink())
    throw Error('Derived Native canonical directory required');
}
async function regular(path) {
  const st = await lstat(path);
  if (!st.isFile() || st.isSymbolicLink() || await realpath(path) !== path) throw Error('Derived Native regular file required');
  const bytes = await readFile(path); return { bytes, size: bytes.length, sha256: sha(bytes) };
}
async function verifyRows(root, rows) {
  for (const row of rows) {
    const actual = await regular(join(root, row.path));
    if (actual.size !== row.bytes || actual.sha256 !== row.sha256) throw Error('Derived Native source/header bytes differ: ' + row.path);
  }
}
function checkMachO(path, minimum) {
  const slices = inspectBinary(path);
  if (slices?.length !== 1 || slices[0].architecture !== 'arm64' || !['1', 'macos'].includes(slices[0].platform) ||
      minimum && slices[0].minimumOS !== minimum) throw Error('Derived Native actual Mach-O differs');
  return slices;
}

// Read the original builder's independently retained execution and passive-load
// records. Do not rebuild, load Native again, rebase its receipt, or grant rights.
export async function admitDerivedNative({ componentRoot, headerRoot, contractPath, output, apply = false }) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw Error('Derived Native requires actual macOS arm64');
  const parent = pinnedParent();
  git('merge-base', '--is-ancestor', PARENT_COMMIT, 'HEAD');
  const codeCommit = git('rev-parse', 'HEAD');
  if (codeCommit === PARENT_COMMIT || git('status', '--porcelain', '--untracked-files=no'))
    throw Error('Derived Native requires a committed clean successor of R108');
  const current = await readFile(join(repo, inputPath)), guard = await readFile(join(repo, guardPath), 'utf8');
  if (sha(current) !== PARENT_INPUT_SHA || !guard.includes("CANONICAL_IDENTITY_INPUTS_SHA256 = '" + PARENT_INPUT_SHA + "'"))
    throw Error('Derived Native original parent selection changed');
  const nativeRoot = join(componentRoot, 'source');
  for (const path of [componentRoot, nativeRoot, headerRoot, dirname(output)]) await exactDirectory(path);
  if (resolve(output) !== output) throw Error('Derived Native absolute fresh output required');
  const contractBytes = await regular(contractPath), contract = JSON.parse(contractBytes.bytes);
  if (contract.source?.commit !== PARENT_COMMIT || contract.source.tree !== PARENT_TREE ||
      contract.runtime?.electron !== '42.10.0' || contract.runtime.electronArch !== 'arm64' ||
      JSON.stringify(contract.native?.sources) !== JSON.stringify(parent.nativeSources) ||
      JSON.stringify(contract.native?.inputs) !== JSON.stringify(parent.nativeBuildInputs) ||
      JSON.stringify(contract.native?.toolFiles) !== JSON.stringify(NORMAL_TOOLS)) throw Error('Derived Native fixed staging contract differs');
  const selectedElectron = contract.reviewedBuildLayout?.electronBinary;
  if (typeof selectedElectron?.path !== 'string' || !Number.isSafeInteger(selectedElectron.bytes) || selectedElectron.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(selectedElectron.sha256)) throw Error('Derived Native reviewed Electron pin required');
  const receipt = await regular(join(nativeRoot, receiptPath)), record = JSON.parse(receipt.bytes);
  const executionFile = await regular(join(componentRoot, 'component-execution.json'));
  const passiveFile = await regular(join(componentRoot, 'electron-passive-load.json'));
  const execution = JSON.parse(executionFile.bytes), passive = JSON.parse(passiveFile.bytes);
  // Admission is performed in the original CI job before relocating artifacts.
  // Do not rewrite original absolute execution paths to make a copied receipt fit.
  const derived = validateDerivedReceipt(record, parent, nativeRoot, headerRoot);
  await verifyRows(nativeRoot, parent.nativeSources);
  await verifyRows(nativeRoot, NORMAL_TOOLS);
  await verifyRows(repo, parent.nativeSources.filter(p => p.path.startsWith('apps/developer/')));
  await verifyRows(headerRoot, record.headers.map(p => ({ ...p, path: p.relative })));
  const binary = await regular(join(nativeRoot, modulePath));
  if (binary.size !== record.output.bytes || binary.sha256 !== record.output.sha256) throw Error('Derived Native actual module differs');
  const macho = checkMachO(join(nativeRoot, modulePath), '13.0');
  const source = (await regular(join(nativeRoot, units[0]))).bytes.toString('utf8');
  const table = source.split('Method methods[]=')[1]?.split('for(auto &m:methods)')[0];
  if (!table) throw Error('Derived Native original export table missing');
  const names = [...table.matchAll(/\{"([^"\n]+)"\s*,/g)].map(m => m[1]).sort();
  async function terminal(pin, expected) {
    if (!exactKeys(pin, ['relative', 'bytes', 'sha256']) || pin.relative !== expected) throw Error('Derived Native terminal path differs');
    const file = await regular(join(componentRoot, expected));
    if (file.size !== pin.bytes || file.sha256 !== pin.sha256) throw Error('Derived Native terminal bytes differ');
    return JSON.parse(file.bytes);
  }
  const buildTerminal = await terminal(execution.terminal, 'normal-build.terminal.json');
  const loadTerminal = await terminal(passive.terminal, 'passive-load.terminal.json');
  validateDerivedEvidence(execution, passive, record, { bytes: receipt.size, sha256: receipt.sha256 },
    buildTerminal, loadTerminal, names, selectedElectron.path);
  const stdout = await regular(join(componentRoot, 'passive-load.stdout')), rawLoad = JSON.parse(stdout.bytes);
  for (const field of ['schemaVersion', 'electronVersion', 'platform', 'arch', 'exports', 'exitCode'])
    if (JSON.stringify(rawLoad[field]) !== JSON.stringify(passive[field])) throw Error('Derived Native passive stdout differs');
  if (rawLoad.module?.sha256 !== binary.sha256 || rawLoad.module.bytes !== binary.size) throw Error('Derived Native passive stdout module differs');
  // Detect a producer changing any source/module/receipt during admission.
  await verifyRows(nativeRoot, parent.nativeSources);
  await verifyRows(nativeRoot, NORMAL_TOOLS);
  await verifyRows(headerRoot, record.headers.map(p => ({ ...p, path: p.relative })));
  for (const [path, before] of [[join(nativeRoot, modulePath), binary], [join(nativeRoot, receiptPath), receipt],
    [join(componentRoot, 'component-execution.json'), executionFile], [join(componentRoot, 'electron-passive-load.json'), passiveFile],
    [join(componentRoot, 'normal-build.terminal.json'), execution.terminal], [join(componentRoot, 'passive-load.terminal.json'), passive.terminal],
    [join(componentRoot, 'passive-load.stdout'), stdout],
    [contractPath, contractBytes]])
    if ((await regular(path)).sha256 !== before.sha256) throw Error('Derived Native input changed during load');
  derived.nativeComponent.receipt = { path: receiptPath, bytes: receipt.size, sha256: receipt.sha256 };
  derived.derivedNativeBuild = { schemaVersion: 1, parentIDECommit: PARENT_COMMIT, parentInputSha256: PARENT_INPUT_SHA,
    admissionCodeCommit: codeCommit, admissionCodeTree: git('rev-parse', 'HEAD^{tree}'),
    sourceRoot: nativeRoot, headerRoot, stagingContractSha256: contractBytes.sha256, electron: selectedElectron,
    actualExecution: execution, actualPassiveLoad: passive, passiveStdoutSha256: stdout.sha256,
    executionEvidenceSha256: executionFile.sha256, passiveEvidenceSha256: passiveFile.sha256,
    macho, nativeQualified: false, registrationAccepted: false };
  const bytes = Buffer.from(JSON.stringify(derived, null, 2) + '\n'), inputSha = sha(bytes);
  const changedGuard = guard.replace("CANONICAL_IDENTITY_INPUTS_SHA256 = '" + PARENT_INPUT_SHA + "'",
    "CANONICAL_IDENTITY_INPUTS_SHA256 = '" + inputSha + "'");
  await mkdir(output, { mode: 0o700 }); // No merge, overwrite, or silent replay.
  await writeFile(join(output, 'canonical-identity-inputs.json'), bytes, { flag: 'wx' });
  await writeFile(join(output, 'package-identity-admission-source.mjs'), changedGuard, { flag: 'wx' });
  const result = { state: 'DERIVED_NATIVE_EXACT_CANDIDATE_NOT_RUNTIME_AUTHORITY', parentIDECommit: PARENT_COMMIT,
    admissionCodeCommit: codeCommit, manifestSha256: inputSha, sourceLeaves: 41, inputLeaves: 35, headers: 63,
    module: derived.nativeComponent.module, receipt: derived.nativeComponent.receipt, actualPassiveLoad: passive,
    applied: apply, requiresCandidateCommitBeforePackaging: true, nativeQualified: false, registrationAccepted: false };
  await writeFile(join(output, 'derived-selection.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  if (apply) {
    await writeFile(join(repo, inputPath), bytes);
    await writeFile(join(repo, guardPath), changedGuard);
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [componentRoot, headerRoot, contractPath, output, option] = process.argv.slice(2);
  if (option && option !== '--apply') throw Error('Unknown derived Native option');
  console.log(JSON.stringify(await admitDerivedNative({ componentRoot, headerRoot, contractPath, output, apply: option === '--apply' })));
}
