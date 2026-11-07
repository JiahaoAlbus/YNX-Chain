import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {markOriginalIDEContractRelayDiagnostic as mark} from '../src/original-ide-contract-relay-diagnostics.js';
const contract=JSON.parse(fs.readFileSync(new URL('./fixtures/relay-guard-diagnostic-contract.json',import.meta.url)));
test('MODEL exact compiled Native custody failures survive generic scope wrapper without raw details',()=>{
 for(const code of contract.nativeCaptureCauseAllowlist){
  const original=Object.assign(Error('/PRIVATE/source/file'),{code});const error={cause:original};
  mark(error,'SCOPE_INITIAL',original,'NATIVE_READ');assert.equal(error.cause,original);assert.equal(error.relayGuardCauseCode,code);assert.equal(error.relayGuardScopePhase,'NATIVE_READ');
  const output=Object.fromEntries(contract.fields.filter(k=>Object.hasOwn(error,k)).map(k=>[k,Object.getOwnPropertyDescriptor(error,k).value]));assert.ok(!JSON.stringify(output).includes('/PRIVATE/'));
 }
});
test('MODEL Native namespace alone never admits an unknown or user-controlled code',()=>{
 for(const code of ['AUTH_IDENTITY_NOT_LISTED','AUTH_IDENTITY_/PRIVATE/path','AUTH_IDENTITY_ORIGINAL_SOURCE_NOT_SUPPLIED\n']){const error={};mark(error,'SCOPE_INITIAL',{code},'NATIVE_READ');assert.equal(error.relayGuardCauseCode,'UNCLASSIFIED');}
});
test('MODEL code accessor not read; primitive zero remains original failure',()=>{
 let gets=0;const cause={get code(){gets++;throw Error('GETTER');}};const error={};mark(error,'SCOPE_INITIAL',cause,'NATIVE_READ');assert.equal(gets,0);assert.equal(error.relayGuardCauseCode,'UNCLASSIFIED');assert.equal(mark(0,'SCOPE_INITIAL',0,'NATIVE_READ'),0);
});
