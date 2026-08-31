#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const root=new URL('../../..',import.meta.url);
const json=path=>JSON.parse(readFileSync(new URL(path,root),'utf8'));
const raw=path=>readFileSync(new URL(path,root));
const sha=body=>createHash('sha256').update(body).digest('hex');
const contract=json('apps/finance/evidence/finance-nonregressive-two-phase-command-contract-20260831.json');
const unsigned=json('apps/finance/evidence/finance-nonregressive-carrier-unsigned-lease-candidate-20260831.json');
for(const object of [contract.carrierPreparation.transport,contract.carrierPreparation.bootstrap,contract.carrierPreparation.archive,contract.phase3.transport,contract.phase3.bootstrap,contract.phase3.executor]){
  const body=raw(object.path);assert.equal(body.length,object.bytes,`${object.path} bytes`);assert.equal(sha(body),object.sha256,`${object.path} sha`);
}
assert.equal(JSON.stringify(contract.environment),'{}');assert.equal(contract.shell,false);
assert.equal(contract.carrierPreparation.literalArgvLayout.length,14);
assert.deepEqual(contract.carrierPreparation.centralFinalization.replaceExactlyIndexes,[1,2,3,7,12,13]);
assert.equal(contract.carrierPreparation.literalArgvLayout[10],String(contract.carrierPreparation.archive.bytes));
assert.equal(contract.carrierPreparation.literalArgvLayout[11],contract.carrierPreparation.archive.sha256);
assert.equal(unsigned.lease.signed,false);assert.equal(unsigned.executionCandidate.executable,false);
assert.equal(unsigned.candidate.archive.sha256,contract.carrierPreparation.archive.sha256);
assert.equal(unsigned.candidate.releaseWebDir,'/opt/ynx/releases/finance/finance-combined-4f7fba323a89-20260831t041500z/ynx-finance-4f7fba323a89/web');
assert.equal(contract.phase3.orderedFinalization.mustOccurAfterCarrierReceipt,true);
assert.equal(contract.phase3.orderedFinalization.signedLeaseMustBindFreshCarrierDeviceInodeOwnerModeNlinkBytesAndSha,true);
for(const key of ['archiveTruncation','archiveHashMismatch','foreignCarrier','carrierSymlink','postMoveSubstitution','partialPlacementCleanup','preSwitchFailureCleanup','successRetention','automaticRollback'])assert.equal(contract.failClosedFixtures[key],true,key);
for(const body of [raw(contract.carrierPreparation.transport.path),raw(contract.carrierPreparation.bootstrap.path),raw(contract.phase3.transport.path)])for(const prohibited of ['eth_requestAccounts','personal_sign','sendTransaction','eval '])assert.equal(body.includes(Buffer.from(prohibited)),false,prohibited);
console.log('finance non-regressive two-phase contract: pass');
