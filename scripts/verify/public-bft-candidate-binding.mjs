#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`public BFT candidate binding rejected: ${message}`);
}

function readJSON(file, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value;
}

function requireRestrictedFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || fs.realpathSync(file) !== path.resolve(file)) fail(`${label} is not an original regular file`);
  if ((stat.mode & 0o077) !== 0) fail(`${label} permissions must be 0600 or stricter`);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonicalSecond(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value || "")) fail(`${label} must be whole-second UTC RFC3339`);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(`${label} is invalid`);
  return timestamp;
}

const rawArgs = process.argv.slice(2);
const operatorVersion = "YNX-PRODUCTION-OPERATOR/v1";
const roles = ["primary", "singapore", "silicon-valley", "seoul"];
const hash = (value) => /^[0-9a-f]{64}$/.test(value || "") && value !== "0".repeat(64);
const gatewayMode = "single-app-gateway";
const gatewayContinuityVersion = "YNX-SINGLE-APP-GATEWAY-CONTINUITY/v1";
function gatewayBinding(file) {
  requireRestrictedFile(file, "candidate binding");
  const b = readJSON(file, "candidate binding");
  if (b.schemaVersion !== 2 || b.operatorProfile !== operatorVersion || !hash(b.operatorPlanSha256) || !hash(b.runtimeManifestSha256) || !/^[0-9a-f]{40}$/.test(b.runtimeCommit || "") || b.runtimeCommit.slice(0, 12) !== b.commit || b.bftRelease !== `ynx-bft-gateway-${b.commit}` || !Number.isSafeInteger(b.finalSnapshotHeight) || b.finalSnapshotHeight < 1) fail("gateway binding is invalid");
  return b;
}
function gatewayIdentity(v, b) {
  return v.mode === gatewayMode && v.transactionId === b.transactionId && v.commit === b.commit && v.bftRelease === b.bftRelease && v.operatorPlanSHA256 === b.operatorPlanSha256 && v.runtimeCommit === b.runtimeCommit && v.runtimeSOURCEsha256 === b.runtimeManifestSha256 && v.migrationHeight === b.finalSnapshotHeight && v.migrationBlockHash === b.finalSnapshotBlockHash.replace(/^0x/, "").toLowerCase();
}
function gatewayReceipt(v, b, operation, dry, pins) {
  if (!gatewayIdentity(v, b) || (v.dryRun !== undefined && typeof v.dryRun !== "boolean") || Boolean(v.dryRun) !== dry || v.gatewaySHA256 !== pins[0] || v.packageVerifierSHA256 !== pins[1] || v.backupSHA256 !== pins[2] || pins.slice(0,2).some(p => !hash(p)) || (dry ? pins[2] !== "unobserved-dry-run" : !hash(pins[2]))) fail("gateway receipt source/pins/migration mismatch");
  if (operation === "start") {
    if (v.dependenciesActive !== !dry || v.parallelCandidateOnly !== true || v.publicIngressChanged !== false || v.pqActivationVerified !== false) fail("gateway start receipt is not an isolated normal process result");
    if (!dry && (v.version !== "YNX-SINGLE-APP-GATEWAY-START/v1" || v.runningExecutableSHA256 !== pins[0] || !/^[1-9][0-9]*$/.test(v.mainPid || "") || !/^[0-9]+:[0-9]+$/.test(v.runningExecutableDeviceInode || "") || [v.unitSHA256,v.launcherSHA256,v.environmentSHA256].some(p=>!hash(p)))) fail("gateway start lacks exact running executable/unit qualification");
  } else if (operation === "rollback") {
    if (v.gatewayStopped !== !dry || v.rolledBack !== !dry || v.originalMaterialRetained !== true || (!dry && v.version !== "YNX-SINGLE-APP-GATEWAY-ROLLBACK/v1")) fail("gateway rollback receipt does not preserve originals");
  } else fail("unsupported gateway receipt operation");
}
if (rawArgs[0] === "--gateway-receipt") {
  if (rawArgs.length !== 8 || !["0", "1"].includes(rawArgs[4])) fail("exact gateway receipt arguments required");
  const b = gatewayBinding(rawArgs[1]); requireRestrictedFile(rawArgs[2], "gateway receipt");
  gatewayReceipt(readJSON(rawArgs[2], "gateway receipt"), b, rawArgs[3], rawArgs[4] === "1", rawArgs.slice(5));
  process.exit(0);
}
if (rawArgs[0] === "--gateway-observe") {
  if (rawArgs.length !== 6 && !(rawArgs.length === 7 && rawArgs[6] === "public")) fail("exact gateway observation arguments required");
  const publicReady=rawArgs.length === 7;
  const b = gatewayBinding(rawArgs[1]), start = readJSON(rawArgs[2], "gateway start");
  gatewayReceipt(start, b, "start", false, [start.gatewaySHA256, start.packageVerifierSHA256, start.backupSHA256]);
  const before = readJSON(rawArgs[3], "gateway before"), after = readJSON(rawArgs[4], "gateway after"), status = readJSON(rawArgs[5], "gateway status");
  for (const v of [before, after]) {
    if (v.ok !== true || v.service !== "ynx-bft-gatewayd" || v.mode !== "cometbft-backed" || v.truthfulStatus !== "cometbft-rpc-and-abci-backed" || v.chainId !== 6423 || v.nativeSymbol !== "YNXT" || v.cometChainId !== "ynx_6423-1" || v.validatorCount !== 4 || v.publicCutoverReady !== publicReady || v.build?.commit !== b.commit || v.build?.release !== b.bftRelease || v.migrationHeight !== b.finalSnapshotHeight || v.migrationBlockHash !== start.migrationBlockHash || !Number.isSafeInteger(v.height) || v.height <= b.finalSnapshotHeight) fail("gateway health source/chain/build/retained history mismatch");
  }
  if (after.height <= before.height || status.chainId !== 6423 || status.nativeCurrencySymbol !== "YNXT" || status.consensusEngine !== "cometbft" || status.cometChainId !== "ynx_6423-1" || status.truthfulStatus !== "cometbft-rpc-and-abci-backed" || status.validatorCount !== 4 || status.publicCutoverReady !== publicReady || status.migrationHeight !== b.finalSnapshotHeight || status.migrationBlockHash !== start.migrationBlockHash || status.earliestBlockHeight !== b.finalSnapshotHeight + 1 || !Number.isSafeInteger(status.height) || status.height < after.height) fail("gateway did not advance or changed its original history boundary");
  process.stdout.write(`${JSON.stringify({version:gatewayContinuityVersion, mode:gatewayMode, transactionId:b.transactionId, commit:b.commit, bftRelease:b.bftRelease, operatorPlanSHA256:b.operatorPlanSha256, runtimeCommit:b.runtimeCommit, runtimeSOURCEsha256:b.runtimeManifestSha256, bindingSHA256:sha256(rawArgs[1]), migrationHeight:b.finalSnapshotHeight, migrationBlockHash:start.migrationBlockHash, source:"configured-comet-rpc", chainId:6423, cometChainId:"ynx_6423-1", heightBefore:before.height, heightAfter:after.height, observedHeight:status.height, gatewaySHA256:start.gatewaySHA256, verified:true, dryRun:false, parallelCandidateOnly:true, publicCutoverReady:publicReady, publicIngressChanged:publicReady, independentFinalityVerified:false, ecosystemContinuityVerified:false})}\n`);
  process.exit(0);
}
if (rawArgs[0] === "--continuity-check") {
  if (rawArgs.length !== 4 || !["0", "1"].includes(rawArgs[3])) fail("exact continuity arguments required");
  const b=gatewayBinding(rawArgs[1]), v=readJSON(rawArgs[2], "gateway continuity"), dry=rawArgs[3] === "1";
  if (!gatewayIdentity(v,b) || v.version !== gatewayContinuityVersion || v.bindingSHA256 !== sha256(rawArgs[1]) || v.verified !== !dry || v.dryRun !== dry || v.parallelCandidateOnly !== true || v.publicIngressChanged !== false || v.independentFinalityVerified !== false || v.ecosystemContinuityVerified !== false) fail("gateway continuity is not bound to this original operator/runtime transaction");
  if (!dry && (v.source !== "configured-comet-rpc" || v.chainId !== 6423 || v.cometChainId !== "ynx_6423-1" || !Number.isSafeInteger(v.heightBefore) || !Number.isSafeInteger(v.heightAfter) || v.heightBefore <= b.finalSnapshotHeight || v.heightAfter <= v.heightBefore || !Number.isSafeInteger(v.observedHeight) || v.observedHeight < v.heightAfter || !hash(v.gatewaySHA256))) fail("gateway continuity lacks real advancing configured-RPC evidence");
  process.exit(0);
}
if (rawArgs[0] === "--ingress-check") {
  if (rawArgs.length !== 6 || !["switch", "rollback"].includes(rawArgs[3]) || !["0", "1"].includes(rawArgs[4]) || !hash(rawArgs[5])) fail("exact ingress receipt arguments required");
  const b=gatewayBinding(rawArgs[1]),v=readJSON(rawArgs[2],"RPC ingress"),dry=rawArgs[4] === "1", forward=rawArgs[3] === "switch";
  if (v.version !== "YNX-SINGLE-APP-GATEWAY-INGRESS/v1" || v.mode !== gatewayMode || v.transactionId !== b.transactionId || v.commit !== b.commit || v.bftRelease !== b.bftRelease || v.operatorPlanSHA256 !== b.operatorPlanSha256 || v.runtimeCommit !== b.runtimeCommit || v.runtimeSOURCEsha256 !== b.runtimeManifestSha256 || v.rpcOnly !== true || v.ecosystemContinuityVerified !== false || Boolean(v.dryRun) !== dry || v.ingress !== (forward?"bft":"authoritative") || v.publicIngressChanged !== (forward && !dry) || (!dry && v.sourceTestOnly === true)) fail("RPC-only ingress receipt identity/pin/result mismatch");
  if (v.gatewaySHA256 !== rawArgs[5] || v.publicCutoverReady !== (forward && !dry) || (!dry && (!hash(v.authoritativeChecksumsSha256) || !hash(v.candidateChecksumsSha256)))) fail("RPC ingress lacks original runtime/config byte identities");
  process.exit(0);
}
if (rawArgs[0] === "--public-result-check") {
  if (rawArgs.length !== 4 || !["0","1"].includes(rawArgs[3])) fail("exact public result arguments required");
  const b=gatewayBinding(rawArgs[1]),v=readJSON(rawArgs[2],"public result"),dry=rawArgs[3]==="1";
  if (!gatewayIdentity(v,b) || v.version!=="YNX-SINGLE-APP-GATEWAY-PUBLIC/v1" || v.bindingSHA256!==sha256(rawArgs[1]) || v.verified!==!dry || v.dryRun!==dry || v.publicIngressChanged!==!dry || v.RPCOnly!==true || v.ecosystemContinuityVerified!==false || v.independentFinalityVerified!==false) fail("public result is not an original qualified RPC-only observation");
  if(!dry && (v.source!=="configured-comet-rpc" || !/^0x[0-9a-f]{40}$/.test(v.accountIdentityRead||"") || v.historyBlockHeight!==b.finalSnapshotHeight+1 || !hash(String(v.historyBlockHash||"").replace(/^0x/,"").toLowerCase()))) fail("public result lacks account/history readback");
  process.exit(0);
}
if (rawArgs[0] === "--public-read-targets") {
  if (rawArgs.length !== 4) fail("exact public read target arguments required");
  const b=gatewayBinding(rawArgs[1]),m=readJSON(rawArgs[2],"original migration"),s=readJSON(rawArgs[3],"gateway status");
  if (sha256(rawArgs[2]) !== b.finalSnapshotSha256 || m.height !== b.finalSnapshotHeight || m.stateHash !== b.finalSnapshotStateHash || !Array.isArray(m.accounts) || s.earliestBlockHeight !== b.finalSnapshotHeight+1 || !hash(String(s.earliestBlockHash||"").replace(/^0x/,""))) fail("original account/history read boundary mismatch");
  const account=m.accounts.find(a=>typeof a.address === "string" && /^0x[0-9a-f]{40}$/.test(a.address));
  if (!account) fail("original migration contains no canonical account for readback");
  process.stdout.write(`${account.address} ${s.earliestBlockHeight}\n`);process.exit(0);
}
if (rawArgs[0] === "--public-readback") {
  if (rawArgs.length !== 3) fail("exact public readback arguments required");
  const b=gatewayBinding(rawArgs[1]),root=rawArgs[2],o=readJSON(path.join(root,"observation.json"),"public observation"),s=readJSON(path.join(root,"gateway-status.json"),"public status"),a=readJSON(path.join(root,"account.json"),"public account"),block=readJSON(path.join(root,"block.json"),"public block"),evm=readJSON(path.join(root,"evm-chain-id.json"),"public EVM chain");
  const targets=fs.readFileSync(path.join(root,"read-targets.txt"),"utf8").trim().split(" ");
  if (readJSON(path.join(root,"mutation-freeze.json"),"shared mutation freeze").httpStatus !== 503) fail("shared mutation freeze was removed before the qualified public readback");
  if (!gatewayIdentity(o,b) || o.verified !== true || o.dryRun !== false || o.publicCutoverReady !== true || o.publicIngressChanged !== true || o.source !== "configured-comet-rpc" || o.bindingSHA256 !== sha256(rawArgs[1]) || o.ecosystemContinuityVerified !== false || o.independentFinalityVerified !== false || targets.length !== 2 || a.address !== targets[0] || block.height !== Number(targets[1]) || block.height !== b.finalSnapshotHeight+1 || !hash(String(block.hash).replace(/^0x/,"").toLowerCase()) || String(block.hash).replace(/^0x/,"").toLowerCase() !== String(s.earliestBlockHash).replace(/^0x/,"").toLowerCase() || evm.jsonrpc !== "2.0" || evm.id !== 1 || evm.error !== undefined || evm.result !== "0x1917") fail("public account/history/EVM readback does not match the original observed source");
  process.stdout.write(`${JSON.stringify({...o,version:"YNX-SINGLE-APP-GATEWAY-PUBLIC/v1",RPCOnly:true,publicIngressChanged:true,accountIdentityRead:a.address,historyBlockHeight:block.height,historyBlockHash:block.hash,accountBalanceVerified:false,allNativeHistoryVerified:false})}\n`);process.exit(0);
}
function pinnedOperator(file, pin) {
  if (!path.isAbsolute(file || "") || !hash(pin)) fail("absolute operator plan and independent nonzero SHA256 are required");
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > 96 * 1024 * 1024 || fs.realpathSync(file) !== file || (stat.mode & 0o022) !== 0) fail("operator plan must be an original bounded, non-writable-by-others public file");
  const raw = fs.readFileSync(file);
  if (crypto.createHash("sha256").update(raw).digest("hex") !== pin) fail("operator plan differs from independent SHA256 pin");
  let plan;
  try { plan = JSON.parse(raw.toString("utf8")); } catch { fail("operator plan is not JSON"); }
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) fail("operator plan must be an object");
  if (plan.version !== operatorVersion || plan.chainId !== "ynx_6423-1" || !Array.isArray(plan.roles) || plan.roles.length !== 4 || new Set(plan.roles.map((r) => r.role)).size !== 4 || plan.roles.some((r) => !roles.includes(r.role))) fail("operator plan identity or roles are invalid");
  return plan;
}
function safeOperatorPath(value) {
  if (typeof value !== "string" || value.length > 4096 || value === "/" || !/^\/[A-Za-z0-9_./-]+$/.test(value) || path.posix.normalize(value) !== value) fail("unsafe operator custody path");
  return `'${value}'`;
}
function freshDestination(plan, name) {
  if (plan.pqSchedule || plan.runtimePlan) fail("fresh native import cannot replace an existing registry/runtime checkpoint");
  const role = plan.roles.find((r) => r.role === name);
  if (!role) fail("initialization role is missing");
  safeOperatorPath(role.abciState);
  const directory = path.posix.dirname(role.abciState), parent = path.posix.dirname(directory);
  const d = safeOperatorPath(directory), p = safeOperatorPath(parent);
  return `sudo test ! -e ${d}; sudo test ! -L ${d}; sudo test -d ${p}; sudo test ! -L ${p}; test "$(sudo realpath -e ${p})" = ${p};`;
}
function operatorRoleCommand(plan, name, fresh = false) {
  const role = plan.roles.find((r) => r.role === name);
  if (!role) fail("operator role is missing");
  const safePath = safeOperatorPath;
  const remote = typeof plan.pqSchedule === "string" && plan.pqSchedule.length > 0;
  if (remote && (!role.hostBinding || !role.remoteSigner || !hash(role.signerPeerPublicKey))) fail("remote operator custody is incomplete");
  const files = [role.nodeKeyPath, ...(!fresh ? [role.abciState] : []), ...(remote ? [role.transportKeyPath] : [role.legacyKeyPath, role.legacyStatePath])];
  const commands = files.map((file) => {
    const q = safePath(file);
    return `sudo test -s ${q}; sudo test -f ${q}; sudo test ! -L ${q}; test "$(sudo realpath -e ${q})" = ${q}; test "$(sudo stat -c %a ${q})" = 600;`;
  });
  const home = safePath(role.home);
  commands.push(`sudo test -d ${home}; sudo test ! -L ${home}; test "$(sudo realpath -e ${home})" = ${home};`);
  if (fresh) commands.push(freshDestination(plan, name));
  if (!fresh && (plan.stateLayout === "snapshot-journal" || plan.stateLayout === "block-journal")) {
    const lock = safePath(`${role.abciState}.read.lock`);
    commands.push(`sudo test -f ${lock}; sudo test ! -L ${lock}; test "$(sudo stat -c %a ${lock})" = 600;`);
  } else if (!["atomic-json", "snapshot-journal", "block-journal"].includes(plan.stateLayout)) fail("unsupported operator state layout");
  if (!hash(plan.consensusGenesisSHA256)) fail("missing original consensus genesis pin");
  commands.push(`printf '%s  %s\\n' '${plan.consensusGenesisSHA256}' ${safePath(`${role.home}/config/genesis.json`)} | sudo sha256sum --strict -c - >/dev/null;`);
  return commands.join("\n");
}
if (rawArgs[0] === "--operator-preflight") {
  if (rawArgs.length !== 4 && !(rawArgs.length === 5 && rawArgs[4] === "fresh")) fail("operator preflight requires plan, external pin, role and optional explicit fresh mode");
  process.stdout.write(`${operatorRoleCommand(pinnedOperator(rawArgs[1], rawArgs[2]), rawArgs[3], rawArgs[4] === "fresh")}\n`);
  process.exit(0);
}
if (rawArgs[0] === "--initialization-command" || rawArgs[0] === "--initialization-destination") {
  if (rawArgs.length !== 5) fail("initialization requires plan, external pin, role and exclusive staged root");
  const [, , , name, stage] = rawArgs, plan = pinnedOperator(rawArgs[1], rawArgs[2]);
  const guard = freshDestination(plan, name), role = plan.roles.find((r) => r.role === name);
  if (rawArgs[0] === "--initialization-destination") { process.stdout.write(`${guard}\n`); process.exit(0); }
  if (!["atomic-json", "snapshot-journal", "block-journal"].includes(plan.stateLayout) || ![plan.consensusGenesisSHA256, plan.originalGenesisHash, plan.migrationStateHash].every(hash)) fail("independent initialization layout/genesis/migration pins are incomplete");
  safeOperatorPath(stage);
  const args = ["--consensus-genesis", `${stage}/genesis.json`, "--migration-state", `${stage}/bound-migration.json`, "--abci-state", role.abciState, "--abci-state-layout", plan.stateLayout, "--consensus-genesis-sha256", plan.consensusGenesisSHA256, "--original-genesis-hash", plan.originalGenesisHash, "--bound-migration-state-hash", plan.migrationStateHash];
  process.stdout.write(`${guard}\nsudo -u ynx env -i PATH=/usr/bin:/bin '${stage}/ynx-comet' initialize-application ${args.map((v) => `'${v}'`).join(" ")}\n`);
  process.exit(0);
}
if (rawArgs[0] === "--initialization-result") {
  if (rawArgs.length !== 7) fail("initialization result requires transaction, binding, plan/pin, role and original receipt");
  const [, tx, bindingPath, planPath, pin, name, resultPath] = rawArgs, plan = pinnedOperator(planPath, pin);
  freshDestination(plan, name);
  requireRestrictedFile(bindingPath, "candidate binding"); requireRestrictedFile(resultPath, "initialization receipt");
  const binding = readJSON(bindingPath, "binding"), result = readJSON(resultPath, "initialization receipt"), role = plan.roles.find((r) => r.role === name);
  if (binding.schemaVersion !== 2 || binding.transactionId !== path.basename(path.resolve(tx)) || binding.operatorPlanSha256 !== pin || result.version !== "YNX-APPLICATION-INITIALIZATION/v1" || result.statePath !== role.abciState || result.stateLayout !== plan.stateLayout || result.migrationStateHash !== plan.migrationStateHash || result.appHash !== plan.migrationStateHash || result.height !== String(binding.finalSnapshotHeight) || !hash(result.stateSHA256) || result.coldReadVerified !== true || result.initialized !== false || result.deployed !== false || result.pqActivated !== false) fail("normal initializer receipt differs from independent original input; retain UNKNOWN");
  process.stdout.write(`${JSON.stringify({ role:name, receiptSHA256:sha256(resultPath), coldReadVerified:true, consensusInitialized:false })}\n`);
  process.exit(0);
}
if (rawArgs[0] === "--activation-evidence") {
  if (rawArgs.length !== 5) fail("activation evidence requires transaction, binding, role and retained readback directory");
  const [, tx, bindingPath, role, directory] = rawArgs;
  if (!roles.includes(role)) fail("activation role is invalid");
  requireRestrictedFile(bindingPath, "candidate binding");
  const binding = readJSON(bindingPath, "candidate binding");
  if (binding.schemaVersion !== 2 || binding.transactionId !== path.basename(path.resolve(tx)) || binding.operatorProfile !== operatorVersion || !hash(binding.operatorPlanSha256)) fail("activation binding identity/version mismatch");
  const identity = (v, withRole = true) => v.transactionId === binding.transactionId && v.commit === binding.commit && v.authoritativeRelease === binding.authoritativeRelease && v.bftRelease === binding.bftRelease && (!withRole || v.role === role);
  function evidence(name) {
    const file = path.join(directory, name);
    requireRestrictedFile(file, name);
    return [readJSON(file, name), sha256(file)];
  }
  const [backup, backupJSONHash] = evidence("backup.json");
  const [freeze, freezeJSONHash] = evidence("freeze.json");
  const [marker, markerHash] = evidence("marker.json");
  // Original scoped-backup/freeze records are unversioned. Do not silently
  // reinterpret a different version or accept text-log substring matches.
  if ([backup, freeze, marker].some((v) => "version" in v || "schemaVersion" in v)) fail("unsupported original activation evidence version");
  if (!identity(backup) || backup.validated !== true || !hash(backup.sha256)) fail("backup evidence identity/hash mismatch");
  if (!identity(freeze) || freeze.operation !== "freeze" || freeze.mutationStateVerified !== true || freeze.readStatus !== 200 || freeze.readEvm !== 200 || freeze.markerPath !== "/var/lib/ynx-chain/mutation-freeze.json" || freeze.markerSha256 !== markerHash || !identity(marker)) fail("freeze evidence identity/hash mismatch");
  canonicalSecond(marker.frozenAt, "original frozenAt");
  const result = { backupSHA256: backup.sha256, backupJSONHash, freezeJSONHash, markerHash };
  if (role === "primary") {
    const [pause, pauseJSONHash] = evidence("pause.json");
    const [pauseMarker, pauseMarkerHash] = evidence("pause-marker.json");
    if ([pause, pauseMarker].some((v) => "version" in v || "schemaVersion" in v) || !identity(pause, false) || !identity(pauseMarker, false) || pause.operation !== "pause" || pause.productionStateVerified !== true || pause.readsOnline !== true || pause.pauseMarker !== "/var/lib/ynx-chain/block-production-pause.json" || pause.markerSha256 !== pauseMarkerHash || pause.heightBefore !== binding.finalSnapshotHeight || pause.heightAfter !== binding.finalSnapshotHeight) fail("original producer pause does not bind the final snapshot");
    canonicalSecond(pauseMarker.pausedAt, "original pausedAt");
    Object.assign(result, { pauseJSONHash, pauseMarkerHash });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(0);
}
const inputsOnly = rawArgs[0] === "--inputs-only";
if (inputsOnly) rawArgs.shift();
const [transactionDirValue, expectedCommit, expectedRelease, validatorManifestValue, genesisTime, operatorPlanPath, operatorPlanSha256, runtimeCommit, runtimeManifestSha256, packageRootValue] = rawArgs;
if (rawArgs.length !== (inputsOnly ? 9 : 10) || rawArgs.some((value) => !value)) {
  fail("exact transaction, commit, release, validator, genesis, operator plan/hash, runtime commit/manifest pin and package arguments are required");
}
if (!/^[0-9a-f]{12}$/.test(expectedCommit)) fail("expected commit is invalid");
if (expectedRelease !== `ynx-bft-gateway-${expectedCommit}`) fail("expected release is not commit-bound");
if (!/^[0-9a-f]{40}$/.test(runtimeCommit) || !runtimeCommit.startsWith(expectedCommit) || !hash(runtimeManifestSha256)) fail("independent full runtime commit/SOURCE pin mismatch");
const operatorPlan = pinnedOperator(operatorPlanPath, operatorPlanSha256);

const transactionDir = path.resolve(transactionDirValue);
const transactionId = path.basename(transactionDir);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(transactionId)) fail("transaction id is invalid");
const approvalPath = path.join(transactionDir, "approval.json");
const snapshotPath = path.join(transactionDir, "final-snapshot", "migration.json");
const snapshotEvidencePath = path.join(transactionDir, "final-snapshot", "remote-evidence.json");
const validatorManifestPath = path.resolve(validatorManifestValue);
const packageRoot = inputsOnly ? "" : path.resolve(packageRootValue);
const packageManifestPath = inputsOnly ? "" : path.join(packageRoot, "package-manifest.json");

