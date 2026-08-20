import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const expectedSharedPath = "/var/lib/ynx-wallet-gateway/state.json";
const expectedSharedSha256 = "ba386fb9e474ea0886c2e41184db7fac3fcf6aea6dd02f5fe47122a62d3a8c9e";
const fail = (message) => { throw new Error(message); };
const required = (name) => process.env[name] || fail(`${name} is required`);
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const distinct = (shared, candidateV1, candidateV2) => {
  const values = [shared, candidateV1, candidateV2].map((value) => path.resolve(value));
  if (new Set(values).size !== 3) fail("shared v1, candidate v1 and candidate v2 paths must be distinct");
  return values;
};
if (process.argv.includes("--self-test")) {
  distinct(expectedSharedPath, "/var/lib/ynx-wallet-gateway-candidate/v1-state.json", "/var/lib/ynx-wallet-gateway-candidate/v2-state.json");
  let rejected = false;
  try { distinct(expectedSharedPath, expectedSharedPath, "/tmp/v2-state.json"); } catch { rejected = true; }
  if (!rejected) fail("shared-state alias self-test failed");
  console.log("PASS production state-isolation schema self-test: three exact distinct paths and shared-v1 alias rejection");
  process.exit(0);
}

const phase = required("YNX_STATE_ISOLATION_PHASE");
if (!new Set(["pre-switch", "post-rollback", "post-activation"]).has(phase)) fail("YNX_STATE_ISOLATION_PHASE must be pre-switch, post-rollback or post-activation");
const [shared, candidateV1, candidateV2] = distinct(required("YNX_SHARED_V1_STATE_PATH"), required("YNX_CANDIDATE_V1_STATE_PATH"), required("YNX_CANDIDATE_V2_STATE_PATH"));
if (shared !== expectedSharedPath) fail("shared legacy v1 state path mismatch");
if (phase === "pre-switch" && process.env.YNX_WALLET_GATEWAY_SERVICE_STOPPED_CONFIRMED !== "true") fail("pre-switch copy is allowed only while the service is confirmed stopped");

const safeRegular = (file, label) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) fail(`${label} must be a mode-0600 regular non-symlink with nlink=1`);
  return stat;
};
const sharedStat = safeRegular(shared, "shared v1 state");
const candidateStat = safeRegular(candidateV1, "candidate v1 state");
if (sharedStat.dev === candidateStat.dev && sharedStat.ino === candidateStat.ino) fail("candidate v1 state must not share the legacy state inode");
if (hash(shared) !== expectedSharedSha256) fail("shared legacy v1 state SHA-256 changed");
if (phase === "pre-switch" && hash(candidateV1) !== expectedSharedSha256) fail("candidate v1 initial state is not byte-exact to the stopped-service shared snapshot");
if (fs.existsSync(candidateV2)) {
  const v2Stat = fs.lstatSync(candidateV2);
  if (!v2Stat.isFile() || v2Stat.isSymbolicLink() || v2Stat.nlink !== 1 || (v2Stat.mode & 0o777) !== 0o600) fail("candidate v2 state must be a mode-0600 regular non-symlink with nlink=1");
  if ((v2Stat.dev === sharedStat.dev && v2Stat.ino === sharedStat.ino) || (v2Stat.dev === candidateStat.dev && v2Stat.ino === candidateStat.ino)) fail("candidate v2 state inode must be independent");
}
console.log(JSON.stringify({ phase, sharedV1StatePath: shared, sharedV1StateSha256: expectedSharedSha256, candidateV1StatePath: candidateV1, candidateV2StatePath: candidateV2, sharedLegacyV1MutationObserved: false, statePathsDistinct: true }));
