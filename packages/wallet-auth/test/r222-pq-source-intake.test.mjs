// New SDK32 integration difference only. Supplier scope12/N1/Foundation and
// Native syntax results are reused locally; their original CI entries remain.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import ts from 'typescript';
import {verifySDK332R140Source, sdk332R140NativePlan} from '../../../apps/wallet-desktop/scripts/sdk332-r140-native-plan.mjs';
const root = fs.realpathSync(fileURLToPath(new URL('../../../', import.meta.url))), sdk = path.join(root, 'packages/wallet-auth');
const sha = raw => createHash('sha256').update(raw).digest('hex');
const SUPPLIER_PINS = [
  {
    "path": "apps/wallet-desktop/native/original-auth-identity-node.mm",
    "bytes": 82887,
    "sha256": "f0a6efce5ee63dd6c4b3d0d3d5457c02785ac68764e223bf00e5ec34b05cbf7e"
  },
  {
    "path": "apps/wallet-desktop/native/original-pq-host-catalog-source-owner.inc.mm",
    "bytes": 10514,
    "sha256": "0e04eef1db01cece3776dc2024fadf0664aac9bec4edff5ac7ad3beb188b9d0c"
  },
  {
    "path": "apps/wallet-desktop/scripts/build-original-auth-identity-native.mjs",
    "bytes": 15467,
    "sha256": "d39bdb9f8507ce82c4e184007eaf804cfb94dbbd441e93290bf7253d26883480"
  },
  {
    "path": "packages/wallet-auth/native/original-auth-identity-joint-owner.h",
    "bytes": 1283,
    "sha256": "a240699dea4bc87a71151e0f1f9b34099515088b71a85a207ea2628ef9f9a0f6"
  },
  {
    "path": "packages/wallet-auth/native/original-auth-identity-joint-owner.mm",
    "bytes": 13343,
    "sha256": "ec6aafa361e2b79e9f3c06071a1a890390e3ac19af795631b2b442f9aefbc082"
  },
  {
    "path": "packages/wallet-auth/native/original-auth-identity-native-release.h",
    "bytes": 2979,
    "sha256": "507dbb1a65a70774bbd543db07871b71dd686b766db216049f0fbf61e48bd264"
  },
  {
    "path": "packages/wallet-auth/native/original-auth-identity-source-authority.h",
    "bytes": 7550,
    "sha256": "bd86b8a2717b21904a24bceeb1929aaa4fcd7d0e07f88d3ac289ffb43b00eac8"
  },
  {
    "path": "packages/wallet-auth/native/original-auth-identity-source-authority.mm",
    "bytes": 51354,
    "sha256": "f92cc5a4961ef38b27ddb4a875dae3a82ceff26e2ce24bc45adf610251a70edf"
  },
  {
    "path": "packages/wallet-auth/native/original-auth-identity-source-v2-verifier.mjs",
    "bytes": 31095,
    "sha256": "81ddfc61004152275658945fd4b1d908b349584846b2931696dc4de21170ad8d"
  },
  {
    "path": "packages/wallet-auth/native/original-pq-host-catalog-receipt.h",
    "bytes": 1491,
    "sha256": "e58f25d8a57802bf65ffcd99fe0a3cf70f0c930fbe2e7c95f43fb57f5f358c0c"
  },
  {
    "path": "packages/wallet-auth/native/original-pq-host-catalog-source-contract.mjs",
    "bytes": 3411,
    "sha256": "fff1be6e5bd9859b3dc35dc10fd1f17351ad4423f56b51e20405e00417155cd9"
  },
  {
    "path": "packages/wallet-auth/native/original-pq-host-catalog-source-state.h",
    "bytes": 1553,
    "sha256": "ae0c9012c2198a916af3389390683c7c1c8000fad9421f54951c5139e5b5311a"
  },
  {
    "path": "packages/wallet-auth/native/original-pq-host-catalog-source.h",
    "bytes": 867,
    "sha256": "3fee25e16e1354259d15a9dabec2bbe270d5bbf925f072aa7c1a92f49f84f518"
  },
  {
    "path": "packages/wallet-auth/native/original-pq-host-catalog-source.mm",
    "bytes": 20273,
    "sha256": "343a487e46e1744422d0309ec8c53e6c485f50fe14367676654fcfb82c5da921"
  },
  {
    "path": "packages/wallet-auth/native/original-source-verifier-io.h",
    "bytes": 3710,
    "sha256": "ead5f0581201f2061becfb13141bd05adce937125334e7f31697b86e29854978"
  },
  {
    "path": "packages/wallet-auth/native/test-pq-catalog-source-contract.mjs",
    "bytes": 2111,
    "sha256": "c785e7054a812446ee3b73819f406ef8c533aa5196d28da9f05957624f612af3"
  },
  {
    "path": "packages/wallet-auth/native/test-pq-catalog-source-lifetime.mm",
    "bytes": 4218,
    "sha256": "2db2ead2889913b7acb70f8e1db717e500bc5e9c4920397e5103f5eadf7f7935"
  },
  {
    "path": "packages/wallet-auth/src/original-auth-identity-private-joint-registration.js",
    "bytes": 24134,
    "sha256": "b34e7ca326349f41dda53d0d0238fc275b3bd1db8ff548c6df019f09af55cef7"
  },
  {
    "path": "packages/wallet-auth/src/original-pq-host-catalog-source.js",
    "bytes": 566,
    "sha256": "bd3c32596af7515929a1d2f22143744881cc2872d33b97b0c01fe86d6fa4cc35"
  },
  {
    "path": "packages/wallet-auth/test-pq-catalog-source-n1.mjs",
    "bytes": 6350,
    "sha256": "58c550181c7da4be9570234f58135c3ee84c0ac5de5ba4fcfd3cec160fd76c62"
  },
  {
    "path": "packages/wallet-auth/native/original-pq-host-catalog-task-exit.h",
    "bytes": 629,
    "sha256": "214c375c2bddb96dc057347dd8a3b3471a53ad4fbc56bc317afc8197c6220ff6"
  },
  {
    "path": "packages/wallet-auth/native/test-pq-catalog-task-exit.mm",
    "bytes": 1655,
    "sha256": "52f4733cb2f8d2fb6d0a431fb073b994e42a1199aa487208f25defb40b8dcfc7"
  }
];
const added = ['apps/wallet-desktop/native/original-pq-host-catalog-source-owner.inc.mm', ...['original-pq-host-catalog-source.h', 'original-pq-host-catalog-source.mm', 'original-pq-host-catalog-source-state.h', 'original-pq-host-catalog-receipt.h', 'original-pq-host-catalog-source-contract.mjs', 'original-pq-host-catalog-task-exit.h'].map(n => 'packages/wallet-auth/native/' + n)];