for (const [file, label] of [[approvalPath, "transaction approval"], [snapshotPath, "final snapshot"], [snapshotEvidencePath, "final snapshot evidence"]]) {
  requireRestrictedFile(file, label);
}
const validatorStat = fs.statSync(validatorManifestPath);
if (!validatorStat.isFile()) fail("validator manifest is not a regular file");
if ((validatorStat.mode & 0o022) !== 0) fail("validator manifest must not be group/world writable");
if (!inputsOnly) {
  if (!fs.statSync(packageRoot).isDirectory()) fail("candidate package root is not a directory");
  if (!fs.statSync(packageManifestPath).isFile()) fail("candidate package manifest is missing");
}

const approval = readJSON(approvalPath, "transaction approval");
if (approval.schemaVersion !== 1 || approval.action !== "ynx-public-bft-cutover" || approval.approved !== true || approval.commit !== expectedCommit || approval.release !== expectedRelease) fail("transaction approval identity mismatch");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(approval.approvalId || "") || typeof approval.approver !== "string" || approval.approver.trim().length < 3) fail("transaction approval attribution is invalid");
if (typeof approval.custodyReviewer !== "string" || approval.custodyReviewer.trim().length < 3 || approval.custodyReviewer.trim().toLowerCase() === approval.approver.trim().toLowerCase()) fail("transaction approval independent custody attribution is invalid");
if (typeof approval.custodyEvidence !== "string" || !/^sha256:[0-9a-f]{64}$/.test(approval.custodyEvidence.trim())) fail("transaction approval custody review hash is invalid");
const approvalParticipants = [approval.approver, approval.custodyReviewer, approval.owner, approval.ownerHandoverReviewer].map((value) => String(value || "").trim().toLowerCase());
if (approvalParticipants.some((value) => value.length < 3) || new Set(approvalParticipants).size !== approvalParticipants.length) fail("transaction approval owner/custody role separation is invalid");
if (!/^sha256:[0-9a-f]{64}$/.test(approval.ownerHandoverInventoryDigest || "") || !/^sha256:[0-9a-f]{64}$/.test(approval.ownerHandoverInventoryEvidence || "") || !/^sha256:[0-9a-f]{64}$/.test(approval.ownerHandoverReceiptEvidence || "")) fail("transaction approval owner handover evidence is invalid");
if (approval.publicCutoverAuthorized !== true || approval.automaticRollbackRequired !== true) fail("transaction approval does not authorize cutover with automatic rollback");
if (approval.validatorKeyRecoveryVerified !== true || approval.serviceSignerRecoveryVerified !== true || approval.ownerHandoverVerified !== true || approval.rotationProcedureVerified !== true) fail("transaction approval custody recovery is incomplete");
if (!/^[0-9a-f]{64}$/.test(approval.serviceSignerManifestSha256 || "")) fail("transaction approval service signer manifest checksum is invalid");
if (approval.candidateGenesisTime !== genesisTime) fail("candidate genesis time differs from approval");
const validatorManifestSha256 = sha256(validatorManifestPath);
if (approval.validatorManifestSha256 !== validatorManifestSha256) fail("validator manifest checksum differs from approval");
if (approval.operatorPlanSha256 !== operatorPlanSha256 || approval.runtimeManifestSha256 !== runtimeManifestSha256) fail("operator/runtime independent pins differ from transaction approval");

