// SDK33 source/intake difference only. Actual dispatcher2 is supplied and run
// by its own CI entry; no prior Scope/N1/Foundation/Native suite is repeated.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {verifySDK332R140Source, sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root = fs.realpathSync(fileURLToPath(new URL('../../../', import.meta.url))), sdk = path.join(root, 'packages/wallet-auth');
const sha = raw => createHash('sha256').update(raw).digest('hex');

test('R225 exact dispatcher and original test join SDK33 with unchanged99/109/110/87 and15/11 recipe', async () => {
  for (const [relative, bytes, hash] of [
    ['native/original-auth-source-v2-dispatch.mjs', 7334, '01bed3893f9230060660c44690195a05586168636178a97db5115ee2a605ce30'],
    ['test-pq-catalog-source-dispatch.mjs', 7719, 'f9f4ebfcd17d904890b822d0399016f37facd7b0fc4b2698b884f84c219ef126'],
  ]) { const b = fs.readFileSync(path.join(sdk, relative)); assert.equal(b.length, bytes); assert.equal(sha(b), hash); }
  const {contract} = verifySDK332R140Source(root);
  assert.equal(contract.version, '1.3.0-pq.3.32-auth.34'); assert.equal(contract.NativeInputs.length, 99);
  const normal = [...contract.NativeInputs, ...contract.HelperInputs, ...contract.pureDeploymentInputs, contract.normalBuildTool];
  assert.equal(normal.length, 109); assert.equal(new Set([...normal, ...contract.sourceCurrentIOInputs].map(r => r.path)).size, 110);
  const cpp = normal.filter(r => /\.(?:h|mm|cpp)$/.test(r.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.equal(cpp.length, 87);
  assert.equal(sha(JSON.stringify(cpp)), 'e6bb22e5f880db4d3d54c84a1c0f29167394c074495311d68f69e45cd02cf792');
  assert.equal(contract.normalBuildTool.bytes, 15467);
  assert.equal(contract.normalBuildTool.sha256, 'd39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480');
  const row = contract.NativeInputs.find(r => r.path === 'packages/wallet-auth/native/original-auth-source-v2-dispatch.mjs');
  assert.equal(row.bytes, 7334); assert.equal(row.sha256, '01bed3893f9230060660c44690195a05586168636178a97db5115ee2a605ce30');
  const selected = await sdk332R140NativePlan(root, '/PUBLIC/UNUSED_HEADERS', 'arm64');
  assert.equal(selected.plan.sources.length, 15); assert.equal(selected.helperPlan.sources.length, 11);
  assert.equal(selected.NativeBuild, false); assert.equal(selected.grant, false);
  const pkg = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json'))), lock = JSON.parse(fs.readFileSync(path.join(sdk, 'package-lock.json')));
  assert.equal(pkg.version, lock.version); assert.equal(pkg.version, lock.packages[''].version);
  assert.deepEqual(pkg.exports, contract.publicExports);
  assert.ok(pkg.files.includes('native/original-auth-source-v2-dispatch.mjs'));
  assert.ok(pkg.files.includes('scripts/normal-runtime-materialization.mjs'));
  assert.equal(contract.supplierR225.NativeBuild, false); assert.equal(contract.supplierR225.Source, false); assert.equal(contract.supplierR225.Root, false);
});
