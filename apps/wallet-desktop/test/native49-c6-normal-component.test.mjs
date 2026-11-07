import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {native49C6NormalNodeComponent as c,verifyNative49C6ArtifactDATA} from '../scripts/native49-c6-normal-component.mjs';
const role=JSON.parse(fs.readFileSync(new URL('../scripts/native49-c6-normal-component.data.json',import.meta.url)));
const record=fs.readFileSync(new URL('../scripts/native49-c6-record.json',import.meta.url));
const roles=role.sourceRoles;const bad=/NATIVE49_C6_/;
// Actual qualified record bytes, not a synthetic executed-build fixture. Does not read/execute .node.
test('original c6 multiple-source record DATA positive, no App/helper qualification',()=>{const r=c.inspectRecord(record,roles);assert.equal(r.recordDataVerified,true);assert.equal(r.artifactBytesVerified,false);assert.equal(r.wholeAppReady,false);});
test('changed original record rejected',()=>{const b=Buffer.from(record);b[20]^=1;assert.throws(()=>c.inspectRecord(b,roles),bad);});
test('legacy 273/125a record is not c6 alias',()=>assert.throws(()=>c.inspectRecord(Buffer.from('{"kind":"YNX_WALLET_CANONICAL_PORTABLE_QA/v1"}'),roles),bad));
test('wrong CPP source independently rejected',()=>assert.throws(()=>c.inspectRecord(record,{...roles,reusedCPPSourceCommit:'0'.repeat(40)}),bad));
test('wrong Swift builder source independently rejected',()=>assert.throws(()=>c.inspectRecord(record,{...roles,swiftBuilderCommit:'0'.repeat(40)}),bad));
test('wrong image bytes rejected before qualification',()=>assert.throws(()=>c.verify({recordBytes:record,moduleBytes:Buffer.alloc(0),runtimeFiles:{},sourceRoles:roles}),bad));
test('normal pack reader cannot replace actual node with old image',()=>assert.throws(()=>c.verifyPackage({sourceRoles:roles,readPackedAsset:name=>name.endsWith('NATIVE49_C6_NORMAL_RECORD.json')?record:Buffer.alloc(0)}),bad));

test('wrong actual runtime library bytes rejected independently',()=>assert.throws(()=>verifyNative49C6ArtifactDATA('apps/wallet-desktop/native/original-auth-runtime-libs/libssl.3.dylib',Buffer.alloc(0)),bad));
test('unknown runtime asset is not an authorized fallback',()=>assert.throws(()=>verifyNative49C6ArtifactDATA('apps/wallet-desktop/native/original-auth-runtime-libs/libunknown.dylib',Buffer.alloc(0)),bad));
