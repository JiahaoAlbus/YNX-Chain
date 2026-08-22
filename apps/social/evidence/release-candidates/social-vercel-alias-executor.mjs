import {readFile, realpath} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {resolve} from "node:path";

const CONTRACT = Object.freeze({
  product: "social",
  owner: "release-control-plane",
  alias: "social.ynxweb4.com",
  project: "ynx-social-web",
  projectId: "prj_QGgUyxilarbPPLZyoES83m2aneQN",
  scope: "jiahaoalbus-projects",
  pathLock: "vercel:social.ynxweb4.com",
  candidate: Object.freeze({
    deploymentId: "dpl_34kzw3uk4B1wwjk1wQUq8y29mTxX",
    immutableUrl: "ynx-social-i38c5m9dw-jiahaoalbus-projects.vercel.app",
    sourceCommit: "e7756cb387233376c03043c54fb8b051c241e94e",
    artifactSha256: "9ffe3eff10175589eeaa7a377e9dc61f3c3a62a77b0a9bcfa415c4764f512b81",
  }),
  rollback: Object.freeze({
    deploymentId: "dpl_2sei8CpmoN1Gi5YKnc6FdvNRyXGy",
    immutableUrl: "ynx-social-h8cqxnkud-jiahaoalbus-projects.vercel.app",
  }),
  commands: Object.freeze({
    readAlias: Object.freeze(["vercel", "api", "/v4/aliases/social.ynxweb4.com", "--scope", "jiahaoalbus-projects", "--raw"]),
    forward: Object.freeze(["vercel", "alias", "set", "ynx-social-i38c5m9dw-jiahaoalbus-projects.vercel.app", "social.ynxweb4.com", "--scope", "jiahaoalbus-projects", "--non-interactive"]),
    rollback: Object.freeze(["vercel", "alias", "set", "ynx-social-h8cqxnkud-jiahaoalbus-projects.vercel.app", "social.ynxweb4.com", "--scope", "jiahaoalbus-projects", "--non-interactive"]),
  }),
});

function fail(message) {
  throw new Error(`SOCIAL_RELEASE_EXECUTOR_REJECTED: ${message}`);
}

function run(command) {
  const result = spawnSync(command[0], command.slice(1), {encoding: "utf8", env: process.env});
  if (result.status !== 0) {
    fail(`command failed (${result.status}): ${command.join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label} mismatch`);
}

async function loadLease(path, action) {
  const fixture = process.env.YNX_SOCIAL_EXECUTOR_FIXTURE === "1";
  const absolute = resolve(path);
  const canonical = await realpath(absolute);
  if (!fixture && !canonical.includes("/release/integration/p0-wallet-connectivity/leases/")) {
    fail("lease is not in the Central-owned release lease directory");
  }
  const lease = JSON.parse(await readFile(canonical, "utf8"));
  assertEqual(lease.schema, "ynx.social.alias-release-lease.v1", "schema");
  assertEqual(lease.status, "ACTIVE_SINGLE_USE", "status");
  assertEqual(lease.product, CONTRACT.product, "product");
  assertEqual(lease.owner, CONTRACT.owner, "owner");
  assertEqual(lease.executor, "apps/social/evidence/release-candidates/social-vercel-alias-executor.mjs", "executor");
  assertEqual(lease.pathLock, CONTRACT.pathLock, "pathLock");
  assertEqual(lease.alias, CONTRACT.alias, "alias");
  assertEqual(lease.projectId, CONTRACT.projectId, "projectId");
  assertEqual(lease.candidateDeploymentId, CONTRACT.candidate.deploymentId, "candidateDeploymentId");
  assertEqual(lease.candidateSourceCommit, CONTRACT.candidate.sourceCommit, "candidateSourceCommit");
  assertEqual(lease.candidateArtifactSha256, CONTRACT.candidate.artifactSha256, "candidateArtifactSha256");
  assertEqual(lease.rollbackDeploymentId, CONTRACT.rollback.deploymentId, "rollbackDeploymentId");
  assertEqual(lease.action, action, "action");
  if (!lease.leaseId?.startsWith("P0-WALLET-CONNECTIVITY-")) fail("leaseId is not a P0 Wallet lease");
  if (!Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= Date.now()) fail("lease is expired");
  if (lease.maximumExecutions !== 1) fail("maximumExecutions must be exactly one");
  const expectedPrewrite = action === "forward" ? CONTRACT.rollback.deploymentId : CONTRACT.candidate.deploymentId;
  assertEqual(lease.expectedCurrentDeploymentId, expectedPrewrite, "expectedCurrentDeploymentId");
  return lease;
}

function readAliasDeploymentId() {
  const output = run(CONTRACT.commands.readAlias);
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    fail("alias readback did not return JSON");
  }
  assertEqual(payload.alias, CONTRACT.alias, "readback alias");
  assertEqual(payload.projectId, CONTRACT.projectId, "readback projectId");
  if (typeof payload.deploymentId !== "string") fail("readback deploymentId missing");
  return payload.deploymentId;
}

const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== "--action" || !["forward", "rollback"].includes(args[1]) || args[2] !== "--lease" || args[4] !== "--execute") {
  console.log(JSON.stringify({contract: CONTRACT, usage: "--action <forward|rollback> --lease <central-lease.json> --execute"}, null, 2));
  process.exit(args.length === 0 ? 0 : 2);
}

if (process.env.YNX_SOCIAL_EXECUTOR_FIXTURE !== "1" && process.env.YNX_SOCIAL_RELEASE_CONTROL_PLANE !== "I_ACKNOWLEDGE_SOCIAL_SINGLE_USE") {
  fail("release-control-plane acknowledgement missing");
}

const action = args[1];
const lease = await loadLease(args[3], action);
assertEqual(readAliasDeploymentId(), lease.expectedCurrentDeploymentId, "prewrite alias deployment");
run(CONTRACT.commands[action]);
const expectedAfter = action === "forward" ? CONTRACT.candidate.deploymentId : CONTRACT.rollback.deploymentId;
assertEqual(readAliasDeploymentId(), expectedAfter, "postwrite alias deployment");
console.log(JSON.stringify({status: "EXECUTED_ONCE", leaseId: lease.leaseId, action, alias: CONTRACT.alias, deploymentId: expectedAfter}, null, 2));
