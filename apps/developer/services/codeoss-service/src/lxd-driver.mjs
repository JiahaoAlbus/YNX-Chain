import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { createHash } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OPENVSCODE_X64 } from "./upstream.mjs";
import { fault } from "./central-identity.mjs";
import { prepareCoreProject, writePrivateReceipt } from "./runtime-files.mjs";
import { verifyDerivedRuntime } from "./derived-runtime.mjs";
import { lxcClientEnvironment } from "../../runtime-profile-service/src/service.mjs";

// Production x64 transport uses the existing LXD control boundary. Every core
// instance is its own unprivileged container; old user runtimes are never reused.
export function createLxdCoreDriver({ artifactRoot, archivePath, licensePath, noticesPath,
  imageFingerprint, storagePool, profileName = "ynx-core-isolated", quotaForDirectory, networkAdmission,
  brandingRoot, projectStorage, derivedManifestSha256, run = runLxc } = {}) {
  if (!/^[a-f0-9]{64}$/.test(imageFingerprint || "") || !/^[a-z0-9-]{1,64}$/.test(storagePool || "") || !/^ynx-core-[a-z0-9-]{1,48}$/.test(profileName))
    throw new Error("An immutable approved LXD base image, bounded pool and core profile are required.");
  artifactRoot = resolve(artifactRoot);
  const name = context => `ynx-core-${context.identityDigest.slice(0, 32)}`;
  const args = (context, command) => ["exec", name(context), "--", ...command];
  const receipt = context => join(context.directory, "lxd-receipt.json");
  async function inspect(context, { preparedOnly = false } = {}) {
    const result = await run(["list", name(context), "--format", "json"]);
    let rows; try { rows = JSON.parse(result.stdout); } catch { throw fault("LXD identity response is invalid.", "core_identity_unconfirmed", 503); }
    const value = rows.find(row => row.name === name(context)); if (!value) return null;
    if (rows.length !== 1) throw fault("LXD identity selection was not exact.", "core_identity_mismatch", 503);
    const prepared = JSON.parse(await readFile(receipt(context), "utf8"));
    assertLxdIdentity(value, context, { imageFingerprint, profileName });
    if (!preparedOnly) assertLxdIsolation(value, context, { artifactRoot, imageFingerprint, storagePool, profileName,
      networkName: prepared.networkName, acl: prepared.acl });
    return value;
  }
  async function start(context) {
    if (context.image.sha256 !== OPENVSCODE_X64.sha256) throw fault("x64 runtime artifact was not pinned.", "core_architecture_unverified", 503);
    for (const [path, digest] of [[archivePath, OPENVSCODE_X64.sha256], [licensePath, OPENVSCODE_X64.licenseSha256], [noticesPath, OPENVSCODE_X64.noticesSha256]]) {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || createHash("sha256").update(await readFile(path)).digest("hex") !== digest)
        throw fault("Official x64 core artifact/license failed verification.", "core_upstream_mismatch", 503);
    }
    if (await realpath(artifactRoot) !== artifactRoot) throw fault("Core artifact path is not canonical.", "core_state_unsafe", 503);
    if (!/^[a-f0-9]{64}$/.test(derivedManifestSha256 || "")) throw fault("A reviewed branded runtime manifest is required.", "core_brand_review_required", 503);
    await verifyDerivedRuntime(artifactRoot, derivedManifestSha256, OPENVSCODE_X64);
    const product = JSON.parse(await readFile(join(artifactRoot, "product.json"), "utf8"));
    if (product.commit !== OPENVSCODE_X64.commit || product.extensionsGallery?.serviceUrl !== OPENVSCODE_X64.marketplace)
      throw fault("Core commit/gallery did not match the pinned x64 release.", "core_upstream_mismatch", 503);
    const quota = await (projectStorage?.verify || quotaForDirectory)?.(context.projectDirectory), network = await networkAdmission?.(context);
    if (!quota?.enforced || quota.directory !== await realpath(context.projectDirectory) || quota.maxBytes < 1 || quota.maxBytes > context.limits.diskBytes)
      throw fault("An enforced native project filesystem quota is required.", "core_disk_quota_unavailable", 503);
    if (!network?.enforced || !network.denyHost || !network.allowlisted || !/^ynx-core-egress-[a-z0-9-]{1,48}$/.test(network.networkName || "") ||
      !/^[a-f0-9]{64}$/.test(network.policyDigest || "") || !/^ynx-core-[a-z0-9-]{1,48}$/.test(network.acl || ""))
      throw fault("Reviewed LXD egress ACL must deny host/private services and allow package/extension endpoints.", "core_egress_unavailable", 503);
    let proxy;
    try { proxy = new URL(network.proxyURL); } catch { throw fault("Reviewed package egress proxy is missing.", "core_egress_unavailable", 503); }
    if (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash)
      throw fault("Package egress proxy configuration is invalid.", "core_egress_unavailable", 503);
    const pool = JSON.parse((await run(["storage", "show", storagePool, "--format", "json"])).stdout);
    if (!["btrfs", "zfs", "lvm"].includes(pool.driver)) throw fault("LXD dir storage cannot enforce this runtime's root disk quota.", "core_root_quota_unavailable", 503);
    const net = JSON.parse((await run(["network", "show", network.networkName, "--format", "json"])).stdout);
    if (net.type !== "bridge" || net.managed !== true || String(net.config?.["security.acls"] || "").split(",").map(x => x.trim()).join(",") !== network.acl ||
      net.config["security.acls.default.ingress.action"] !== "reject" || net.config["security.acls.default.egress.action"] !== "reject")
      throw fault("LXD network ACL/default-deny enforcement is not active.", "core_egress_unavailable", 503);
    const acl = JSON.parse((await run(["network", "acl", "show", network.acl, "--format", "json"])).stdout);
    if (createHash("sha256").update(JSON.stringify(acl)).digest("hex") !== network.policyDigest)
      throw fault("LXD egress policy changed after review.", "core_egress_unavailable", 503);
    await prepareCoreProject({ ...context, egressProxy: proxy.origin }, brandingRoot);
    await writePrivateReceipt(receipt(context), { identityDigest: context.identityDigest, runtimeId: context.runtimeId,
      imageFingerprint, networkName: network.networkName, policyDigest: network.policyDigest, acl: network.acl,
      tokenMode: "private-loopback-without-connection-token" });
    await run(["init", imageFingerprint, name(context), "--profile", profileName, "--storage", storagePool,
      "--config", "security.privileged=false", "--config", "security.nesting=false", "--config", "security.devlxd=false",
      "--config", "security.idmap.isolated=true", "--config", `limits.cpu=${context.limits.cpus}`,
      "--config", `limits.memory=${context.limits.memoryBytes}`, "--config", `limits.processes=${context.limits.pids}`,
      "--config", `user.ynx.core.identity=${context.identityDigest}`, "--config", `user.ynx.core.runtime=${context.runtimeId}`]);
    await run(["config", "device", "override", name(context), "root", "size=4GiB"]);
    await run(["config", "device", "add", name(context), "core", "disk", `source=${artifactRoot}`, "path=/opt/openvscode", "readonly=true"]);
    await run(["config", "device", "add", name(context), "project", "disk", `source=${context.projectDirectory}`, "path=/project", "shift=true"]);
    await run(["config", "device", "override", name(context), "eth0", `network=${network.networkName}`, `security.acls=${network.acl}`]);
    const created = await inspect(context);
    if (!created?.config?.["volatile.uuid"]) throw fault("LXD container identity was not confirmed.", "core_identity_unconfirmed", 503);
    await writePrivateReceipt(join(context.directory, "lxd-instance-id"), created.config["volatile.uuid"]);
    // Durable before issuing start: a failed transport response must never prove
    // that execution did not happen. Stop conservatively retains the import.
    await writePrivateReceipt(join(context.directory, "lxd-start-issued"), created.config["volatile.uuid"]);
    await run(["start", name(context)]);
    await run(args(context, ["python3", "-c", "import os; assert open('/proc/1/comm').read().strip()=='systemd'; assert os.path.exists('/sys/fs/cgroup/cgroup.controllers')"]));
    await run(args(context, ["useradd", "--uid", "1000", "--user-group", "--no-create-home", "--shell", "/bin/bash", "ynx-core"]));
    await run(args(context, ["chmod", "0711", "/project"]));
    await run(args(context, ["chown", "--no-dereference", "-R", "1000:1000", "/project/workspace", "/project/user-data", "/project/extensions"]));
    await run(args(context, ["systemd-run", "--quiet", "--unit", `ynx-core-${context.sessionId}`, "--service-type=exec", "--uid=1000", "--gid=1000",
      "--property=KillMode=control-group", "--property=NoNewPrivileges=yes", "--property=ProtectControlGroups=yes", "--property=RestrictSUIDSGID=yes",
      "--setenv=HOME=/project/user-data", `--setenv=HTTP_PROXY=${proxy.origin}`, `--setenv=HTTPS_PROXY=${proxy.origin}`,
      `--setenv=http_proxy=${proxy.origin}`, `--setenv=https_proxy=${proxy.origin}`, "--working-directory=/project/workspace", "/opt/openvscode/bin/openvscode-server",
      "--host", "127.0.0.1", "--port", "3000", "--without-connection-token", "--default-folder", "/project/workspace",
      "--user-data-dir", "/project/user-data", "--extensions-dir", "/project/extensions", "--disable-telemetry"]));
    await run(args(context, ["/opt/openvscode/node", "-e", LOOPBACK_PROOF]));
    return { running: true, runtimeId: context.runtimeId };
  }
  async function stop(context) {
    let prepared;
    try { prepared = JSON.parse(await readFile(receipt(context), "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw fault("LXD launch receipt is unreadable.", "core_identity_unconfirmed", 503);
      const rows = JSON.parse((await run(["list", name(context), "--format", "json"])).stdout);
      if (rows.some(row => row.name === name(context))) throw fault("An unconfirmed LXD runtime exists.", "core_identity_unconfirmed", 503);
      return proof(context, true);
    }
    if (prepared.identityDigest !== context.identityDigest || prepared.runtimeId !== context.runtimeId) throw fault("LXD receipt identity changed.", "core_identity_mismatch", 409);
    const current = await inspect(context, { preparedOnly: true });
    let instanceId;
    try { instanceId = await readFile(join(context.directory, "lxd-instance-id"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!current && !instanceId) return proof(context, true);
    if (!current || (instanceId && instanceId !== current.config["volatile.uuid"])) throw fault("LXD runtime identity changed or disappeared.", "core_identity_mismatch", 409);
    if (!instanceId && current.status !== "Stopped") throw fault("LXD runtime has no confirmed stopped identity.", "core_identity_unconfirmed", 503);
    let startIssued;
    try { startIssued = await readFile(join(context.directory, "lxd-start-issued"), "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (startIssued && startIssued !== current.config["volatile.uuid"]) throw fault("LXD start proof changed.", "core_identity_mismatch", 409);
    const neverStarted = !startIssued && current.status === "Stopped";
    if (!startIssued && !neverStarted) throw fault("Unexpected execution without a durable launch proof.", "core_identity_unconfirmed", 503);
    if (current.status === "Running") await run(["stop", name(context), "--timeout", "10"]);
    const stopped = await inspect(context, { preparedOnly: true });
    if (!stopped || stopped.status !== "Stopped") throw fault("LXD core still has running processes.", "core_processes_running", 503);
    const state = JSON.parse((await run(["query", `/1.0/instances/${name(context)}/state`])).stdout);
    if (state.pid !== 0 || state.processes !== 0 || state.status !== "Stopped") throw fault("LXD core child-empty proof failed.", "core_processes_running", 503);
    return proof(context, neverStarted);
  }
  async function connect(context) {
    const value = await inspect(context), id = await readFile(join(context.directory, "lxd-instance-id"), "utf8");
    if (value?.status !== "Running" || value.config["volatile.uuid"] !== id) throw fault("LXD relay identity is not the admitted container.", "core_identity_mismatch", 409);
    // Recheck the actual listener, not merely the original command arguments.
    await run(args(context, ["/opt/openvscode/node", "-e", LOOPBACK_PROOF]));
    const child = spawn("lxc", args(context, ["/opt/openvscode/node", "-e", "const s=require('net').connect(3000,'127.0.0.1');s.on('error',()=>process.exit(1));s.pipe(process.stdout);process.stdin.pipe(s);process.stdin.on('end',()=>s.end())"]),
      { stdio: ["pipe", "pipe", "ignore"], shell: false, env: lxcClientEnvironment() });
    const socket = Duplex.from({ readable: child.stdout, writable: child.stdin });
    child.on("error", error => socket.destroy(error)); socket.on("close", () => child.kill("SIGTERM"));
    return { socket, tokenMode: "private-loopback-without-connection-token" };
  }
  return { upstream: OPENVSCODE_X64, start, stop, connect, inspect, prepareProjectDirectory: projectStorage?.prepare };
}
export function assertLxdIsolation(value, context, { artifactRoot, imageFingerprint, storagePool, profileName, networkName, acl }) {
  assertLxdIdentity(value, context, { imageFingerprint, profileName });
  const config = value.expanded_config || {}, devices = value.expanded_devices || {};
  if (value.name !== `ynx-core-${context.identityDigest.slice(0, 32)}` || value.config?.["user.ynx.core.identity"] !== context.identityDigest ||
    value.config?.["user.ynx.core.runtime"] !== context.runtimeId || value.config?.["volatile.base_image"] !== imageFingerprint ||
    value.profiles?.length !== 1 || value.profiles[0] !== profileName || config["security.privileged"] !== "false" || config["security.nesting"] !== "false" ||
    config["security.devlxd"] !== "false" || config["security.idmap.isolated"] !== "true" || config["raw.lxc"] || config["raw.idmap"] ||
    config["limits.cpu"] !== String(context.limits.cpus) || config["limits.memory"] !== String(context.limits.memoryBytes) || config["limits.processes"] !== String(context.limits.pids) ||
    Object.keys(devices).sort().join(",") !== "core,eth0,project,root" ||
    devices.root.type !== "disk" || devices.root.pool !== storagePool || devices.root.path !== "/" || devices.root.size !== "4GiB" ||
    devices.core.type !== "disk" || devices.core.path !== "/opt/openvscode" || devices.core.source !== artifactRoot || devices.core.readonly !== "true" ||
    devices.project.type !== "disk" || devices.project.path !== "/project" || devices.project.source !== context.projectDirectory || devices.project.shift !== "true" ||
    devices.eth0.type !== "nic" || devices.eth0.network !== networkName || devices.eth0["security.acls"] !== acl)
    throw fault("LXD core isolation changed or has an unapproved device/network/host path.", "core_isolation_invalid", 503);
}
function assertLxdIdentity(value, context, { imageFingerprint, profileName }) {
  if (value.name !== `ynx-core-${context.identityDigest.slice(0, 32)}` || value.config?.["user.ynx.core.identity"] !== context.identityDigest ||
    value.config?.["user.ynx.core.runtime"] !== context.runtimeId || value.config?.["volatile.base_image"] !== imageFingerprint ||
    !/^[a-f0-9-]{36}$/.test(value.config?.["volatile.uuid"] || "") || value.profiles?.length !== 1 || value.profiles[0] !== profileName)
    throw fault("LXD core identity is not the exact prepared instance.", "core_identity_mismatch", 409);
}
const LOOPBACK_PROOF = "const f=require('fs'),h=require('http');let n=0;function c(){const t=f.readFileSync('/proc/net/tcp','utf8')+f.readFileSync('/proc/net/tcp6','utf8');const l=t.split('\\n').filter(x=>x.trim().split(/\\s+/)[1]?.endsWith(':0BB8')&&x.trim().split(/\\s+/)[3]==='0A');if(l.some(x=>x.trim().split(/\\s+/)[1]!=='0100007F:0BB8'))process.exit(2);h.get('http://127.0.0.1:3000/',r=>process.exit(l.length===1&&r.statusCode===200?0:1)).on('error',()=>{if(++n<30)setTimeout(c,200);else process.exit(1)})}c()";
function proof(context, neverStarted) { return { stopped: true, neverStarted, runtimeId: context.runtimeId, identityDigest: context.identityDigest }; }
async function runLxc(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("lxc", args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: lxcClientEnvironment() }); let stdout = "";
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-1024 * 1024); }); child.stderr.resume();
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(fault("LXD core command timed out; preserve its exact recovery identity.", "core_driver_timeout", 503)); }, 30000);
    child.on("error", () => { clearTimeout(timer); reject(fault("LXD core driver is unavailable.", "core_driver_unavailable", 503)); });
    child.on("close", code => { clearTimeout(timer); if (code) reject(fault("LXD core command failed.", "core_driver_failed", 503)); else resolve({ stdout }); });
  });
}