const snapshot = readJSON(snapshotPath, "final snapshot");
const snapshotEvidence = readJSON(snapshotEvidencePath, "final snapshot evidence");
const finalSnapshotSha256 = sha256(snapshotPath);
if (snapshotEvidence.transactionId !== transactionId || snapshotEvidence.commit !== expectedCommit || snapshotEvidence.bftRelease !== expectedRelease) fail("final snapshot evidence identity mismatch");
if (snapshotEvidence.authoritativeRelease !== `ynx-chain-${expectedCommit}`) fail("final snapshot authoritative release mismatch");
if (snapshotEvidence.validated !== true || snapshotEvidence.pauseVerified !== true || snapshotEvidence.mutationFreezeVerified !== true) fail("final snapshot evidence is not fully validated");
if (snapshotEvidence.sha256 !== finalSnapshotSha256) fail("final snapshot checksum mismatch");
if (!Number.isSafeInteger(snapshot.height) || snapshot.height < 1 || snapshotEvidence.height !== snapshot.height) fail("final snapshot height mismatch");
if (!/^(0x)?[0-9a-fA-F]{64}$/.test(snapshot.lastBlockHash || "") || snapshotEvidence.lastBlockHash !== snapshot.lastBlockHash) fail("final snapshot block hash mismatch");
if (!/^[0-9a-f]{64}$/.test(snapshot.stateHash || "") || snapshotEvidence.stateHash !== snapshot.stateHash) fail("final snapshot state hash mismatch");

