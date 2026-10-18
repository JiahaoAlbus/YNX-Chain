import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pinnedParent, validateDerivedReceipt, validateDerivedEvidence, PARENT_COMMIT, PARENT_TREE } from './admit-derived-native.mjs';
import { validateCanonicalNativeBuildReceipt } from './package-identity-admission-source.mjs';
const parent = pinnedParent(), root = '/PUBLIC/remote-source', headers = '/PUBLIC/node22-headers';
const units = ['apps/wallet-desktop/native/original-auth-identity-node.mm',
  ...['original-auth-identity-source-authority.mm', 'original-auth-identity-joint-owner.mm',
    'original-ide-parent-source-binding.mm', 'original-ide-parent-kernel.mm', 'original-ide-parent-node.mm']
    .map(p => 'packages/wallet-auth/native/' + p)];
function fixture() {
  return { schemaVersion: 1, kind: 'YNX_WALLET_ORIGINAL_NATIVE_BUILD',
    relativeBases: { inputFiles: 'repository-root', output: 'repository-root', headers: 'pinned-header-root' },
    sourceRoot: root, headerRoot: headers, napiVersion: 8, headerVersion: '22.13.1', minimumSystemVersion: '13.0',
    architectures: ['arm64'], commandsKind: 'executed-normal-build',
    commands: [{ tool: '/usr/bin/clang++', argv: ['-std=c++17', '-fobjc-arc', '-dynamiclib', '-undefined', 'dynamic_lookup',
      '-DNAPI_VERSION=8', '-DNODE_GYP_MODULE_NAME=original_auth_identity', '-mmacosx-version-min=13.0',
      '-I' + headers, '-I' + join(root, 'packages/wallet-auth/native'), '-framework', 'Foundation', '-framework', 'Security',
      '-lbsm', '-arch', 'arm64', ...units.map(p => join(root, p)), '-o', join(root, parent.nativeComponent.module.path)] }],
    inputFiles: parent.nativeBuildInputs.map(p => ({ relative: p.path, bytes: p.bytes, sha256: p.sha256 })),
    headers: parent.node22HeaderPins.filter(p => !p.path.includes('/') && p.path.endsWith('.h'))
      .map(p => ({ relative: p.path, bytes: p.bytes, sha256: p.sha256 })),
    output: { relative: parent.nativeComponent.module.path, bytes: parent.nativeComponent.module.bytes + 16, sha256: '7'.repeat(64) },
    readbackOnly: false, appSigned: false, nativeQualified: false, registrationAccepted: false };
}
test('original guard rejects a rebuilt output until an exact new candidate is derived', () => {
  const r = fixture(); assert.throws(() => validateCanonicalNativeBuildReceipt(r, parent, 'arm64'), /component selection differs/);
  const derived = validateDerivedReceipt(r, parent, root, headers);
  assert.equal(derived.nativeComponent.module.sha256, r.output.sha256);
  for (const key of ['nativeSources', 'nativeBuildInputs', 'node22HeaderPins', 'files', 'dependencies'])
    assert.deepEqual(derived[key], parent[key]);
  assert.equal(r.nativeQualified, false); assert.equal(r.registrationAccepted, false);
  assert.equal(parent.nativeComponent.module.sha256 === r.output.sha256, false, 'parent is immutable');
});
for (const [name, mutate] of [
  ['readback plan', r => { r.readbackOnly = true; r.commandsKind = 'normal-build-plan'; }],
  ['different source root', r => { r.sourceRoot = '/PUBLIC/other'; }],
  ['ambient header root', r => { r.headerRoot = '/PUBLIC/electron-headers'; }],
  ['missing Node22 header', r => { r.headers.pop(); }],
  ['changed header', r => { r.headers[0].sha256 = '0'.repeat(64); }],
  ['missing transport input', r => { r.inputFiles = r.inputFiles.filter(p => !p.relative.endsWith('original-ide-parent-transport.h')); }],
  ['extra compiler injection', r => { r.commands[0].argv.push('-include', '/PUBLIC/extra.h'); }],
  ['missing normal TU', r => { r.commands[0].argv = r.commands[0].argv.filter(p => p !== join(root, units[2])); }],
  ['different architecture', r => { r.architectures = ['x64']; }],
  ['qualification upgrade', r => { r.nativeQualified = true; }],
  ['registration upgrade', r => { r.registrationAccepted = true; }],
]) test('derived receipt rejects ' + name, () => {
  const r = fixture(); mutate(r); assert.throws(() => validateDerivedReceipt(r, parent, root, headers), /differs|required/);
});

