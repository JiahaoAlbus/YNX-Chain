#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>JSON.parse(fs.readFileSync(path,"utf8"));
const decision=read("release/integration/p0-wallet-connectivity/acceptance/p0-062-wallet-auth-directory-fd-commit-source-review-20260821.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
assert.equal(decision.decision,"REJECT_SOURCE_ONLY_POST_COMMIT_THROWABLE_PATH");
assert.equal(decision.sourceCommit,"695b1330575e5f29e25cef7dd7f97caa2253f59e");
assert.equal(decision.sourceAccepted,false);
assert.equal(decision.executionLeaseIssued,false);
assert.equal(decision.blockingFinding.code,"POST_COMMIT_THROWABLE_PATH");
const task=queue.tasks.find(item=>item.taskId==="P0-062");
assert.equal(task.status,"SOURCE_ARTIFACTS_FROZEN_NO_GO_POST_COMMIT_THROWABLE_PATH");
assert.equal(task.sourceAccepted,false);
assert.equal(task.executionLeaseIssued,false);
assert.equal(leases.heavy.owner,null);
console.log("PASS P0-062 is source-only NO_GO and no execution lease was issued");
