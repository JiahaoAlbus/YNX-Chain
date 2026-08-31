import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../../release/integration/p0-wallet-connectivity/', import.meta.url);
const acceptance = JSON.parse(fs.readFileSync(new URL('acceptance/data-fabric-wallet-error-aggregation-da095e24-20260821.json', root), 'utf8'));
const leases = JSON.parse(fs.readFileSync(new URL('execution-leases.json', root), 'utf8'));
const locks = JSON.parse(fs.readFileSync(new URL('path-locks.json', root), 'utf8'));
const queue = JSON.parse(fs.readFileSync(new URL('integration-queue.json', root), 'utf8'));
const assignment = JSON.parse(fs.readFileSync(new URL('assignments/data-fabric.json', root), 'utf8'));

const task = queue.tasks.find((item) => item.taskId === 'P0-005');
const lock = locks.locks.find((item) => item.owner === 'data-fabric');

assert.equal(acceptance.handoffCommit, 'da095e240be52023ecef19c162c869398bf9fbea');
assert.equal(acceptance.lightLeaseReleased, true);
assert.equal(acceptance.deployedPublic, false);
assert.equal(acceptance.publicVerified, false);
assert.equal(leases.light.owner, null);
assert.equal(leases.light.status, 'RELEASED_CHECKPOINT');
assert.equal(leases.heavy.owner, null);
assert.equal(leases.heavy.status, 'RELEASED_FAILED_PREFLIGHT');
assert.equal(lock.status, 'CHECKPOINT_REACHED');
assert.equal(lock.checkpointCommit, acceptance.handoffCommit);
assert.equal(task.status, 'CANDIDATE_READY_LIGHT_LEASE_RELEASED');
assert.equal(task.commit, acceptance.handoffCommit);
assert.equal(task.deployedPublic, false);
assert.equal(task.publicVerified, false);
assert.equal(assignment.status, 'CANDIDATE_READY_LIGHT_LEASE_RELEASED');
assert.equal(assignment.acceptedEvidence.currentEvidenceCommit, acceptance.handoffCommit);

const writable = locks.locks.filter((item) => ['ACTIVE', 'WRITABLE_ACTIVE'].includes(item.status));
assert.equal(writable.filter((item) => item.owner === 'data-fabric').length, 0);

console.log('P0 Data Fabric checkpoint accepted with Light Lease released and public gates false');
