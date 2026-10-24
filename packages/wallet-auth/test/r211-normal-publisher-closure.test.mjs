// Current R211 recipe difference only: no Native/compiler invocation, runtime
// inventory traversal, Auth proof execution, account access or qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifySDK332R140Source, sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';

const root = fs.realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const inventoryPath = 'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json';
const leaf = 'packages/wallet-auth/native/original-ide-protected-publisher-dispatch.mjs';
const hash = raw => createHash('sha256').update(raw).digest('hex');

test('R211 fixed publisher presence remains pinned in the current87 CPP and15/11 successor recipe', async () => {
  const {contract} = verifySDK332R140Source(root);
  const normal = [...contract.NativeInputs, ...contract.HelperInputs, ...contract.pureDeploymentInputs, contract.normalBuildTool];
  assert.equal(contract.version, '1.3.0-pq.3.32-auth.35');
  assert.equal(contract.NativeInputs.length, 99);
  assert.equal(contract.HelperInputs.length, 5);
  assert.equal(normal.length, 109);
  assert.equal(new Set([...normal, ...contract.sourceCurrentIOInputs].map(p => p.path)).size, 103);
  assert.equal(normal.filter(p => /\.(?:h|mm|cpp)$/.test(p.path)).length, 87);
  assert.deepEqual(contract.NativeInputs.find(p => p.path === leaf), {path: leaf, bytes: 7199, sha256: '9fa9078c9ce04da0e2253177a60b351031c94d67942f7fba06e224ab1b4e015b'});
  assert.deepEqual(contract.NativeInputs.find(p => p.path === 'packages/wallet-auth/native/original-auth-identity-source-verifier.mjs'), {path: 'packages/wallet-auth/native/original-auth-identity-source-verifier.mjs', bytes: 20978, sha256: '7670b7093f4ba6fe6f9a26c6b999ec7a4069fec7d46dd06105bc9661867c66cf'});
  const toolRaw = fs.readFileSync(path.join(root, contract.normalBuildTool.path), 'utf8');
  const addition = ',"original-ide-protected-publisher-dispatch.mjs"';
  assert.equal(toolRaw.split(addition).length - 1, 2);
  // R222 intentionally adds a new Native TU; retain R211 fixed presence while
  // pinning the actual successor tool rather than claiming the Auth28 recipe.
  assert.equal(hash(toolRaw), 'd39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480');
  const selected = await sdk332R140NativePlan(root, '/PUBLIC/UNUSED_HEADERS', 'arm64');
  assert.equal(selected.plan.sources.length, 15);
  assert.equal(selected.helperPlan.sources.length, 11);
  assert.equal(selected.NativeBuild, false);
  assert.equal(selected.grant, false);
  for (const plan of [selected.plan, selected.helperPlan]) assert.ok(!plan.sources.includes(path.join(root, leaf)));

  const temp = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'PUBLIC-r211-recipe-')));
  try {
    for (const p of new Set(['packages/wallet-auth/package.json', 'apps/wallet-desktop/package.json', inventoryPath, ...normal.map(p => p.path), ...contract.sourceCurrentIOInputs.map(p => p.path)])) {
      const to = path.join(temp, p); fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(path.join(root, p), to);
    }
    const build = await import(pathToFileURL(path.join(temp, contract.normalBuildTool.path)).href);
    const file = path.join(temp, leaf), original = fs.readFileSync(file);
    fs.unlinkSync(file);
    assert.throws(() => build.originalAuthNativeBuildPlan('arm64', '/PUBLIC/UNUSED_HEADERS'), /AUTH_NATIVE_PROJECT_CONTROL_SOURCE_SELECTION_INCOMPLETE/);
    assert.throws(() => build.originalIDEHelperBuildPlan('arm64'), /AUTH_NATIVE_HELPER_EXECUTABLE_SOURCE_INCOMPLETE/);
    fs.writeFileSync(file, original);
    const changed = JSON.parse(fs.readFileSync(path.join(temp, inventoryPath)));
    changed.NativeInputs[changed.NativeInputs.findIndex(p => p.path === leaf)] = changed.NativeInputs[0];
    fs.writeFileSync(path.join(temp, inventoryPath), JSON.stringify(changed));
    assert.throws(() => verifySDK332R140Source(temp), {code: 'SDK332_R140_CONTROL_INVENTORY_INVALID'});
    fs.copyFileSync(path.join(root, inventoryPath), path.join(temp, inventoryPath));
    fs.appendFileSync(file, '\n// PUBLIC changed bytes\n');
    assert.throws(() => verifySDK332R140Source(temp), {code: 'SDK332_R140_NATIVE_INPUT_DIFFERS'});
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});
