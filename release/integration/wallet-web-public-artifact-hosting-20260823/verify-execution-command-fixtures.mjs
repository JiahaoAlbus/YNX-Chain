import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL(".", import.meta.url);
const commandPath = new URL("execution-command-objects-successor.json", here);
const contract = JSON.parse(await readFile(commandPath, "utf8"));
const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const fail = (message) => { throw new Error(message); };
const exact = (actual, expected, label) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
};

const bundle = Buffer.from(contract.websiteExecution.candidateBundle.base64, "base64");
if (bundle.length !== contract.websiteExecution.candidateBundle.bytes || sha256(bundle) !== contract.websiteExecution.candidateBundle.sha256) fail("candidate bundle identity");

const site = contract.websiteExecution.worktree;
const candidate = contract.websiteExecution.candidateCommit;
exact(execFileSync("git", ["-C", site, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), candidate, "website HEAD");
exact(execFileSync("git", ["-C", site, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(), contract.websiteExecution.candidateTree, "website tree");
const changedPaths = execFileSync("git", ["-C", site, "diff-tree", "--no-commit-id", "--name-only", "-r", candidate], { encoding: "utf8" }).trim().split("\n").sort();
exact(changedPaths, [...contract.websiteExecution.changedPaths].sort(), "website path scope");
const catalogBlob = execFileSync("git", ["-C", site, "rev-parse", `${candidate}:${contract.websiteExecution.lockedUntouched.path}`], { encoding: "utf8" }).trim();
exact(catalogBlob, contract.websiteExecution.lockedUntouched.baseBlobSha1, "catalog unchanged");
for (const file of contract.websiteExecution.candidateFiles) {
  const body = execFileSync("git", ["-C", site, "show", `${candidate}:${file.path}`]);
  exact(body.length, file.bytes, `${file.path} bytes`);
  exact(sha256(body), file.sha256, `${file.path} sha256`);
  exact(execFileSync("git", ["-C", site, "rev-parse", `${candidate}:${file.path}`], { encoding: "utf8" }).trim(), file.gitBlobSha1, `${file.path} blob`);
}

for (const upload of contract.uploadCommands) {
  const body = await readFile(upload.argv[2]);
  exact(body.length, upload.source.bytes, `${upload.id} source bytes`);
  exact(sha256(body), upload.source.sha256, `${upload.id} source sha256`);
  if (!upload.argv.includes("--allow-overwrite=false")) fail(`${upload.id} overwrite guard`);
  if (upload.argv.includes("--allow-overwrite=true")) fail(`${upload.id} overwrite enabled`);
  if (!upload.argv.includes("--add-random-suffix=false")) fail(`${upload.id} deterministic pathname`);
}

const serializedCommands = JSON.stringify({
  uploads: contract.uploadCommands.map(({ executable, argv }) => ({ executable, argv })),
  websitePush: contract.websitePushCommand,
  build: contract.buildCommand,
  deploy: contract.deployCommand,
  promote: contract.promoteCommand,
  rollback: contract.rollbackCommand,
  cleanup: contract.failureCleanupCommand
}).toLowerCase();
for (const forbidden of contract.forbiddenExecutableOrArgvTokens) {
  if (serializedCommands.includes(forbidden.toLowerCase())) fail(`forbidden command token: ${forbidden}`);
}

const vercelConfig = JSON.parse(await readFile(join(site, "vercel.json"), "utf8"));
const registry = JSON.parse(await readFile(join(site, "public/releases/ecosystem-release-registry.json"), "utf8"));
const wallet = registry.products.find((product) => product.key === "wallet");
exact(wallet.walletWebSourceCommit, "fb443431555bed7324b3c2e1fb37aab982a8e243", "registry source");
exact(wallet.walletWebEvidenceCommit, "8190b1b7b8a3b6258d52814445e9fbb285877fcd", "registry evidence");
for (const upload of contract.uploadCommands) {
  const source = `/downloads/wallet-web/${upload.expectedReceipt.pathname.split("downloads/wallet-web/")[1]}`;
  const rewrite = vercelConfig.rewrites.find((entry) => entry.source === source);
  if (!rewrite) fail(`${upload.id} rewrite missing`);
  exact(rewrite.destination, upload.expectedReceipt.url, `${upload.id} receipt binding`);
  const registryEntry = wallet.walletWebDownloads.find((entry) => entry.url === `https://www.ynxweb4.com${source}`);
  if (!registryEntry || registryEntry.sha256 !== upload.source.sha256 || registryEntry.bytes !== upload.source.bytes || registryEntry.hosted !== true) fail(`${upload.id} registry binding`);
}

const fixtureRoot = await mkdtemp(join(tmpdir(), "ynx-wallet-hosting-shell-fixture-"));
const logPath = join(fixtureRoot, "argv.ndjson");
const fakeExecutable = join(fixtureRoot, "vercel-fixture.sh");
await writeFile(fakeExecutable, `#!/bin/bash\nset -euo pipefail\nnode -e 'const fs=require("fs");fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(process.argv.slice(1))+"\\n")' -- "$@"\nif [[ "$1" == "blob" && "$2" == "put" ]]; then\n  pathname=""\n  while [[ "$#" -gt 0 ]]; do\n    if [[ "$1" == "--pathname" ]]; then pathname="$2"; break; fi\n    shift\n  done\n  printf '{"pathname":"%s","url":"https://dyggjsbxsiew8l6u.public.blob.vercel-storage.com/%s"}\\n' "$pathname" "$pathname"\nelif [[ "$1" == "deploy" ]]; then\n  printf '{"id":"dpl_fixture_successor","url":"https://ynx-web4-website-fixture123-jiahaoalbus-projects.vercel.app"}\\n'\nelse\n  printf '{"ok":true}\\n'\nfi\n`, "utf8");
await chmod(fakeExecutable, 0o700);
const shellRun = (argv) => {
  const result = spawnSync("/bin/bash", ["-c", "exec \"$@\"", "wallet-hosting-fixture", fakeExecutable, ...argv], { encoding: "utf8", env: { ...process.env, FIXTURE_LOG: logPath } });
  if (result.status !== 0) fail(`shell fixture failed: ${result.stderr}`);
  return result.stdout.trim();
};

const expectedShellArgv = [];
for (const upload of contract.uploadCommands) {
  const receipt = JSON.parse(shellRun(upload.argv));
  expectedShellArgv.push(upload.argv);
  exact(receipt, upload.expectedReceipt, `${upload.id} shell receipt`);
}
shellRun(contract.websitePushCommand.argv); expectedShellArgv.push(contract.websitePushCommand.argv);
shellRun(contract.buildCommand.argv); expectedShellArgv.push(contract.buildCommand.argv);
const deployReceipt = JSON.parse(shellRun(contract.deployCommand.argv)); expectedShellArgv.push(contract.deployCommand.argv);
if (!new RegExp(contract.deployCommand.receipt.urlPattern).test(deployReceipt.url)) fail("deploy receipt validation");
const promoteArgv = [...contract.promoteCommand.literalArgvTemplate];
promoteArgv[contract.promoteCommand.singleBinding.argvIndex] = deployReceipt.url;
if (!new RegExp(contract.promoteCommand.singleBinding.validationPattern).test(promoteArgv[1])) fail("promote binding validation");
shellRun(promoteArgv); expectedShellArgv.push(promoteArgv);

const shellLog = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
exact(shellLog, expectedShellArgv, "actual-shell argv preservation");

await writeFile(logPath, "", "utf8");
const cleanupTargets = contract.failureCleanupCommand.argv.slice(1);
for (const target of cleanupTargets) await mkdir(target, { recursive: true });
shellRun(contract.rollbackCommand.argv);
const rollbackLog = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
exact(rollbackLog, [contract.rollbackCommand.argv], "rollback exactly once");
const cleanup = spawnSync("/bin/bash", ["-c", "exec \"$@\"", "wallet-hosting-cleanup", contract.failureCleanupCommand.executable, ...contract.failureCleanupCommand.argv], { encoding: "utf8" });
if (cleanup.status !== 0) fail(`cleanup failed: ${cleanup.stderr}`);
for (const target of cleanupTargets) {
  try { await access(target); fail(`cleanup retained ${target}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const statusAfter = execFileSync("git", ["-C", site, "status", "--porcelain"], { encoding: "utf8" }).trim();
exact(statusAfter, "", "website clean after fixtures");

await rm(fixtureRoot, { recursive: true, force: true });
console.log(JSON.stringify({
  schemaVersion: 1,
  commandObjectsFrozen: true,
  websiteCandidate: { commit: candidate, tree: contract.websiteExecution.candidateTree, changedPaths },
  uploadCommands: "3/3 exact",
  overwriteDisabled: true,
  receiptRewriteBinding: "3/3 exact",
  actualShellSuccessFixture: true,
  rollbackFixture: { rollbackExactlyOnce: true, cleanupExactTargetsOnly: true },
  forbiddenActionsAbsent: true,
  catalogUnchanged: true,
  shopOrProductAction: false,
  productionMutation: false,
  downloadHosted: false,
  productionSigned: false,
  storeReleased: false,
  installedLocal: false,
  publicParity: false
}, null, 2));
