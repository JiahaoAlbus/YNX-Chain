import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const here = new URL(".", import.meta.url);
const authPath = new URL("execution-auth-mode-rw-session-successor.json", here);
const authBody = await readFile(authPath);
const auth = JSON.parse(authBody);
const basePath = new URL("execution-command-objects-successor.json", here);
const baseBody = await readFile(basePath);
const base = JSON.parse(baseBody);
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const fail = (message) => { throw new Error(message); };
const exact = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};

exact(baseBody.length, auth.baseCommandObjects.bytes, "base command bytes");
exact(sha256(baseBody), auth.baseCommandObjects.sha256, "base command sha256");
exact(auth.authentication.requiredUnsetEnvironment, ["VERCEL_OIDC_TOKEN", "BLOB_STORE_ID"], "OIDC variables forbidden");
exact(auth.authentication.requiredSecretEnvironment, ["BLOB_READ_WRITE_TOKEN"], "read-write secret name");

const serialized = Buffer.concat([authBody, baseBody]).toString("utf8");
for (const secretPattern of [
  /BLOB_READ_WRITE_TOKEN\s*[=:]\s*["'][^"']+["']/,
  /VERCEL_OIDC_TOKEN\s*[=:]\s*["'][^"']+["']/,
  /--token(?:=|\s+)[^"'\s,\]]+/
]) {
  if (secretPattern.test(serialized)) fail(`serialized credential pattern: ${secretPattern}`);
}

const validateEnvironment = (env) => {
  for (const name of auth.authentication.requiredUnsetEnvironment) {
    if (Object.hasOwn(env, name) && env[name] !== undefined && env[name] !== "") fail(`${name} must be unset`);
  }
  for (const name of auth.authentication.requiredSecretEnvironment) {
    if (!Object.hasOwn(env, name) || typeof env[name] !== "string" || env[name].length === 0) fail(`${name} unavailable`);
  }
  return true;
};

const validateIdentity = (snapshot) => {
  const locks = auth.identityLocks;
  exact(snapshot.user, locks.user, "Vercel user");
  exact(snapshot.scope, locks.scope, "Vercel scope");
  exact(snapshot.teamId, locks.teamId, "Vercel team");
  exact(snapshot.projectId, locks.projectId, "Vercel project id");
  exact(snapshot.projectName, locks.projectName, "Vercel project name");
  exact(snapshot.blobStoreId, locks.blobStoreId, "Blob store id");
  exact(snapshot.blobStoreName, locks.blobStoreName, "Blob store name");
  exact(snapshot.connectedProject, locks.projectName, "Blob connected project");
  exact(snapshot.status, "Active", "Blob store status");
  if (!snapshot.sampleUrl.startsWith(`${locks.blobPublicOrigin}/`)) fail("Blob URL outside frozen store origin");
  return true;
};

const goodEnvironment = { [auth.authentication.requiredSecretEnvironment[0]]: String(auth.schemaVersion) };
const goodIdentity = {
  user: "jiahaoalbus",
  scope: "jiahaoalbus-projects",
  teamId: "team_JYlLQCpX3qEQiL92qoWMjUrw",
  projectId: "prj_tPB0KDTFohQ9FXZAzq25mYFWkbNa",
  projectName: "ynx-web4-website-new",
  blobStoreId: "store_DygGjsbXsiew8L6U",
  blobStoreName: "ynx-official-downloads",
  connectedProject: "ynx-web4-website-new",
  status: "Active",
  sampleUrl: "https://dyggjsbxsiew8l6u.public.blob.vercel-storage.com/fixture"
};

validateEnvironment(goodEnvironment);
validateIdentity(goodIdentity);

const negativeCases = [
  ["OIDC token present", () => validateEnvironment({ ...goodEnvironment, VERCEL_OIDC_TOKEN: "forbidden-fixture" })],
  ["OIDC store present", () => validateEnvironment({ ...goodEnvironment, BLOB_STORE_ID: "store_DygGjsbXsiew8L6U" })],
  ["read-write token absent", () => validateEnvironment({})],
  ["wrong user", () => validateIdentity({ ...goodIdentity, user: "wrong-user" })],
  ["wrong team", () => validateIdentity({ ...goodIdentity, teamId: "team_wrong" })],
  ["wrong scope", () => validateIdentity({ ...goodIdentity, scope: "wrong-scope" })],
  ["wrong project", () => validateIdentity({ ...goodIdentity, projectId: "prj_wrong" })],
  ["wrong store", () => validateIdentity({ ...goodIdentity, blobStoreId: "store_wrong" })],
  ["wrong origin", () => validateIdentity({ ...goodIdentity, sampleUrl: "https://example.invalid/file.zip" })]
];
for (const [label, run] of negativeCases) {
  let rejected = false;
  try { run(); } catch { rejected = true; }
  if (!rejected) fail(`${label} did not fail closed`);
}

const authCommands = auth.literalPrecheckCommands.map(({ executable, argv }) => ({ executable, argv }));
if (authCommands.some(({ argv }) => argv.some((value) => value.includes("VERCEL_OIDC_TOKEN") || value.includes("BLOB_STORE_ID") || value.includes("BLOB_READ_WRITE_TOKEN")))) fail("credential name in argv");
for (const upload of base.uploadCommands) {
  if (!upload.argv.includes("--allow-overwrite=false")) fail(`${upload.id} overwrite guard missing`);
  if (upload.argv.includes("--allow-overwrite=true")) fail(`${upload.id} overwrite enabled`);
  if (upload.argv.includes("--token") || upload.argv.some((value) => value.startsWith("--token="))) fail(`${upload.id} token in argv`);
}
exact(base.uploadCommands.map((upload) => upload.source.sha256), auth.preservedSafety.packageSha256, "package hashes preserved");
exact(base.websiteExecution.changedPaths.slice().sort(), auth.preservedSafety.websiteAllowedPaths.slice().sort(), "Website paths preserved");
exact(base.websiteExecution.lockedUntouched.path, auth.preservedSafety.websiteForbiddenPath, "catalog untouched");
exact(base.rollbackCommand.argv[1], auth.preservedSafety.rollbackDeploymentId, "rollback deployment preserved");

let liveSession = { executed: false };
if (process.argv.includes("--live-session")) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.VERCEL_OIDC_TOKEN;
  delete cleanEnv.BLOB_STORE_ID;
  const run = (argv) => {
    const result = spawnSync("vercel", argv, { encoding: "utf8", env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] });
    if (result.status !== 0) fail(`live session command failed: ${argv.join(" ")}`);
    return `${result.stdout}\n${result.stderr}`;
  };
  const whoamiOutput = run(auth.literalPrecheckCommands[0].argv);
  if (!whoamiOutput.split(/\r?\n/).some((line) => line.trim() === auth.identityLocks.user)) fail("live whoami");
  const whoami = auth.identityLocks.user;
  const project = run(auth.literalPrecheckCommands[1].argv);
  if (!project.includes(auth.identityLocks.projectId) || !project.includes(auth.identityLocks.projectName)) fail("live project identity");
  const stores = run(auth.literalPrecheckCommands[2].argv);
  for (const value of [auth.identityLocks.blobStoreId, auth.identityLocks.blobStoreName, auth.identityLocks.projectName, "Active"]) {
    if (!stores.includes(value)) fail(`live store identity missing: ${value}`);
  }
  liveSession = { executed: true, user: whoami, projectMatched: true, storeMatched: true, oidcEnvironmentUnset: true };
}

console.log(JSON.stringify({
  schemaVersion: 1,
  authMode: auth.authentication.mode,
  authContractSha256: sha256(authBody),
  baseCommandObjectsSha256: sha256(baseBody),
  fixtureEnvironment: { oidcVariablesAbsent: true, readWriteTokenPresentButNeverSerialized: true },
  liveSession,
  positiveIdentityFixture: true,
  negativeIdentityFixtures: `${negativeCases.length}/${negativeCases.length} fail closed`,
  mutationCommandsExecuted: 0,
  uploadArgvPreserved: "3/3",
  overwriteDisabled: true,
  websitePathsOnly: auth.preservedSafety.websiteAllowedPaths,
  catalogUntouched: true,
  rollbackDeploymentId: auth.preservedSafety.rollbackDeploymentId,
  downloadHosted: false,
  deployed: false,
  publicParity: false
}, null, 2));
