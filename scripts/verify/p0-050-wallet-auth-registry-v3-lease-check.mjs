#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const read=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const lease=read("release/integration/p0-wallet-connectivity/execution/wallet-auth-registry-v3-a960-lease-20260821.json");
const leases=read("release/integration/p0-wallet-connectivity/execution-leases.json");
const queue=read("release/integration/p0-wallet-connectivity/integration-queue.json");
const locks=read("release/integration/p0-wallet-connectivity/path-locks.json");

assert.notEqual(leases.heavy.taskId,"P0-050");
assert.equal(lease.status,"CONSUMED_RELEASED_FAILED_CLOSED_INVALID_MIGRATION");
assert.equal(lease.singleUse,true);
assert.equal(lease.invalidatedLeaseReusable,false);
assert.equal(lease.source.commit,"a960d1007e7952c2af591d39e3673f1d9fe50e62");
assert.equal(lease.source.artifactCommit,"79a87d87cd819672e65dd42546da997d8a80985e");
assert.equal(lease.freshReadOnlyPreflight.publicSourceCommit,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(lease.freshReadOnlyPreflight.productSessionStateSha256,"343f4cbbce0aed1e3cc5894156c4480e69dfc4775e0b347c63d555bd51790d23");
assert.equal(lease.freshReadOnlyPreflight.serviceActive,true);
assert.equal(lease.freshReadOnlyPreflight.serviceNRestarts,0);
assert.equal(lease.transaction.rollbackFirst,true);
assert.equal(lease.transaction.networkInstallAllowed,false);
assert.equal(lease.transaction.stateContentMayBeReadOrExported,false);
assert.equal(lease.transaction.caddyChangeAllowed,false);
assert.equal(lease.transaction.baseUnitChangeAllowed,false);
assert.equal(lease.transaction.sharedStateMutationAllowed,false);
assert.equal(queue.tasks.filter(item=>item.taskId==="P0-050").length,1);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-050").executionLeaseIssued,false);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-050").p0050LeaseReusable,false);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-050").ownerEvidenceCommit,"8bf1d4a0cb3dd6f62ef8c98fbcc928a18488890e");
assert.equal(lease.result.code,"INVALID_MIGRATION");
assert.equal(lease.result.serviceStopped,false);
assert.equal(lease.result.activeSymlinkChanged,false);
assert.equal(lease.result.candidateActivated,false);
assert.equal(lease.result.retryAllowed,false);
assert.equal(lease.result.evidenceCommit,"8bf1d4a0cb3dd6f62ef8c98fbcc928a18488890e");
assert.equal(lease.result.evidenceTree,"39d60e0b2b433f899e5d23f19bcc86f130618f33");
assert.equal(lease.result.evidenceBlob,"8da214c96da029d2f595fe10f92e2a5479f4d051");
assert.equal(lease.result.evidenceSha256,"a92e68760c5287643f3be624eaf627b92417495007bdd6633c99dd7c95dcc4fb");
assert.equal(lease.result.evidencePending,false);
assert.equal(lease.truthAfterRelease.currentPublicSource,"6cf3ef845202bd879ed94515a71b323dd2fc9e14");
assert.equal(lease.truthAfterRelease.serviceActive,true);
assert.equal(queue.tasks.find(item=>item.taskId==="P0-015").status,"RELEASED_CHECKPOINT");
assert.equal(locks.locks.find(item=>item.taskId==="P0-015").status,"RELEASED_CHECKPOINT");

console.log("PASS P0-050 consumed and released fail-closed on INVALID_MIGRATION; public 6cf stayed active and the lease is nonreusable");