const electron = '/PUBLIC/Electron.app/Contents/MacOS/Electron';
function evidence() {
  const record = fixture(), names = Array.from({ length: 63 }, (_, i) => 'method' + String(i).padStart(2, '0'));
  const module = { relative: 'source/' + record.output.relative, bytes: record.output.bytes, sha256: record.output.sha256 };
  const receipt = { relative: 'source/apps/wallet-desktop/native/original-auth-identity-build.json', bytes: 1234, sha256: '8'.repeat(64) };
  const common = { schemaVersion: 1, sourceCommit: PARENT_COMMIT, sourceTree: PARENT_TREE,
    githubRunId: '39100000000', githubRunAttempt: '1', githubJob: 'macos-arm64-native', module };
  const command = { tool: '/PUBLIC/bin/node', argv: [join(root, 'apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs'), 'arm64', headers] };
  const terminal = relative => ({ relative, bytes: 500, sha256: '9'.repeat(64) });
  return { record, names, receipt,
    execution: { ...common, sourceRoot: root, headerRoot: headers, builderCommand: command, builderExitCode: 0, receipt,
      terminal: terminal('normal-build.terminal.json') },
    passive: { ...common, terminal: terminal('passive-load.terminal.json'), electronVersion: '42.10.0', platform: 'darwin',
      arch: 'arm64', exports: names, exitCode: 0 },
    buildTerminal: { ...command, exitCode: 0, signal: null, error: null },
    loadTerminal: { tool: electron, argv: ['/PUBLIC/passive-load.cjs', join(root, record.output.relative)], exitCode: 0, signal: null, error: null } };
}
const checkEvidence = e => validateDerivedEvidence(e.execution, e.passive, e.record, e.receipt,
  e.buildTerminal, e.loadTerminal, e.names, electron);
test('finite schema control binds same source, run, actual receipt and exact passive exports without qualification', () => {
  assert.equal(checkEvidence(evidence()), true);
});
for (const [name, mutate] of [
  ['mixed run', e => { e.passive.githubRunId = '39100000001'; }],
  ['mixed attempt', e => { e.passive.githubRunAttempt = '2'; }],
  ['wrong source tree', e => { e.execution.sourceTree = '0'.repeat(40); }],
  ['wrong module', e => { e.passive.module = { ...e.passive.module, sha256: '0'.repeat(64) }; }],
  ['wrong receipt', e => { e.execution.receipt = { ...e.execution.receipt, sha256: '0'.repeat(64) }; }],
  ['failed builder', e => { e.buildTerminal.exitCode = 1; }],
  ['signaled load', e => { e.loadTerminal.signal = 'SIGTERM'; }],
  ['different loader', e => { e.loadTerminal.tool = '/PUBLIC/fake'; }],
  ['wrong Electron', e => { e.passive.electronVersion = '41.0.0'; }],
  ['missing export', e => { e.passive.exports = e.names.slice(1); }],
  ['unsorted exports', e => { e.passive.exports = [...e.names].reverse(); }],
  ['terminal path escape', e => { e.execution.terminal = { ...e.execution.terminal, relative: '../old.terminal.json' }; }],
  ['extra authority claim', e => { e.passive.grant = true; }],
]) test('independent evidence rejects ' + name, () => {
  const e = evidence(); mutate(e); assert.throws(() => checkEvidence(e), /evidence differs/);
});
