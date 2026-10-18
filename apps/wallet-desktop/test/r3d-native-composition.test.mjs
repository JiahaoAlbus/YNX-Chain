import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {originalAuthNativeBuildPlan,originalAuthNativeInputPins} from '../scripts/build-original-auth-identity-native.mjs';
import {verifyCanonicalNativeReceipt} from '../scripts/canonical-package.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),sdk=JSON.parse(readFileSync(new URL('../../../packages/wallet-auth/package.json',import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex');
const exactR3d={skip:sdk.version!=='1.3.0-pq.3.4'||process.platform!=='darwin'||process.arch!=='arm64'};
test('R3d independent candidate retains actual A31 module, executed receipt and all thirty compiled source inputs',exactR3d,()=>{
 const moduleBytes=readFileSync(new URL('../native/original-auth-identity.node',import.meta.url)),receiptBytes=readFileSync(new URL('../native/original-auth-identity-build.json',import.meta.url)),receipt=JSON.parse(receiptBytes);
 assert.equal(sha(moduleBytes),'ea20e730de1451b6a07d05fe36e9e82c7c211c212ea953ec6d8fc7b32240717d');assert.equal(sha(receiptBytes),'d7f21970f9b34d2ed0f6150c44470d70f010c0e6697c430b0a00246e10a1d797');
 const plan=originalAuthNativeBuildPlan('arm64',receipt.headerRoot),pins=originalAuthNativeInputPins(plan,receipt.headerRoot);assert.equal(pins.inputFiles.length,30);assert.deepEqual(pins.inputFiles,receipt.inputFiles);
 const verified=verifyCanonicalNativeReceipt(receipt,moduleBytes,pins.inputFiles.map(p=>p.relative),relative=>readFileSync(path.join(root,relative)));
 assert.equal(verified.readbackOnly,false);assert.equal(verified.commandsKind,'executed-normal-build');assert.equal(verified.nativeQualified,false);assert.equal(verified.appSigned,false);
});
test('R3d matching A31 Native is loaded passively without calling Source, service, custody or ACK methods',exactR3d,()=>{
 const native=createRequire(import.meta.url)(fileURLToPath(new URL('../native/original-auth-identity.node',import.meta.url)));
 // N-API default method descriptors are non-enumerable.
 assert.equal(Object.getOwnPropertyNames(native).length,50);
 for(const name of ['acquireOriginalNativePrivateServiceOwner','assertOriginalNativePrivateServiceOwnerReady','readOriginalNativePrivateServiceRequest','writeOriginalNativePrivateServiceResponse','retireOriginalNativePrivateServiceOwner','joinOriginalNativePrivateServiceOwner','closeOriginalNativePrivateServiceOwner','readOriginalNativePrivateServiceTerminalResult','assertOriginalNativePrivateServiceTerminal'])assert.equal(typeof native[name],'function');
});
