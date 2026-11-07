// Hosted-portable PUBLIC original record custody only. No A path/image/nm/Native access.
import fs from'node:fs';import assert from'node:assert/strict';
import{inspectNative49NAPINormalRecordDATA as inspect}from'../native49-napi-normal-component.mjs';
const role=JSON.parse(fs.readFileSync(new URL('../native49-napi-normal-component.data.json',import.meta.url))),record=fs.readFileSync(new URL('../../test/fixtures/native49-napi/record.json',import.meta.url));let count=0;
function run(n,f){f();count++;console.log('PASS '+n);}
run('pinned actual123K record16ledger/reuse85 and both hosted-original logs DATA',()=>{assert.equal(record.length,123525);const r=inspect(record,role.sourceRoles);assert.equal(r.actual16LedgerAndBothRuntimeOriginalsBound,true);assert.equal(r.NativeAdmission,false);});
run('old4tuple cannot impersonate independent86producer',()=>{const s={...role.sourceRoles};delete s.relinkProducerCommit;delete s.relinkProducerTree;assert.throws(()=>inspect(record,s),/SOURCE_ROLES/);});
run('record byte pollution refuses',()=>{const b=Buffer.from(record);b[10]^=1;assert.throws(()=>inspect(b,role.sourceRoles),/RECORD_BYTES/);});
run('old-schema or new JSON booleans not accepted as record',()=>{assert.throws(()=>inspect(Buffer.from('{"complete":true,"NodeLoad":true}'),role.sourceRoles),/RECORD_BYTES/);});
console.log(JSON.stringify({recordOnlyCases:count,actualNativeArtifactRead:false,AAbsolutePathsRead:false,NativeLoaded:false,RootAdmission:false,SourceAdmission:false}));
