import assert from 'node:assert/strict';
import fs from 'node:fs';

const acceptancePath = new URL('../../release/integration/p0-wallet-connectivity/acceptance/chain-four-node-runtime-be9f0383-20260821.json', import.meta.url);
const queuePath = new URL('../../release/integration/p0-wallet-connectivity/integration-queue.json', import.meta.url);
const acceptance = JSON.parse(fs.readFileSync(acceptancePath, 'utf8'));
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const task = queue.tasks.find((item) => item.taskId === 'P0-037');

assert.ok(task, 'P0-037 must exist');
assert.equal(task.chainSourceCommit, acceptance.sourceCommit);
assert.equal(task.chainEvidenceCommit, acceptance.evidenceCommit);
assert.equal(task.fixedHeight, acceptance.fixedHeight);
assert.equal(task.fixedHeightHash, acceptance.fixedHeightHash);
assert.equal(task.matchingNodeCount, acceptance.matchingNodes.length);
assert.equal(acceptance.matchingNodes.length, 4);
assert.equal(acceptance.followersSynced, true);
assert.equal(acceptance.postRolloutRestartsZero, true);
assert.equal(acceptance.postRolloutOomObserved, false);
assert.equal(acceptance.publicDomainVerified, false);
assert.equal(acceptance.computerControlVerified, false);
assert.equal(acceptance.mainnetReady, false);

console.log('P0 chain four-node runtime acceptance verified');
