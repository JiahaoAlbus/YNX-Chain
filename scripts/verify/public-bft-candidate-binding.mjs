#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isSingleAppCustody, singleAppCustodyProfile } from "./lib/owner-handover.mjs";
import { caddySourceIdentity, authoritativeIdentity, authoritativeRoleIdentities, roleAuthoritativeIdentity } from "./lib/public-bft-native-source.mjs";

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
const hash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value) && value !== "0".repeat(64);
const gatewayMode = "single-app-gateway";
const gatewayContinuityVersion = "YNX-SINGLE-APP-GATEWAY-CONTINUITY/v1";
function gatewayBinding(file) {
  requireRestrictedFile(file, "candidate binding");
  const b = readJSON(file, "candidate binding");
  isSingleAppCustody(b);
  caddySourceIdentity(b);
  if (b.schemaVersion !== 2 || b.operatorProfile !== operatorVersion || !hash(b.operatorPlanSha256) || !hash(b.runtimeManifestSha256) || ![b.packageGenesisHash,b.packageMigrationStateHash,b.originalGenesisHash].every(hash) || !/^[0-9a-f]{40}$/.test(b.runtimeCommit || "") || b.runtimeCommit.slice(0, 12) !== b.commit || b.bftRelease !== `ynx-bft-gateway-${b.commit}` || !Number.isSafeInteger(b.finalSnapshotHeight) || b.finalSnapshotHeight < 1 || b.finalSnapshotHeight >= Number.MAX_SAFE_INTEGER) fail("gateway binding is invalid");
  return b;
}

