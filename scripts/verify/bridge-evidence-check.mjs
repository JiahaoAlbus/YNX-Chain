#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
const read=path=>JSON.parse(fs.readFileSync(path,"utf8"));
const capacity=read("docs/bridge/capacity-evidence.json"), restore=read("docs/bridge/restore-evidence.json");
const fail=message=>{throw new Error(message);};
if(capacity.classification!=="bounded-local-measurement-not-production-capacity"||capacity.remoteMeasured!==false||capacity.providerLatencyMeasured!==false||capacity.destinationLatencyMeasured!==false)fail("capacity scope overclaim");
if(capacity.state?.transferCount!==100||capacity.state?.growthBytes<=0||capacity.coldStartMs<=0)fail("capacity state evidence invalid");
for(const sample of capacity.samples||[]){if(sample.total!==sample.successes||sample.failures!==0||sample.errorRate!==0||sample.latencyMs?.p50<=0||sample.latencyMs?.p95<sample.latencyMs?.p50||sample.latencyMs?.p99<sample.latencyMs?.p95||sample.throughputPerSecond<=0)fail(`capacity sample invalid: ${sample.name}`);}
if(restore.classification!=="bounded-local-restore-drill"||restore.corruptionRejected!==true||restore.rpoAcceptedMutationLoss!==0||restore.remoteRestore!==false||restore.backup?.mode!=="600"||!/^[0-9a-f]{64}$/.test(restore.backup?.sha256||"")||restore.restoreToHealthMs<=0)fail("restore evidence invalid");
if(restore.restored?.transferCount!==1||restore.restored?.paused!==true||restore.restored?.coordinatorOutstanding!=="100"||restore.restored?.reconciliationBalanced!==true)fail("restored semantics invalid");
for(const commit of [capacity.sourceCommit,restore.sourceCommit]){if(!/^[0-9a-f]{40}$/.test(commit||""))fail("evidence source commit invalid");const result=spawnSync("git",["merge-base","--is-ancestor",commit,"HEAD"]);if(result.status!==0)fail(`evidence source is not an ancestor: ${commit}`);}
console.log(`bridge evidence check passed: capacity source=${capacity.sourceCommit.slice(0,12)} restore source=${restore.sourceCommit.slice(0,12)} zero request failures, corruption rejected, local RPO=0`);
