import assert from 'node:assert/strict';
import fs from 'node:fs';

const acceptance = JSON.parse(fs.readFileSync(new URL('../../release/integration/p0-wallet-connectivity/acceptance/wallet-core-retirement-reconciled-source-deb2cefb-20260821.json', import.meta.url), 'utf8'));
const leases = JSON.parse(fs.readFileSync(new URL('../../release/integration/p0-wallet-connectivity/execution-leases.json', import.meta.url), 'utf8'));
const locks = JSON.parse(fs.readFileSync(new URL('../../release/integration/p0-wallet-connectivity/path-locks.json', import.meta.url), 'utf8'));
const queue = JSON.parse(fs.readFileSync(new URL('../../release/integration/p0-wallet-connectivity/integration-queue.json', import.meta.url), 'utf8'));
const task = queue.tasks.find((item) => item.taskId === 'P0-038');
const dataFabricLock = locks.locks.find((item) => item.owner === 'data-fabric');

assert.ok(task, 'P0-038 must exist');
assert.equal(task.sourceCommit, acceptance.sourceCommit);
assert.equal(task.sourceTree, acceptance.sourceTree);
assert.equal(task.sourceParent, acceptance.sourceParent);
assert.equal(task.deployedPublic, false);
assert.equal(task.publicVerified, false);
assert.equal(task.executionLeaseIssued, false);
assert.equal(acceptance.focusedTests.passed, 26);
assert.equal(acceptance.focusedTests.failed, 0);
assert.equal(acceptance.ownerFullTests.independentlyReplayed, false);
assert.equal(leases.light.owner, null);
assert.equal(leases.light.status, 'RELEASED_CHECKPOINT');
assert.equal(leases.light.previousCheckpoint, 'da095e240be52023ecef19c162c869398bf9fbea');
assert.equal(leases.dataFabric.status, 'CANDIDATE_READY');
assert.equal(leases.dataFabric.checkpointCommit, 'da095e240be52023ecef19c162c869398bf9fbea');
assert.equal(dataFabricLock.status, 'CHECKPOINT_REACHED');
assert.equal(dataFabricLock.checkpointCommit, 'da095e240be52023ecef19c162c869398bf9fbea');

console.log('P0 Core source acceptance and released Data Fabric checkpoint consistency verified');