// Only this small, independently pinned metadata object leaves the server.
// Complete Caddy configuration bodies stay in the original owner's custody;
// the remote helper verifies their bytes and the two approved projections.
function caddyManifest(file, b, gatewaySHA256) {
  const identity = caddySourceIdentity(b).caddySource;
  if (!identity) fail("JSON ingress requires an independently approved Caddy source");
  requireRestrictedFile(file, "Caddy source manifest");
  const before = fs.lstatSync(file, {bigint:true});
  if (before.nlink !== 1n || before.size < 1n || before.size > 65536n) fail("Caddy source manifest size/link bound");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let raw;
  try {
    const opened = fs.fstatSync(fd, {bigint:true});
    if (opened.dev !== before.dev || opened.ino !== before.ino) fail("Caddy source manifest replaced before open");
    const buffer = Buffer.alloc(65537); let size = 0, count;
    while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length-size, null)) > 0) size += count;
    const after = fs.fstatSync(fd, {bigint:true}), current = fs.lstatSync(file, {bigint:true});
    for (const field of ["dev","ino","size","mode","uid","gid","nlink","mtimeNs","ctimeNs"]) if (opened[field] !== before[field] || after[field] !== before[field] || current[field] !== before[field]) fail("Caddy source manifest changed during read");
    if (BigInt(size) !== before.size) fail("Caddy source manifest read exceeds bound");
    raw = buffer.subarray(0,size);
  } finally { fs.closeSync(fd); }
  if (crypto.createHash("sha256").update(raw).digest("hex") !== identity.manifestSha256) fail("Caddy source manifest differs from independent approval");
  let m;
  try {
    const text=raw.toString("utf8");
    if (!Buffer.from(text,"utf8").equals(raw)) throw new Error();
    m=JSON.parse(text);
    let at=0;
    const space=()=>{while (/\s/.test(text[at]||"")) at++;};
    const string=()=>{const start=at++;while(text[at]!== '"'){if(text[at]==="\\") at++;at++;}at++;return JSON.parse(text.slice(start,at));};
    const value=depth=>{if(depth>32)throw new Error();space();if(text[at]==="{"){at++;space();const keys=new Set();if(text[at]!=="}")for(;;){space();const key=string();if(keys.has(key))throw new Error();keys.add(key);space();at++;value(depth+1);space();if(text[at]!==",")break;at++;}at++;}else if(text[at]==="["){at++;space();if(text[at]!=="]")for(;;){value(depth+1);space();if(text[at]!==",")break;at++;}at++;}else if(text[at]==='"')string();else{while(at<text.length&&!/[\s,}\]]/.test(text[at]))at++;}};
    value(0);space();if(at!==text.length)throw new Error();
  } catch { fail("Caddy source manifest must be bounded strict JSON"); }
  const closed=(v,keys)=>{if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).sort().join()!==[...keys].sort().join())fail("closed Caddy source metadata fields differ");};
  const decimal=(v,positive=false)=>typeof v==="string"&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=20&&BigInt(v)<=18446744073709551615n&&(!positive||v!=="0");
  const safePath=v=>typeof v==="string"&&v.length<=4096&&/^\/[A-Za-z0-9._/-]+$/.test(v)&&!v.includes("//")&&!v.endsWith("/")&&!v.split("/").some(p=>p==="."||p==="..");
  closed(m,["version","transactionId","commit","operatorPlanSHA256","runtimeCommit","runtimeSOURCEsha256","gatewaySHA256","source","secondRead","originalProcess","originalUnit","baseline","rpcUpstreams"]);
  if(m.version!=="YNX-CADDY-JSON-INGRESS-SOURCE/v1"||m.transactionId!==b.transactionId||m.commit!==b.commit||m.operatorPlanSHA256!==b.operatorPlanSha256||m.runtimeCommit!==b.runtimeCommit||m.runtimeSOURCEsha256!==b.runtimeManifestSha256||!hash(gatewaySHA256)||m.gatewaySHA256!==gatewaySHA256)fail("Caddy source metadata differs from original candidate/runtime pins");
  for(const s of [m.source,m.secondRead]){
    closed(s,["path","bytes","sha256","witness"]);closed(s.witness,["uid","gid","mode","nlink","device","inode","mtimeNs","ctimeNs"]);
    if(!safePath(s.path)||!hash(s.sha256)||!decimal(s.bytes,true)||BigInt(s.bytes)>16777216n||s.witness.mode!=="600"||s.witness.nlink!=="1"||Object.entries(s.witness).some(([k,v])=>!decimal(v,k==="inode")))fail("private Caddy original source witness differs");
  }
  if(m.source.path===m.secondRead.path||path.posix.dirname(m.source.path)!==path.posix.dirname(m.secondRead.path)||m.source.bytes!==m.secondRead.bytes||m.source.sha256!==m.secondRead.sha256||m.source.witness.uid!==m.secondRead.witness.uid||m.source.witness.gid!==m.secondRead.witness.gid||(m.source.witness.device===m.secondRead.witness.device&&m.source.witness.inode===m.secondRead.witness.inode))fail("two equal independently retained Caddy source reads required");
  closed(m.originalProcess,["pid","startTicks","argv"]);closed(m.originalUnit,["path","sha256"]);
  if(!decimal(m.originalProcess.pid,true)||BigInt(m.originalProcess.pid)<2n||!decimal(m.originalProcess.startTicks,true)||JSON.stringify(m.originalProcess.argv)!==JSON.stringify(["/usr/bin/caddy","run","--environ","--config","/etc/caddy/Caddyfile"])||m.originalUnit.path!=="/usr/lib/systemd/system/caddy.service"||!hash(m.originalUnit.sha256))fail("original Caddy process/unit metadata differs");
  const base=m.baseline;
  closed(base,["configPath","configSHA256","semanticSHA256","candidateSemanticSHA256","dropInPath","dropInSHA256"]);
  const dropin="[Service]\nExecStart=\nExecStart=/usr/bin/caddy run --environ --config /etc/caddy/ynx-chain.json\nExecReload=\nExecReload=/usr/bin/caddy reload --config /etc/caddy/ynx-chain.json --force\n";
  if(base.configPath!=="/etc/caddy/ynx-chain.json"||base.configSHA256!==m.source.sha256||![base.semanticSHA256,base.candidateSemanticSHA256,base.dropInSHA256].every(hash)||base.semanticSHA256===base.candidateSemanticSHA256||base.dropInPath!=="/etc/systemd/system/caddy.service.d/ynx-chain-json.conf"||base.dropInSHA256!==crypto.createHash("sha256").update(dropin).digest("hex"))fail("Caddy persistent baseline/projection metadata differs");
  if(!Array.isArray(m.rpcUpstreams)||m.rpcUpstreams.length!==3)fail("exact three approved JSON-RPC projections required");
  const hosts=new Set(), pointers=new Set();
  for(const r of m.rpcUpstreams){closed(r,["pointer","host","from","to"]);if(!["rpc.ynxweb4.com","rpc-testnet.ynxweb4.com","evm.ynxweb4.com"].includes(r.host)||hosts.has(r.host)||typeof r.pointer!=="string"||r.pointer.length>4096||!/^\/apps\/http\/servers\/[A-Za-z0-9_-]+\/routes\/(0|[1-9][0-9]*)(?:\/[A-Za-z0-9_-]+|\/(?:0|[1-9][0-9]*))*\/dial$/.test(r.pointer)||pointers.has(r.pointer)||r.from!=="127.0.0.1:6420"||r.to!=="127.0.0.1:27620")fail("Caddy RPC source projections differ");hosts.add(r.host);pointers.add(r.pointer);}
  return m;
}

