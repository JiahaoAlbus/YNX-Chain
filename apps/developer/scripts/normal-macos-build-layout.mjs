// Original offline recipe contract. Input collection/ZIP admission belongs to A.
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
export const NORMAL_ROLES = Object.freeze({
  'workbench-dependencies': 'build/theia-node-modules',
  'workbench-plugins': 'build/plugin-inputs',
  'portable-node': 'build/portable-node',
  'cpp-dependencies': 'build/cpp-node-modules',
  'cpp-syntax': 'build/cpp-syntax',
  'cpp-notices': 'build/cpp-notices',
  'jsonc-parser': 'build/jsonc-parser',
  'solidity-runtime': 'build/solc',
  electron42: 'build/electron42',
  'developer-dependencies': 'build/developer-node-modules',
  'canonical-build-dependencies': 'build/canonical-node-modules',
  'typescript-runtime': 'build/typescript',
  'npm-cli': 'build/npm',
});
const relative = p => typeof p === 'string' && p && !p.includes('\\') && !p.startsWith('/') &&
  p.split('/').every(x => x && x !== '.' && x !== '..');

export function normalNpmAlias(row, inventory) {
  if (!relative(row.path) || row.type !== 'symlink' || typeof row.target !== 'string' ||
      row.target.startsWith('/') || row.target.includes('\\') || !row.path.includes('/.bin/')) throw Error('Normal npm alias differs');
  const role = Object.entries(NORMAL_ROLES).find(([name, root]) => name.endsWith('dependencies') && row.path.startsWith(root + '/'));
  if (!role) throw Error('Normal npm alias role differs');
  const target = posix.normalize(posix.join(posix.dirname(row.path), row.target));
  const pin = inventory.find(p => p.path === target);
  if (!target.startsWith(role[1] + '/') || !pin || pin.type === 'symlink' || !/^[a-f0-9]{64}$/.test(pin.sha256) ||
      inventory.some(p => p.path.startsWith(row.path + '/'))) throw Error('Normal npm alias escapes or becomes a parent');
  return { path: row.path, target: row.target, resolved: target, targetSha256: pin.sha256 };
}

export function normalMacLayout(inventory, electronRelative) {
  if (!Array.isArray(inventory) || !inventory.length || new Set(inventory.map(p => p.path)).size !== inventory.length ||
      inventory.some(p => !relative(p.path))) throw Error('Complete normal build inventory required');
  const roles = {};
  for (const [name, root] of Object.entries(NORMAL_ROLES)) {
    if (!inventory.some(p => p.path.startsWith(root + '/') && p.type !== 'symlink' && Number.isSafeInteger(p.bytes) &&
      p.bytes > 0 && /^[a-f0-9]{64}$/.test(p.sha256))) throw Error('Missing complete normal role: ' + name);
    roles[name] = { root, completeInventory: true };
  }
  const electron = inventory.find(p => p.path === electronRelative);
  if (!electron?.path.startsWith(roles.electron42.root + '/') || electron.type === 'symlink' || electron.mode !== 0o755 ||
      !Number.isSafeInteger(electron.bytes) || electron.bytes <= 0 || !/^[a-f0-9]{64}$/.test(electron.sha256))
    throw Error('Exact executable Electron inventory pin required');
  roles['portable-node'].version = 'v24.19.0'; roles['jsonc-parser'].version = '3.3.1'; roles.electron42.version = '42.10.0';
  const npmBinAliases = inventory.filter(p => p.type === 'symlink' && p.path.includes('/.bin/')).map(p => normalNpmAlias(p, inventory));
  return { schemaVersion: 1, roles, electronBinary: { relative: electron.path, bytes: electron.bytes, sha256: electron.sha256, mode: electron.mode },
    npmBinAliases, inputStatus: 'Inventory declaration only; A must verify every real input byte/mode/link before use.',
    networkOrInstall: false, packageLifecycle: false };
}