test('R222 with formal R224 successor retains exact supplier leaves and private same-image source surface', () => {
  assert.equal(SUPPLIER_PINS.length, 22);
  for (const r of SUPPLIER_PINS) { const b = fs.readFileSync(path.join(root, r.path)); assert.equal(b.length, r.bytes, r.path); assert.equal(sha(b), r.sha256, r.path); }
  const node = fs.readFileSync(path.join(root, 'apps/wallet-desktop/native/original-auth-identity-node.mm'), 'utf8');
  assert.equal(node.split('#include "original-pq-host-catalog-source-owner.inc.mm"').length - 1, 1);
  const pkg = JSON.parse(fs.readFileSync(path.join(sdk, 'package.json')));
  for (const p of added.filter(p => p.startsWith('packages/wallet-auth/native/'))) assert.ok(pkg.files.includes(p.slice('packages/wallet-auth/'.length)), p);
  assert.ok(pkg.files.includes('src'));
  assert.ok(!Object.keys(pkg.exports).some(p => p.includes('pq-host-catalog-source')));
  const worker = fs.readFileSync(path.join(sdk, 'native/original-pq-host-catalog-source.mm'), 'utf8');
  assert.ok(!worker.includes('waitUntilExit'));
});

test('SDK32 derives99/109/110/87 and15/11; all seven actual new dependencies must be present and declared', async () => {
  const {contract} = verifySDK332R140Source(root), normal = [...contract.NativeInputs, ...contract.HelperInputs, ...contract.pureDeploymentInputs, contract.normalBuildTool];
  assert.equal(contract.version, '1.3.0-pq.3.32-auth.35'); assert.equal(contract.NativeInputs.length, 99); assert.equal(normal.length, 109);
  assert.equal(new Set([...normal, ...contract.sourceCurrentIOInputs].map(r => r.path)).size, 110);
  assert.equal(normal.filter(r => /\.(?:h|mm|cpp)$/.test(r.path)).length, 87);
  for (const p of added) assert.equal(contract.NativeInputs.filter(r => r.path === p).length, 1);
  const selected = await sdk332R140NativePlan(root, '/PUBLIC/UNUSED_HEADERS', 'arm64'), tu = path.join(sdk, 'native/original-pq-host-catalog-source.mm');
  assert.equal(selected.plan.sources.length, 15); assert.equal(selected.plan.sources.filter(p => p === tu).length, 1);
  assert.equal(selected.helperPlan.sources.length, 11); assert.ok(!selected.helperPlan.sources.includes(tu)); assert.equal(selected.NativeBuild, false); assert.equal(selected.grant, false);
  assert.equal(contract.supplierR222.prior31MachineRecordCompatible, false);
  assert.equal(contract.supplierR224.productionChildBoundedJoinVerified, false);
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'PUBLIC-r222-sdk-'))), inventoryPath = 'packages/wallet-auth/integration/SDK332_R140_NATIVE_COMPATIBILITY.json';
  try {
    for (const p of new Set(['apps/wallet-desktop/package.json', 'packages/wallet-auth/package.json', inventoryPath, ...normal.map(r => r.path), ...contract.sourceCurrentIOInputs.map(r => r.path)])) {
      const to = path.join(temp, p); fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(path.join(root, p), to); fs.chmodSync(to, 0o644);
    }
    const tool = await import(pathToFileURL(path.join(temp, contract.normalBuildTool.path)).href);
    for (const p of added) {
      const file = path.join(temp, p), b = fs.readFileSync(file); fs.unlinkSync(file);
      assert.throws(() => tool.originalAuthNativeBuildPlan('arm64', '/PUBLIC/UNUSED_HEADERS'), /AUTH_NATIVE_PQ_CATALOG_SOURCE_SELECTION_INCOMPLETE/);
      fs.writeFileSync(file, b);
    }
    const changed = JSON.parse(fs.readFileSync(path.join(temp, inventoryPath)));
    changed.NativeInputs[changed.NativeInputs.findIndex(r => r.path === added[0])] = changed.NativeInputs[0];
    fs.writeFileSync(path.join(temp, inventoryPath), JSON.stringify(changed));
    assert.throws(() => verifySDK332R140Source(temp), {code: 'SDK332_R140_PQ_CATALOG_INVENTORY_INVALID'});
  } finally { fs.rmSync(temp, {recursive: true, force: true}); }
});

test('SDK32 new private catalog type case retains opaque custody and exact DATA-only role declarations', () => {
  const program = ts.createProgram([path.join(sdk, 'test/node-private-types/pq-host-catalog-source.ts')], {
    strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [], typeRoots: [path.join(sdk, 'node_modules/@types')], skipLibCheck: false,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