if (rawArgs[0] === "--caddy-source-check") {
  if(rawArgs.length!==4)fail("Caddy source requires original binding, local metadata and gateway pin");
  caddyManifest(rawArgs[2],gatewayBinding(rawArgs[1]),rawArgs[3]);
  process.exit(0);
}
// This only qualifies the public protocol route and its configured-source
// observation. The RPC anchor is never a trusted checkpoint or signature proof.
function gatewayPQIdentity(file, b) {
  requireRestrictedFile(file, "gateway PQ identity");
  const before = fs.lstatSync(file), limit = 16 * 1024 * 1024;
  if (before.nlink !== 1 || before.size < 1 || before.size > limit) fail("gateway PQ identity exceeds its original bounded file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let raw;
  try {
    const opened = fs.fstatSync(fd), buffer = Buffer.alloc(limit + 1);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail("gateway PQ identity changed before read");
    let size = 0, count;
    while (size <= limit && (count = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
    const after = fs.fstatSync(fd);
    if (size > limit || size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail("gateway PQ identity changed or exceeded its bound during read");
    raw = buffer.subarray(0, size);
  } finally { fs.closeSync(fd); }
  let v;
  try {
    const text = raw.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(raw)) throw new Error("invalid UTF-8");
    v = JSON.parse(text);
    // JSON.parse accepts duplicate object keys. Walk the already valid grammar
    // to reject them, including escaped spellings, before using source pins.
    let at = 0;
    const space = () => { while (/\s/.test(text[at] || "")) at++; };
    const string = () => { const start = at++; while (text[at] !== '"') { if (text[at] === "\\") at++; at++; } at++; return JSON.parse(text.slice(start, at)); };
    const value = depth => {
      if (depth > 32) throw new Error("JSON nesting exceeds bound");
      space();
      if (text[at] === "{") {
        at++; space(); const keys = new Set();
        if (text[at] !== "}") for (;;) { space(); const key = string(); if (keys.has(key)) throw new Error("duplicate object key"); keys.add(key); space(); at++; value(depth + 1); space(); if (text[at] !== ",") break; at++; }
        at++;
      } else if (text[at] === "[") {
        at++; space(); if (text[at] !== "]") for (;;) { value(depth + 1); space(); if (text[at] !== ",") break; at++; } at++;
      } else if (text[at] === '"') string();
      else { while (at < text.length && !/[\s,}\]]/.test(text[at])) at++; }
    };
    value(0); space(); if (at !== text.length) throw new Error("trailing JSON");
  } catch (error) { fail(`gateway PQ identity is not strict JSON: ${error.message}`); }
  const i = v?.identity, a = v?.anchor;
  if (v?.version !== "ynx-pq-rpc-identity-v1" || v.source !== "configured-comet-rpc" || v.buildSource !== "gateway-buildinfo" || v.build?.commit !== b.commit || v.build?.release !== b.bftRelease || v.independentFinality !== false || i?.version !== "ynx-pq-wallet-identity-v1" || i.source !== "configured-abci-bootstrap" || i.recordsView !== "committed" || i.hashAlgorithm !== "sha256" || i.nativeChainId !== "6423" || i.cometChainId !== "ynx_6423-1" || i.nativeGenesisHash !== b.originalGenesisHash || i.cometGenesisSHA256 !== b.packageGenesisHash || i.migrationStateHash !== b.packageMigrationStateHash || i.migrationHeight !== String(b.finalSnapshotHeight) || i.initialHeight !== String(b.finalSnapshotHeight + 1)) fail("gateway PQ identity source/build/chain/genesis/migration mismatch");
  const height = (value, zero = false) => typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 19 && BigInt(value) <= 9223372036854775807n && (zero || value !== "0");
  if (!height(i.currentStateHeight) || BigInt(i.currentStateHeight) < BigInt(i.migrationHeight) || BigInt(i.currentStateHeight) === 9223372036854775807n || !hash(i.currentStateAppHash) || a?.stateHeight !== i.currentStateHeight || a.stateAppHash !== i.currentStateAppHash || a.headerHeight !== String(BigInt(i.currentStateHeight) + 1n) || a.headerAppHashStateHeight !== i.currentStateHeight || !height(a.observedLatestBlockHeight, true) || a.blockHashAlgorithm !== "cometbft-header-merkle-sha256" || a.signatureVerification !== "not-performed") fail("gateway PQ identity current state and anchor coordinates mismatch");
  const observed = a.status === "rpc-observed";
  const originalBase64 = (value, max) => typeof value === "string" && value.length > 0 && value.length <= 4 * Math.ceil(max / 3) && Buffer.from(value, "base64").length <= max && Buffer.from(value, "base64").toString("base64") === value;
  if (observed ? (BigInt(a.observedLatestBlockHeight) < BigInt(a.headerHeight) || !hash(a.blockHash) || !hash(a.validatorsHash) || !originalBase64(a.commitResult, 8 << 20) || !originalBase64(a.validatorsResult, 2 << 20)) : (a.status !== "pending" || BigInt(a.observedLatestBlockHeight) >= BigInt(a.headerHeight) || ["blockHash","validatorsHash","commitResult","validatorsResult"].some(key => Object.hasOwn(a, key)))) fail("gateway PQ identity anchor is not an honest pending or RPC observation");
  return crypto.createHash("sha256").update(raw).digest("hex");
}
function identityObservation(v, dry) {
  if (v.pqIdentityObserved !== !dry || (dry ? v.pqIdentitySHA256 !== null : !hash(v.pqIdentitySHA256))) fail("gateway result lacks its original PQ identity observation");
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
  if (rawArgs.length !== 7 && !(rawArgs.length === 8 && rawArgs[7] === "public")) fail("exact gateway observation and original PQ identity arguments required");
  const publicReady=rawArgs.length === 8;
  const b = gatewayBinding(rawArgs[1]), start = readJSON(rawArgs[2], "gateway start");
  gatewayReceipt(start, b, "start", false, [start.gatewaySHA256, start.packageVerifierSHA256, start.backupSHA256]);
  const pqIdentitySHA256 = gatewayPQIdentity(rawArgs[6], b);
  const before = readJSON(rawArgs[3], "gateway before"), after = readJSON(rawArgs[4], "gateway after"), status = readJSON(rawArgs[5], "gateway status");
  for (const v of [before, after]) {
    if (v.ok !== true || v.service !== "ynx-bft-gatewayd" || v.mode !== "cometbft-backed" || v.truthfulStatus !== "cometbft-rpc-and-abci-backed" || v.chainId !== 6423 || v.nativeSymbol !== "YNXT" || v.cometChainId !== "ynx_6423-1" || v.validatorCount !== 4 || v.publicCutoverReady !== publicReady || v.build?.commit !== b.commit || v.build?.release !== b.bftRelease || v.migrationHeight !== b.finalSnapshotHeight || v.migrationBlockHash !== start.migrationBlockHash || !Number.isSafeInteger(v.height) || v.height <= b.finalSnapshotHeight) fail("gateway health source/chain/build/retained history mismatch");
  }
  if (after.height <= before.height || status.chainId !== 6423 || status.nativeCurrencySymbol !== "YNXT" || status.consensusEngine !== "cometbft" || status.cometChainId !== "ynx_6423-1" || status.truthfulStatus !== "cometbft-rpc-and-abci-backed" || status.validatorCount !== 4 || status.publicCutoverReady !== publicReady || status.migrationHeight !== b.finalSnapshotHeight || status.migrationBlockHash !== start.migrationBlockHash || status.earliestBlockHeight !== b.finalSnapshotHeight + 1 || !Number.isSafeInteger(status.height) || status.height < after.height) fail("gateway did not advance or changed its original history boundary");
  process.stdout.write(`${JSON.stringify({version:gatewayContinuityVersion, mode:gatewayMode, transactionId:b.transactionId, commit:b.commit, bftRelease:b.bftRelease, operatorPlanSHA256:b.operatorPlanSha256, runtimeCommit:b.runtimeCommit, runtimeSOURCEsha256:b.runtimeManifestSha256, bindingSHA256:sha256(rawArgs[1]), migrationHeight:b.finalSnapshotHeight, migrationBlockHash:start.migrationBlockHash, source:"configured-comet-rpc", chainId:6423, cometChainId:"ynx_6423-1", heightBefore:before.height, heightAfter:after.height, observedHeight:status.height, gatewaySHA256:start.gatewaySHA256, pqIdentityObserved:true, pqIdentitySHA256, verified:true, dryRun:false, parallelCandidateOnly:true, publicCutoverReady:publicReady, publicIngressChanged:publicReady, independentFinalityVerified:false, ecosystemContinuityVerified:false})}\n`);
  process.exit(0);
}
if (rawArgs[0] === "--continuity-check") {
  if (rawArgs.length !== 4 || !["0", "1"].includes(rawArgs[3])) fail("exact continuity arguments required");
  const b=gatewayBinding(rawArgs[1]), v=readJSON(rawArgs[2], "gateway continuity"), dry=rawArgs[3] === "1";
  identityObservation(v, dry);
  if (!gatewayIdentity(v,b) || v.version !== gatewayContinuityVersion || v.bindingSHA256 !== sha256(rawArgs[1]) || v.verified !== !dry || v.dryRun !== dry || v.parallelCandidateOnly !== true || v.publicIngressChanged !== false || v.independentFinalityVerified !== false || v.ecosystemContinuityVerified !== false) fail("gateway continuity is not bound to this original operator/runtime transaction");
  if (!dry && (v.source !== "configured-comet-rpc" || v.chainId !== 6423 || v.cometChainId !== "ynx_6423-1" || !Number.isSafeInteger(v.heightBefore) || !Number.isSafeInteger(v.heightAfter) || v.heightBefore <= b.finalSnapshotHeight || v.heightAfter <= v.heightBefore || !Number.isSafeInteger(v.observedHeight) || v.observedHeight < v.heightAfter || !hash(v.gatewaySHA256))) fail("gateway continuity lacks real advancing configured-RPC evidence");
  process.exit(0);
}
if (rawArgs[0] === "--ingress-check") {
  if (![6,7].includes(rawArgs.length) || !["switch", "rollback"].includes(rawArgs[3]) || !["0", "1"].includes(rawArgs[4]) || !hash(rawArgs[5])) fail("exact ingress receipt arguments required");
  const b=gatewayBinding(rawArgs[1]),v=readJSON(rawArgs[2],"RPC ingress"),dry=rawArgs[4] === "1", forward=rawArgs[3] === "switch";
  const json=Object.hasOwn(b,"caddySource");
  if(rawArgs.length!==(json?7:6))fail("JSON ingress requires its original independently pinned metadata; legacy ingress has no JSON authority");
  if(json){const m=caddyManifest(rawArgs[6],b,rawArgs[5]);if(v.caddySourceManifestSHA256!==b.caddySource.manifestSha256||v.sourceSHA256!==m.source.sha256||v.baselineSemanticSHA256!==m.baseline.semanticSHA256||v.candidateSemanticSHA256!==m.baseline.candidateSemanticSHA256||v.dropInSHA256!==m.baseline.dropInSHA256)fail("JSON ingress receipt differs from independently approved original source/projection");}
  else if(["caddySourceManifestSHA256","sourceSHA256","baselineSemanticSHA256","candidateSemanticSHA256","dropInSHA256"].some(k=>Object.hasOwn(v,k)))fail("unapproved JSON ingress metadata");
  if (v.version !== "YNX-SINGLE-APP-GATEWAY-INGRESS/v1" || v.mode !== (json?"single-app-gateway-json":gatewayMode) || v.transactionId !== b.transactionId || v.commit !== b.commit || v.bftRelease !== b.bftRelease || v.operatorPlanSHA256 !== b.operatorPlanSha256 || v.runtimeCommit !== b.runtimeCommit || v.runtimeSOURCEsha256 !== b.runtimeManifestSha256 || v.rpcOnly !== true || v.ecosystemContinuityVerified !== false || Boolean(v.dryRun) !== dry || v.ingress !== (forward?"bft":"authoritative") || v.publicIngressChanged !== (forward && !dry) || (!dry && v.sourceTestOnly === true)) fail("RPC-only ingress receipt identity/pin/result mismatch");
  if (v.gatewaySHA256 !== rawArgs[5] || v.publicCutoverReady !== (forward && !dry) || (!dry && (!hash(v.authoritativeChecksumsSha256) || !hash(v.candidateChecksumsSha256)))) fail("RPC ingress lacks original runtime/config byte identities");
  process.exit(0);
}
if (rawArgs[0] === "--public-result-check") {
  if (rawArgs.length !== 4 || !["0","1"].includes(rawArgs[3])) fail("exact public result arguments required");
  const b=gatewayBinding(rawArgs[1]),v=readJSON(rawArgs[2],"public result"),dry=rawArgs[3]==="1";
  identityObservation(v, dry);
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
  identityObservation(o, false);
  if (gatewayPQIdentity(path.join(root,"gateway-pq-identity.json"), b) !== o.pqIdentitySHA256) fail("public PQ identity raw bytes changed after the original observation");
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
function operatorPreparationProjection(plan, preparation) {
  const future = ["consensusGenesis", "consensusGenesisSHA256", "migrationStateHash"];
  const required = ["version", "chainId", "validatorManifestSHA256", "originalGenesisHash", "stateLayout", "runtimePlan", "runtimePlanHash", "pqSchedule", "pqScheduleHash", "roles"];
  const allowed = [...required, "heightHaltSessionId", ...(preparation ? ["preparationOnly"] : future)];
  if (Object.keys(plan).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(plan, key))) fail("native operator preparation has unexpected or missing stable fields");
  if (preparation && (plan.preparationOnly !== true || future.some(key => Object.hasOwn(plan, key)))) fail("native preparation cannot pin a future genesis or migration result");
  if (!hash(plan.validatorManifestSHA256) || !hash(plan.originalGenesisHash) || !["atomic-json", "snapshot-journal", "block-journal"].includes(plan.stateLayout)) fail("native operator preparation stable pins/layout are incomplete");
  if (![null, ""].includes(plan.runtimePlan) || plan.runtimePlanHash !== "" || ![null, ""].includes(plan.pqSchedule) || plan.pqScheduleHash !== "") fail("native preparation cannot authorize a runtime or PQ schedule");
  if (!preparation) {
    if (!hash(plan.consensusGenesisSHA256) || !hash(plan.migrationStateHash) || typeof plan.consensusGenesis !== "string" || !plan.consensusGenesis) fail("final native operator plan requires its independently approved genesis and migration");
    const genesis = Buffer.from(plan.consensusGenesis, "base64");
    if (genesis.toString("base64") !== plan.consensusGenesis || crypto.createHash("sha256").update(genesis).digest("hex") !== plan.consensusGenesisSHA256) fail("final operator genesis bytes differ from its independent pin");
  }
  const roleRequired = ["role", "home", "abciState", "legacyKeyPath", "legacyStatePath", "nodeKeyPath"];
  const roleOptional = ["hostBinding", "remoteSigner", "transportKeyPath", "signerPeerPublicKey", "remoteTimeout", "heightHaltControlPath"];
  const projectedRoles = plan.roles.map(role => {
    if (!role || typeof role !== "object" || Array.isArray(role) || roleRequired.some(key => !Object.hasOwn(role, key)) || Object.keys(role).some(key => ![...roleRequired, ...roleOptional].includes(key))) fail("native preparation role fields are incomplete or unknown");
    for (const key of roleRequired.filter(key => key !== "role")) safeOperatorPath(role[key]);
    for (const key of roleOptional.filter(key => key !== "heightHaltControlPath")) if (role[key] !== undefined && role[key] !== (key === "hostBinding" ? null : "")) fail("native preparation must preserve original local bootstrap custody");
    if (role.heightHaltControlPath !== undefined && role.heightHaltControlPath !== "") safeOperatorPath(role.heightHaltControlPath);
    return {...Object.fromEntries(roleRequired.map(key => [key, role[key]])), ...Object.fromEntries(roleOptional.map(key => [key, role[key] ?? (key === "hostBinding" ? null : "")]))};
  });
  const session = plan.heightHaltSessionId ?? "";
  if (session !== "" && !hash(session)) fail("native preparation height halt session is invalid");
  return {...Object.fromEntries(required.filter(key => !["roles", "runtimePlan", "pqSchedule"].includes(key)).map(key => [key, plan[key]])), runtimePlan: null, pqSchedule: null, heightHaltSessionId: session, roles: projectedRoles};
}
function canonicalProjection(value) {
  if (Array.isArray(value)) return value.map(canonicalProjection);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalProjection(value[key])]));
  return value;
}
if (rawArgs[0] === "--retain-operator-preparation") {
  if (rawArgs.length !== 5) fail("preparation retention requires original plan, independent pin, validator pin and exclusive destination");
  const [, file, pin, validatorPin, destination] = rawArgs, plan = pinnedOperator(file, pin);
  operatorPreparationProjection(plan, true);
  if (!hash(validatorPin) || plan.validatorManifestSHA256 !== validatorPin) fail("preparation plan differs from independently approved validator manifest");
  safeOperatorPath(destination);
  const parent = path.dirname(destination), info = fs.lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || fs.realpathSync(parent) !== parent || (info.mode & 0o7777) !== 0o700) fail("preparation retention requires the original private transaction directory");
  const raw = fs.readFileSync(file);
  if (crypto.createHash("sha256").update(raw).digest("hex") !== pin) fail("preparation source changed before retention");
  const fd = fs.openSync(destination, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, raw); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const directory = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  if (sha256(destination) !== pin || sha256(file) !== pin) fail("preparation retention changed; retain partial/UNKNOWN");
  process.exit(0);
}
if (rawArgs[0] === "--operator-continuation") {
  if (rawArgs.length !== 5) fail("operator continuation requires preserved preparation and independent final plan pins");
  const before = operatorPreparationProjection(pinnedOperator(rawArgs[1], rawArgs[2]), true);
  const after = operatorPreparationProjection(pinnedOperator(rawArgs[3], rawArgs[4]), false);
  if (JSON.stringify(canonicalProjection(before)) !== JSON.stringify(canonicalProjection(after))) fail("final operator plan changed the original approved custody/layout/runtime boundary");
  process.exit(0);
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
function operatorRoleCommand(plan, name, fresh = false, preparation = false) {
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
  if (!preparation) {
    if (!hash(plan.consensusGenesisSHA256)) fail("missing original consensus genesis pin");
    commands.push(`printf '%s  %s\\n' '${plan.consensusGenesisSHA256}' ${safePath(`${role.home}/config/genesis.json`)} | sudo sha256sum --strict -c - >/dev/null;`);
  }
  return commands.join("\n");
}
if (rawArgs[0] === "--operator-preflight") {
  if (rawArgs.length !== 4 && !(rawArgs.length === 5 && ["fresh", "prepare-native"].includes(rawArgs[4]))) fail("operator preflight requires plan, external pin, role and optional explicit fresh/preparation mode");
  const plan = pinnedOperator(rawArgs[1], rawArgs[2]), preparation = rawArgs[4] === "prepare-native";
  if (preparation) operatorPreparationProjection(plan, true);
  else if (Object.hasOwn(plan, "preparationOnly")) fail("preparation plan cannot authorize a final operator command");
  process.stdout.write(`${operatorRoleCommand(plan, rawArgs[3], ["fresh", "prepare-native"].includes(rawArgs[4]), preparation)}\n`);
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
  const original = binding.authoritativeCommit ? roleAuthoritativeIdentity(binding, role) : {};
  const identity = (v, withRole = true) => v.transactionId === binding.transactionId && v.commit === binding.commit && v.authoritativeRelease === (original.authoritativeRelease || binding.authoritativeRelease) && (!original.authoritativeCommit || v.authoritativeCommit === original.authoritativeCommit) && v.bftRelease === binding.bftRelease && (!withRole || v.role === role);
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
if (![operatorPlan.consensusGenesisSHA256,operatorPlan.originalGenesisHash,operatorPlan.migrationStateHash].every(hash)) fail("independent operator genesis/migration pins are incomplete");

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
const nativeIdentity = authoritativeIdentity(approval);
const nativeRoles = authoritativeRoleIdentities(approval);
const caddySource = caddySourceIdentity(approval);
const singleApp = isSingleAppCustody(approval);
if (singleApp && ["serviceSignerRecoveryVerified", "serviceSignerManifestSha256"].some(key => Object.hasOwn(approval, key))) fail("single-App approval cannot assert unrelated service custody");
if (approval.schemaVersion !== 1 || approval.action !== "ynx-public-bft-cutover" || approval.approved !== true || approval.commit !== expectedCommit || approval.release !== expectedRelease) fail("transaction approval identity mismatch");
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(approval.approvalId || "") || typeof approval.approver !== "string" || approval.approver.trim().length < 3) fail("transaction approval attribution is invalid");
if (typeof approval.custodyReviewer !== "string" || approval.custodyReviewer.trim().length < 3 || approval.custodyReviewer.trim().toLowerCase() === approval.approver.trim().toLowerCase()) fail("transaction approval independent custody attribution is invalid");
if (typeof approval.custodyEvidence !== "string" || !/^sha256:[0-9a-f]{64}$/.test(approval.custodyEvidence.trim())) fail("transaction approval custody review hash is invalid");
const approvalParticipants = [approval.approver, approval.custodyReviewer, approval.owner, approval.ownerHandoverReviewer].map((value) => String(value || "").trim().toLowerCase());
if (approvalParticipants.some((value) => value.length < 3) || new Set(approvalParticipants).size !== approvalParticipants.length) fail("transaction approval owner/custody role separation is invalid");
if (!/^sha256:[0-9a-f]{64}$/.test(approval.ownerHandoverInventoryDigest || "") || !/^sha256:[0-9a-f]{64}$/.test(approval.ownerHandoverInventoryEvidence || "") || !/^sha256:[0-9a-f]{64}$/.test(approval.ownerHandoverReceiptEvidence || "")) fail("transaction approval owner handover evidence is invalid");
if (approval.publicCutoverAuthorized !== true || approval.automaticRollbackRequired !== true) fail("transaction approval does not authorize cutover with automatic rollback");
if (approval.validatorKeyRecoveryVerified !== true || (!singleApp && approval.serviceSignerRecoveryVerified !== true) || approval.ownerHandoverVerified !== true || approval.rotationProcedureVerified !== true) fail("transaction approval custody recovery is incomplete");
if (!singleApp && !/^[0-9a-f]{64}$/.test(approval.serviceSignerManifestSha256 || "")) fail("transaction approval service signer manifest checksum is invalid");
if (approval.candidateGenesisTime !== genesisTime) fail("candidate genesis time differs from approval");
const validatorManifestSha256 = sha256(validatorManifestPath);
if (approval.validatorManifestSha256 !== validatorManifestSha256) fail("validator manifest checksum differs from approval");
if (approval.operatorPlanSha256 !== operatorPlanSha256 || approval.runtimeManifestSha256 !== runtimeManifestSha256) fail("operator/runtime independent pins differ from transaction approval");
for (const field of ["snapshotSourceSha256", "exporterManifestSha256"]) {
  if (typeof approval[field] !== "string" || !hash(approval[field])) fail(`${field} must be an independent nonzero SHA256 in the original transaction approval`);
}

const snapshot = readJSON(snapshotPath, "final snapshot");
const snapshotEvidence = readJSON(snapshotEvidencePath, "final snapshot evidence");
const finalSnapshotSha256 = sha256(snapshotPath);
if (snapshotEvidence.transactionId !== transactionId || snapshotEvidence.commit !== expectedCommit || snapshotEvidence.bftRelease !== expectedRelease) fail("final snapshot evidence identity mismatch");
if (snapshotEvidence.authoritativeRelease !== (nativeIdentity.authoritativeRelease || `ynx-chain-${expectedCommit}`)) fail("final snapshot authoritative release mismatch");
if (nativeIdentity.authoritativeCommit) {
  if (JSON.stringify(authoritativeIdentity(snapshotEvidence)) !== JSON.stringify(nativeIdentity)) fail("final snapshot independent native identity/paths differ from approval");
} else if (["authoritativeCommit", "authoritativeBinarySha256", "authoritativeSource"].some(name => Object.hasOwn(snapshotEvidence, name))) fail("unapproved independent native snapshot identity");
if (snapshotEvidence.validated !== true || snapshotEvidence.pauseVerified !== true || snapshotEvidence.mutationFreezeVerified !== true) fail("final snapshot evidence is not fully validated");
if (snapshotEvidence.sourceUnchanged !== true || snapshotEvidence.exporterCommit !== runtimeCommit) fail("final snapshot must preserve the original source and use the independently pinned current exporter commit");
for (const field of ["snapshotSourceSha256", "exporterManifestSha256"]) {
  if (snapshotEvidence[field] !== approval[field]) fail(`final snapshot ${field} differs from the original transaction approval`);
}
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
  ...(singleApp ? { custodyProfile: singleAppCustodyProfile } : {}),
  schemaVersion: 2,
  transactionId,
  commit: expectedCommit,
  authoritativeRelease: nativeIdentity.authoritativeRelease || `ynx-chain-${expectedCommit}`,
  ...nativeIdentity,
  ...nativeRoles,
  ...caddySource,
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
  originalGenesisHash: operatorPlan.originalGenesisHash,
  automaticRollbackRequired: true,
  ...(!singleApp ? { serviceSignerManifestSha256: approval.serviceSignerManifestSha256 } : {}),
  validated: true,
}, null, 2)}\n`);