export function normalMacPlan({ source, inputs, work }) {
  for (const p of [source, inputs, work]) if (typeof p !== 'string' || resolve(p) !== p) throw Error('Canonical absolute normal recipe roots required');
  const dev = join(source, 'apps/developer'), role = name => join(inputs, NORMAL_ROLES[name]);
  const candidates = join(dev, '.ynx-developer-candidates'), cpp = join(candidates, 'cpp-normal-current');
  const portable = join(candidates, 'portable-local-node24-legal-20261007'), plugins = join(candidates, 'normal-offline-plugins');
  const core = join(work, 'outputs/composed-core'), output = join(work, 'outputs/macos-arm64');
  const mappings = [
    ['developer-dependencies', 'apps/developer/node_modules'],
    ['workbench-dependencies', 'apps/developer/runtime/theia/node_modules'],
    ['typescript-runtime', 'apps/developer/services/language-service/node_modules/typescript'],
    ['portable-node', 'apps/developer/.ynx-developer-candidates/portable-local-node24-legal-20261007'],
    ['workbench-plugins', 'apps/developer/.ynx-developer-candidates/normal-offline-plugins'],
  ].map(([name, target]) => ({ role: name, from: role(name), to: join(source, target) }));
  // The original formatter explicitly consumes this reviewed JSON-RPC root.
  mappings.push({ role: 'cpp-dependencies', from: join(role('cpp-dependencies'), 'vscode-jsonrpc'),
    to: join(candidates, 'cpp-offline-language-release-inputs-20261004/ynx.ynx-cpp/node_modules/vscode-jsonrpc') });
  const prefix = join(work, 'toolchain');
  mappings.push({ role: 'npm-cli', from: role('npm-cli'), to: join(prefix, 'lib/node_modules/npm') });
  const node = join(portable, 'node'), npm = join(prefix, 'lib/node_modules/npm/bin/npm-cli.js'), privateBin = join(work, 'bin');
  const env = { YNX_DEVELOPER_CANONICAL_SDK_ROOT: join(inputs, 'sdk'),
    // Full retained builder root includes esbuild0.25.9, not merely distributable316.
    YNX_DEVELOPER_CANONICAL_DEPENDENCY_ROOT: role('canonical-build-dependencies'),
    YNX_DEVELOPER_CANONICAL_NATIVE_ROOT: join(work, 'component/source'),
    YNX_DEVELOPER_BUILD_OUTPUT_ROOT: join(work, 'outputs'), YNX_DEVELOPER_MACOS_OUTPUT_DIR: output,
    YNX_DEVELOPER_MACOS_REQUIRE_CLONE: '1', YNX_DEVELOPER_LOCAL_NODE_RUNTIME: portable,
    YNX_DEVELOPER_COMPOSED_ARTIFACT: core, YNX_DEVELOPER_COMPOSED_PIN: core + '.pin.json',
    YNX_DEVELOPER_SOLIDITY_INPUT: role('solidity-runtime'), YNX_DEVELOPER_SOLIDITY_FORMAT_INPUT: 'retained',
    YNX_IDE_SOLC_INPUT: role('solidity-runtime'), YNX_IDE_SOLIDITY_FORMAT_INPUT: 'retained',
    npm_config_prefix: prefix, PATH: privateBin + ':' + (process.env.PATH || '/usr/bin:/bin') };
  const commands = [
    { name: 'current-cpp-stage', tool: node, argv: [join(dev, 'runtime/theia/scripts/stage-cpp-extension.mjs'), cpp,
      role('cpp-dependencies'), role('cpp-syntax'), join(role('cpp-notices'), 'ThirdPartyNotices.txt'), role('jsonc-parser')], cwd: source },
    { name: 'owned-workbench-build', tool: node, argv: [npm, '--prefix', join(dev, 'runtime/theia'), 'run', 'build'], cwd: source },
    { name: 'normal-core-package', tool: node, argv: [join(dev, 'runtime/theia/scripts/package-runtime.mjs'), core, plugins, cpp], cwd: source },
    { name: 'normal-native-app-dmg', tool: '/bin/bash', argv: [join(dev, 'scripts/package-local-macos.sh')], cwd: source },
  ];
  return { mappings, commands, env, node, npm, output, core, privateBin,
    toolBindings: [{ name: 'node', tool: node, argv: [] }, { name: 'npm', tool: node, argv: [npm] }],
    checkpoints: ['Original A binds fresh component under work/component and calls strict derived admission before relocation.',
      'Owned workbench build regenerates its consumer; original A commits only admitted component2pins/normal consumer3paths before final App package.',
      'Provide private PATH node/npm and npm_config_prefix whose global npm tree is this exact retained npm-cli role; no ambient npm/toolchain fallback.',
      'Stage input roles, source checkout and output on the same admitted APFS build volume. Materialization requires COW; no unbudgeted physical-copy fallback.',
      'Original normal build gates run once in the actual new build. Do not separately repeat old source suites.',
      'A must validate complete input inventory, exact npm alias endpoints, Mac framework links and file modes before materialization.'],
    readback: { script: 'apps/developer/scripts/verify-normal-macos-release.mjs', args: ['APP', 'DMG', core, core + '.pin.json', source, 'FRESH_READBACK_OUTPUT'] } };
}

export async function materializeNormalMacInputs(plan) {
  for (const row of plan.mappings) {
    try { await lstat(row.to); throw Error('Refusing to merge a normal input target: ' + row.to); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    await mkdir(resolve(row.to, '..'), { recursive: true });
    await cp(row.from, row.to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true,
      mode: constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE_FORCE });
  }
  if (plan.toolBindings) {
    await mkdir(plan.privateBin, { mode: 0o700 });
    const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
    for (const tool of plan.toolBindings) {
      if (!['node', 'npm'].includes(tool.name) || tool.tool !== plan.node) throw Error('Unexpected normal private tool binding');
      await writeFile(join(plan.privateBin, tool.name), '#!/bin/sh\nexec ' + [tool.tool, ...tool.argv].map(quote).join(' ') + ' "$@"\n', { flag: 'wx', mode: 0o755 });
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [contractFile, source, inputs, work, action] = process.argv.slice(2), contract = JSON.parse(await readFile(contractFile));
  normalMacLayout(contract.reviewedBuildInventory, contract.reviewedBuildLayout.electronBinary.relative);
  const plan = normalMacPlan({ source, inputs, work });
  if (action === '--materialize') await materializeNormalMacInputs(plan);
  else if (action && action !== '--plan') throw Error('Unknown normal recipe action');
  console.log(JSON.stringify(plan, null, 2));
}
