import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, chmod, stat, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NORMAL_ROLES, normalMacLayout, normalMacPlan, normalNpmAlias, materializeNormalMacInputs } from './normal-macos-build-layout.mjs';
const inventory = () => Object.values(NORMAL_ROLES).map(root => ({ path: root + '/example', type: 'file', bytes: 1, sha256: 'a'.repeat(64), mode: 0o755 }));
test('finite layout includes every original builder role; 316 runtime profile is separate from full builder dependencies', () => {
  const rows = inventory(), layout = normalMacLayout(rows, NORMAL_ROLES.electron42 + '/example');
  assert.equal(Object.keys(layout.roles).length, 13);
  assert.equal(layout.roles['canonical-build-dependencies'].root, 'build/canonical-node-modules');
  assert.equal(layout.roles['portable-node'].version, 'v24.19.0');
  assert.equal(layout.roles['jsonc-parser'].version, '3.3.1');
  assert.equal(layout.networkOrInstall, false);
});
test('empty/missing role, escaped inventory and nonexecutable Electron are refused', () => {
  assert.throws(() => normalMacLayout([], 'x'), /inventory/);
  const rows = inventory();
  assert.throws(() => normalMacLayout(rows.slice(1), NORMAL_ROLES.electron42 + '/example'), /Missing complete/);
  assert.throws(() => normalMacLayout([...rows, { path: '../outside' }], 'x'), /inventory/);
  rows.find(p => p.path.startsWith(NORMAL_ROLES.electron42)).mode = 0o644;
  assert.throws(() => normalMacLayout(rows, NORMAL_ROLES.electron42 + '/example'), /Electron/);
});
test('exact npm bin alias may refer only to pinned regular file in same role, never a parent link', () => {
  const file = { path: 'build/developer-node-modules/typescript/bin/tsc', bytes: 1, sha256: 'a'.repeat(64) };
  const alias = { path: 'build/developer-node-modules/.bin/tsc', type: 'symlink', target: '../typescript/bin/tsc' };
  assert.equal(normalNpmAlias(alias, [alias, file]).targetSha256, file.sha256);
  for (const target of ['/etc/passwd', '../../../other', '../missing'])
    assert.throws(() => normalNpmAlias({ ...alias, target }, [alias, file]), /alias/);
  assert.throws(() => normalNpmAlias(alias, [alias, file, { path: alias.path + '/child' }]), /parent/);
});
test('normal plan preserves existing commands, relative plugin/C++ inputs and exact canonical roots', () => {
  const p = normalMacPlan({ source: '/PUBLIC/source with spaces', inputs: '/PUBLIC/inputs', work: '/PUBLIC/work' });
  assert.equal(p.commands.at(-1).argv[0], '/PUBLIC/source with spaces/apps/developer/scripts/package-local-macos.sh');
  assert.equal(p.commands[2].argv[0].endsWith('/package-runtime.mjs'), true);
  assert.equal(p.env.YNX_DEVELOPER_MACOS_REQUIRE_CLONE, '1');
  assert.equal(p.env.YNX_DEVELOPER_CANONICAL_DEPENDENCY_ROOT, '/PUBLIC/inputs/build/canonical-node-modules');
  assert.equal(p.mappings.some(m => m.to.includes('cpp-offline-language-release-inputs-20261004')), true);
  assert.throws(() => normalMacPlan({ source: 'relative', inputs: '/x', work: '/y' }), /absolute/);
});
test('materialization never merges an existing destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-normal-map-'));
  try {
    const from = join(root, 'from'), to = join(root, 'to'); await mkdir(from); await mkdir(to); await writeFile(join(to, 'keep'), 'original');
    await assert.rejects(materializeNormalMacInputs({ mappings: [{ from, to }] }), /Refusing to merge/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('fresh input materialization preserves actual executable mode and raw approved relative bin alias', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ynx-normal-copy-'));
  try {
    const from = join(root, 'from'), to = join(root, 'to');
    await mkdir(join(from, 'pkg'), { recursive: true }); await mkdir(join(from, '.bin'));
    await writeFile(join(from, 'pkg/tool.js'), 'PUBLIC fixture'); await chmod(join(from, 'pkg/tool.js'), 0o755);
    await symlink('../pkg/tool.js', join(from, '.bin/tool'));
    await materializeNormalMacInputs({ mappings: [{ from, to }] });
    assert.equal(await readFile(join(to, 'pkg/tool.js'), 'utf8'), 'PUBLIC fixture');
    assert.equal((await stat(join(to, 'pkg/tool.js'))).mode & 0o777, 0o755);
    assert.equal(await readlink(join(to, '.bin/tool')), '../pkg/tool.js');
  } finally { await rm(root, { recursive: true, force: true }); }
});