const recordedAt = canonicalSecond(snapshotEvidence.recordedAt, "final snapshot recordedAt");
const genesisAt = canonicalSecond(genesisTime, "candidate genesis time");
const expiresAt = canonicalSecond(approval.expiresAt, "approval expiresAt");
if (expiresAt <= Date.now()) fail("transaction approval has expired");
if (genesisAt < recordedAt || genesisAt > recordedAt + 30 * 60 * 1000) fail("candidate genesis time must be within 30 minutes after the final snapshot");
if (genesisAt > expiresAt) fail("candidate genesis time exceeds approval expiry");

const validatorManifest = readJSON(validatorManifestPath, "validator manifest");
const sensitiveKey = /^(private[-_]?key|secret|mnemonic|seed|password|priv[-_]?validator[-_]?key)$/i;
function rejectSensitive(value, trail = "validator manifest") {
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectSensitive(entry, `${trail}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) fail(`${trail} contains forbidden private material field ${key}`);
    rejectSensitive(child, `${trail}.${key}`);
  }
}
rejectSensitive(validatorManifest);
rejectSensitive(operatorPlan, "public operator plan");

if (inputsOnly) {
  process.stdout.write(`${JSON.stringify({ transactionId, commit: expectedCommit, release: expectedRelease, finalSnapshotSha256, validatorManifestSha256, candidateGenesisTime: genesisTime, operatorPlanSha256, runtimeCommit, runtimeManifestSha256, validated: true })}\n`);
  process.exit(0);
}

const packageManifest = readJSON(packageManifestPath, "candidate package manifest");
if (packageManifest.operatorProfile !== operatorVersion || packageManifest.operatorPlanHash !== operatorPlanSha256) fail("normal public cutover requires the independently pinned single-App operator package; legacy external ABCI is refused");
if (packageManifest.genesisTime !== genesisTime) fail("candidate package genesis time mismatch");
if (packageManifest.chainId !== "ynx_6423-1") fail("candidate package chain ID mismatch");
if (!Array.isArray(packageManifest.roles) || packageManifest.roles.length !== 4) fail("candidate package must contain four roles");
if (!/^[0-9a-f]{64}$/.test(packageManifest.genesisHash || "") || !/^[0-9a-f]{64}$/.test(packageManifest.migrationStateHash || "")) fail("candidate package hash identity is invalid");
if (packageManifest.genesisHash !== operatorPlan.consensusGenesisSHA256 || packageManifest.migrationStateHash !== operatorPlan.migrationStateHash) fail("candidate package differs from independent genesis/bound migration pins");

process.stdout.write(`${JSON.stringify({
  schemaVersion: 2,
  transactionId,
  commit: expectedCommit,
  authoritativeRelease: `ynx-chain-${expectedCommit}`,
  bftRelease: expectedRelease,
  finalSnapshotSha256,
  finalSnapshotHeight: snapshot.height,
  finalSnapshotBlockHash: snapshot.lastBlockHash,
  finalSnapshotStateHash: snapshot.stateHash,
  validatorManifestSha256,
  candidateGenesisTime: genesisTime,
  operatorProfile: operatorVersion,
  operatorPlanSha256,
  runtimeCommit,
  runtimeManifestSha256,
  packageManifestSha256: sha256(packageManifestPath),
  packageGenesisHash: packageManifest.genesisHash,
  packageMigrationStateHash: packageManifest.migrationStateHash,
  automaticRollbackRequired: true,
  serviceSignerManifestSha256: approval.serviceSignerManifestSha256,
  validated: true,
}, null, 2)}\n`);
