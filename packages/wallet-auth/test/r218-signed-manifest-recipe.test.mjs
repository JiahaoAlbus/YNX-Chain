// SDK source/type delta only; the five supplier selector tests run separately.
// No Native, prior crypto suite, build, package, runtime scan or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {verifySDK332R140Source, sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root = fs.realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const sdk = path.join(root, 'packages/wallet-auth');
const sha = raw => createHash('sha256').update(raw).digest('hex');

test('R218 exact two supplier SDK leaves join Auth31 without changing CPP81 or14/11 normal recipe', async () => {
  for (const [relative, bytes, hash] of [
    ['src/ide-artifact-signature.js', 12634, '79879c18fe03bb0daa645f210848a8a6242c7ae57cdab99862710225819b9c0e'],
    ['native/original-auth-identity-source-verifier.mjs', 20978, '7670b7093f4ba6fe6f9a26c6b999ec7a4069fec7d46dd06105bc9661867c66cf'],
  ]) { const raw = fs.readFileSync(path.join(sdk, relative)); assert.equal(raw.length, bytes); assert.equal(sha(raw), hash); }
  const {contract} = verifySDK332R140Source(root);
  assert.equal(contract.version, '1.3.0-pq.3.32-auth.31');
  assert.equal(contract.NativeInputs.length, 92);
  const normal = [...contract.NativeInputs, ...contract.HelperInputs, ...contract.pureDeploymentInputs, contract.normalBuildTool];
  assert.equal(normal.length, 102); assert.equal(new Set([...normal, ...contract.sourceCurrentIOInputs].map(r => r.path)).size, 103);
  const cpp = normal.filter(r => /\.(?:h|mm|cpp)$/.test(r.path)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.equal(cpp.length, 81);
  // Exact Auth30 inherited compiled-source/header selection, not a new build.
  assert.equal(sha(JSON.stringify(cpp)), 'c85439713e64ed072d65ad461b7b7d229b24a788727b037b71a41b1b1d2ac01f');
  const plan = await sdk332R140NativePlan(root, '/PUBLIC/UNUSED_HEADERS', 'arm64');
  assert.equal(plan.plan.sources.length, 14); assert.equal(plan.helperPlan.sources.length, 11); assert.equal(plan.NativeBuild, false); assert.equal(plan.grant, false);
  const pkg = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json')));
  assert.equal(pkg.scripts['test:normal-runtime-materialization'], 'node --test test/normal-runtime-materialization.test.mjs');
  assert.ok(pkg.files.includes('scripts/normal-runtime-materialization.mjs'));
  const fixed = fs.readFileSync(path.join(sdk, 'integration/WALLET_APP_RUNTIME_DEPENDENCIES_316.json'));
  assert.equal(fixed.length, 52657); assert.equal(sha(fixed), '403467d07349bbaddab122f9e6e5ca600c2df5965ee96013fc5c5ab94d345106');
});

test('R218 only the new selector private type case accepts DATA and rejects approval/manifest injection', () => {
  const program = ts.createProgram([path.join(sdk, 'test/node-private-types/signed-manifest-selector.ts')], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [], typeRoots: [path.join(sdk, 'node_modules/@types')], skipLibCheck: false,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
