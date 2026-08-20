import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const expectedSharedPath = "/var/lib/ynx-wallet-gateway/state.json";
const expectedSharedSha256 = "ba386fb9e474ea0886c2e41184db7fac3fcf6aea6dd02f5fe47122a62d3a8c9e";
const expectedReadWriteRoot = "/var/lib/ynx-wallet-gateway";
const expectedCandidateDirectory = "/var/lib/ynx-wallet-gateway/candidate-6cf3ef84";
const expectedCandidateV1 = `${expectedCandidateDirectory}/v1-state.json`;
const expectedCandidateV2 = `${expectedCandidateDirectory}/v2-state.json`;
const service = "ynx-wallet-gateway.service";
const fail = (message) => { throw new Error(message); };
const required = (name) => process.env[name] || fail(`${name} is required`);
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const distinct = (shared, candidateV1, candidateV2) => {
  const values = [shared, candidateV1, candidateV2].map((value) => path.resolve(value));
  if (new Set(values).size !== 3) fail("shared v1, candidate v1 and candidate v2 paths must be distinct");
  return values;
};
const assertStrictDescendant = (root, candidate, label) => {
  const resolvedRoot = path.resolve(root), resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === resolvedRoot || !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) fail(`${label} must be a strict descendant of the exact ReadWritePaths root`);
  if (resolvedCandidate.includes(`${path.sep}..${path.sep}`)) fail(`${label} contains traversal`);
};
if (process.argv.includes("--self-test")) {
  distinct(expectedSharedPath, expectedCandidateV1, expectedCandidateV2);
  assertStrictDescendant(expectedReadWriteRoot, expectedCandidateV1, "candidate v1");
  assertStrictDescendant(expectedReadWriteRoot, expectedCandidateV2, "candidate v2");
  let rejected = false;
  try { distinct(expectedSharedPath, expectedSharedPath, "/tmp/v2-state.json"); } catch { rejected = true; }
  if (!rejected) fail("shared-state alias self-test failed");
  rejected = false;
  try { assertStrictDescendant(expectedReadWriteRoot, "/var/lib/ynx-wallet-gateway-candidate-6cf3ef84/v1-state.json", "candidate v1"); } catch { rejected = true; }
  if (!rejected) fail("ReadWritePaths sibling escape self-test failed");
  console.log("PASS production state-isolation schema self-test: exact in-root candidate paths, three distinct states and sibling escape rejection");
  process.exit(0);
}

const phase = required("YNX_STATE_ISOLATION_PHASE");
if (!new Set(["pre-switch", "post-rollback", "post-activation"]).has(phase)) fail("YNX_STATE_ISOLATION_PHASE must be pre-switch, post-rollback or post-activation");
const [shared, candidateV1, candidateV2] = distinct(required("YNX_SHARED_V1_STATE_PATH"), required("YNX_CANDIDATE_V1_STATE_PATH"), required("YNX_CANDIDATE_V2_STATE_PATH"));
if (shared !== expectedSharedPath) fail("shared legacy v1 state path mismatch");
if (candidateV1 !== expectedCandidateV1 || candidateV2 !== expectedCandidateV2) fail("candidate state path mismatch");
assertStrictDescendant(expectedReadWriteRoot, candidateV1, "candidate v1");
assertStrictDescendant(expectedReadWriteRoot, candidateV2, "candidate v2");
if (phase === "pre-switch" && process.env.YNX_WALLET_GATEWAY_SERVICE_STOPPED_CONFIRMED !== "true") fail("pre-switch copy is allowed only while the service is confirmed stopped");

const readWritePaths = spawnSync("systemctl", ["show", service, "--property=ReadWritePaths", "--value"], { encoding: "utf8" });
if (readWritePaths.status !== 0 || readWritePaths.stdout.trim() !== expectedReadWriteRoot) fail("systemd ReadWritePaths must remain exactly /var/lib/ynx-wallet-gateway");
for (const directory of [expectedReadWriteRoot, expectedCandidateDirectory]) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${directory} must be a real directory, not a symlink`);
}
if (fs.realpathSync(expectedReadWriteRoot) !== expectedReadWriteRoot || fs.realpathSync(expectedCandidateDirectory) !== expectedCandidateDirectory) fail("state path parent traversal resolved through a symlink");
const uidResult = spawnSync("id", ["-u", "ubuntu"], { encoding: "utf8" }), gidResult = spawnSync("id", ["-g", "ubuntu"], { encoding: "utf8" });
if (uidResult.status !== 0 || gidResult.status !== 0) fail("ubuntu service identity unavailable");
const candidateDirectoryStat = fs.lstatSync(expectedCandidateDirectory);
if ((candidateDirectoryStat.mode & 0o777) !== 0o700 || candidateDirectoryStat.uid !== Number(uidResult.stdout.trim()) || candidateDirectoryStat.gid !== Number(gidResult.stdout.trim())) fail("candidate state directory must be ubuntu-owned mode-0700");

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
console.log(JSON.stringify({ phase, systemdReadWritePaths: [expectedReadWriteRoot], readWritePathsExpansionObserved: false, candidateStateDirectory: expectedCandidateDirectory, candidateStateDirectoryOwner: "ubuntu:ubuntu", candidateStateDirectoryMode: "0700", candidateParentSymlink: false, candidatePathsStrictDescendants: true, sharedV1StatePath: shared, sharedV1StateSha256: expectedSharedSha256, candidateV1StatePath: candidateV1, candidateV2StatePath: candidateV2, sharedLegacyV1MutationObserved: false, statePathsDistinct: true }));
