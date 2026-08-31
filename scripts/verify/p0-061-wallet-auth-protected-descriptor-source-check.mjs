#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
const read=path=>JSON.parse(fs.readFileSync(path,"utf8"));
const decision=read("release/integration/p0-wallet-connectivity/acceptance/p0-061-wallet-auth-protected-descriptor-source-review-20260821.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
assert.equal(decision.decision,"REJECT_SOURCE_ONLY_POST_HANDOFF_CLOSE_SPLIT_BRAIN");
assert.equal(decision.sourceCommit,"c2630b5b6ebe9cda541255a275d24095ca9bcd81");
assert.equal(decision.sourceAccepted,false);
assert.equal(decision.executionLeaseIssued,false);
assert.equal(decision.blockingFinding.code,"POST_HANDOFF_CLOSE_SPLIT_BRAIN");
const task=queue.tasks.find(item=>item.taskId==="P0-061");
assert.equal(task.status,"SOURCE_ARTIFACTS_FROZEN_NO_GO_POST_HANDOFF_CLOSE_SPLIT_BRAIN");
assert.equal(task.sourceAccepted,false);
assert.equal(task.executionLeaseIssued,false);
assert.equal(leases.heavy.owner,null);
console.log("PASS P0-061 is source-only NO_GO and no execution lease was issued");
