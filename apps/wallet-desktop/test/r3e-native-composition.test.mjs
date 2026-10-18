import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {originalAuthNativeBuildPlan,originalAuthNativeInputPins} from '../scripts/build-original-auth-identity-native.mjs';
import {verifyCanonicalNativeReceipt} from '../scripts/canonical-package.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
test('R3e actual A33 module retains exact executed receipt and all thirty-two compile inputs',()=>{
 const bytes=readFileSync(new URL('../native/original-auth-identity.node',import.meta.url)),raw=readFileSync(new URL('../native/original-auth-identity-build.json',import.meta.url)),receipt=JSON.parse(raw);
 assert.equal(sha(bytes),'0ebfb6277f5c6bc40609404978624d192defe86fd465003ebfc9baff35b9eef7');assert.equal(sha(raw),'445c0b0ab02a9e8321e6406dfab7669d995f4b1522bfc1e1c3e409fae2e4433c');
 const pins=originalAuthNativeInputPins(originalAuthNativeBuildPlan('arm64',receipt.headerRoot),receipt.headerRoot);assert.equal(pins.inputFiles.length,32);assert.deepEqual(pins.inputFiles,receipt.inputFiles);
 const actual=verifyCanonicalNativeReceipt(receipt,bytes,pins.inputFiles.map(p=>p.relative),name=>readFileSync(path.join(root,name)));assert.equal(actual.commandsKind,'executed-normal-build');assert.equal(actual.readbackOnly,false);assert.equal(actual.nativeQualified,false);
 const native=createRequire(import.meta.url)(fileURLToPath(new URL('../native/original-auth-identity.node',import.meta.url)));assert.equal(Object.getOwnPropertyNames(native).length,53);
});
test('R3e actual normal unconfigured SDK refuses without fabricating Native parent selection',()=>{
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('./r3e-native-client-refusal.mjs',import.meta.url))],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',timeout:10000,maxBuffer:65536});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
 const row=JSON.parse(result.stdout.trim());assert.equal(row.firstCause,'IDE_ORIGINAL_PRIVATE_PARENT_NOT_SUPPLIED');assert.equal(row.positiveNativeGrant,false);assert.equal(row.hostACK,false);assert.equal(row.nativePartialAcquisitionTested,false);
});
