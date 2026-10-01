import { spawn } from "node:child_process";
import { Duplex } from "node:stream";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, lstat, realpath, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { OPENVSCODE } from "./upstream.mjs";
import { fault } from "./central-identity.mjs";

// Private execution driver. No listening host port, host socket, profile or
// credential mounts. The core listens only on its container's loopback; A's
// authenticated proxy opens a stdio relay inside this exact container.
export function createDockerCoreDriver({ artifactRoot, archivePath, licensePath, noticesPath,
  quotaForDirectory, networkAdmission, brandingRoot = fileURLToPath(new URL("../../../native/ynx-brand", import.meta.url)), run = runCommand, executable = "docker" } = {}) {
  if (!artifactRoot || !archivePath || !licensePath || !noticesPath)
    throw new TypeError("Official archive, notices and extracted runtime are required.");
  artifactRoot = resolve(artifactRoot);
  const name = context => `ynx-core-${context.identityDigest.slice(0, 32)}`;
  const receiptPath = context => join(context.directory, "runtime-receipt.json");

  async function preflight(context) {
    if (context.image.sha256 !== OPENVSCODE.sha256 || context.image.architecture !== "linux-arm64")
      throw fault("Native IDE architecture is not approved by this driver.", "core_architecture_unverified", 503);
    for (const [path, digest] of [[archivePath, OPENVSCODE.sha256], [licensePath, OPENVSCODE.licenseSha256], [noticesPath, OPENVSCODE.noticesSha256]]) {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || createHash("sha256").update(await readFile(path)).digest("hex") !== digest)
        throw fault("Native IDE upstream artifact or license failed verification.", "core_upstream_mismatch", 503);
    }
    if ((await realpath(artifactRoot)) !== artifactRoot || (await lstat(artifactRoot)).isSymbolicLink())
      throw fault("Native IDE runtime mount must have an exact real path.", "core_state_unsafe", 503);
    const product = JSON.parse(await readFile(join(artifactRoot, "product.json"), "utf8"));
    if (product.commit !== OPENVSCODE.commit || product.extensionsGallery?.serviceUrl !== OPENVSCODE.marketplace)
      throw fault("Extracted native IDE does not match the pinned core/gallery.", "core_upstream_mismatch", 503);
    // Host source/user-data/extensions are bind mounts. Docker's container disk
    // option cannot limit those: require a real host quota from A, fail closed.
    const quota = await quotaForDirectory?.(context.projectDirectory);
    if (!quota || quota.enforced !== true || quota.directory !== await realpath(context.projectDirectory) ||
      !Number.isSafeInteger(quota.maxBytes) || quota.maxBytes > context.limits.diskBytes || quota.maxBytes < 1)
      throw fault("An enforced per-project filesystem quota is required.", "core_disk_quota_unavailable", 503);
    const network = await networkAdmission?.(context);
    if (!network || network.enforced !== true || network.denyHost !== true || network.allowlisted !== true ||
      !/^ynx-core-egress-[a-z0-9-]{1,48}$/.test(network.networkName || "") || !/^[a-f0-9]{64}$/.test(network.policyDigest || ""))
      throw fault("An enforced package/OpenVSX egress network denying host and private services is required.", "core_egress_unavailable", 503);
    return network;
  }

  async function inspect(context) {
    const result = await run(executable, ["inspect", name(context)], { allowFailure: true });
    if (result.code !== 0) {
      // A transport/daemon error is not absence proof.
      if (/No such (object|container):/.test(result.stderr)) return null;
      throw fault("Native IDE runtime identity could not be inspected.", "core_identity_unconfirmed", 503);
    }
    let value; try { value = JSON.parse(result.stdout)[0]; } catch { throw fault("Native IDE runtime identity response is invalid.", "core_identity_unconfirmed", 503); }
    if (value?.Name !== `/${name(context)}` || value.Config?.Labels?.["ynx.core.identity"] !== context.identityDigest ||
      value.Config.Labels["ynx.core.runtime"] !== context.runtimeId || value.Config.Image !== OPENVSCODE.baseImage)
      throw fault("Native IDE runtime identity changed; nothing was stopped.", "core_identity_mismatch", 409);
    const receipt = JSON.parse(await readFile(receiptPath(context), "utf8"));
    assertContainerIsolation(value, context, { artifactRoot, networkName: receipt.networkName });
    return value;
  }

  async function start(context) {
    const network = await preflight(context);
    for (const dir of ["user-data", "extensions"]) await mkdir(join(context.projectDirectory, dir), { recursive: true, mode: 0o700 });
    const brandTarget = join(context.projectDirectory, "extensions", "ynx.ynx-developer-brand-0.1.0");
    try { await lstat(brandTarget); }
    catch (error) { if (error.code !== "ENOENT") throw error; await cp(brandingRoot, brandTarget, { recursive: true, errorOnExist: true, force: false }); }
    for (const file of ["package.json", "klein-light.json", "ynx-logo.png", "LICENSE.txt"]) {
      if (!(await readFile(join(brandingRoot, file))).equals(await readFile(join(brandTarget, file))))
        throw fault("YNX branding extension changed. Review it before replacing user files.", "core_brand_review_required", 409);
    }
    const settingsDirectory = join(context.projectDirectory, "user-data", "User");
    await mkdir(settingsDirectory, { recursive: true, mode: 0o700 });
    try { await writeFile(join(settingsDirectory, "settings.json"), JSON.stringify({
      "workbench.colorTheme": "YNX Klein Light", "window.title": "YNX Developer — ${activeEditorShort}${separator}${folderName}",
      "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
    }), { flag: "wx", mode: 0o600 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
    const before = { identityDigest: context.identityDigest, runtimeId: context.runtimeId, name: name(context),
      phase: "prepared", image: OPENVSCODE.baseImage, source: OPENVSCODE.commit,
      networkName: network.networkName, networkPolicyDigest: network.policyDigest,
      tokenMode: "private-loopback-without-connection-token" };
    await writeFile(receiptPath(context), JSON.stringify(before), { mode: 0o600, flag: "wx" });
    const uid = process.getuid?.(), gid = process.getgid?.();
    if (!Number.isInteger(uid) || uid === 0 || !Number.isInteger(gid))
      throw fault("The native IDE provisioner must use a dedicated non-root project-volume owner.", "core_nonroot_required", 503);
    await run(executable, ["create", "--platform", "linux/arm64", "--name", name(context),
      "--label", `ynx.core.identity=${context.identityDigest}`, "--label", `ynx.core.runtime=${context.runtimeId}`,
      "--init", "--network", network.networkName, "--user", `${uid}:${gid}`, "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=268435456", "--memory", String(context.limits.memoryBytes),
      "--cpus", String(context.limits.cpus), "--pids-limit", String(context.limits.pids),
      "--mount", `type=bind,src=${artifactRoot},dst=/opt/openvscode,readonly`,
      "--mount", `type=bind,src=${join(context.projectDirectory, "workspace")},dst=/workspace`,
      "--mount", `type=bind,src=${join(context.projectDirectory, "user-data")},dst=/user-data`,
      "--mount", `type=bind,src=${join(context.projectDirectory, "extensions")},dst=/extensions`,
      "--env", "HOME=/user-data", OPENVSCODE.baseImage, "/opt/openvscode/bin/openvscode-server",
      "--host", "127.0.0.1", "--port", "3000", "--without-connection-token",
      "--default-folder", "/workspace",
      "--user-data-dir", "/user-data", "--extensions-dir", "/extensions", "--disable-telemetry"]);
    const created = await inspect(context);
    if (!created || !/^[a-f0-9]{64}$/.test(created.Id || "")) throw fault("Native IDE container creation was not confirmed.", "core_identity_unconfirmed", 503);
    await writeFile(join(context.directory, "container-id"), created.Id, { mode: 0o600, flag: "wx" });
    await run(executable, ["start", created.Id]);
    const started = await inspect(context);
    if (!started?.State?.Running) throw fault("Native IDE process did not remain running.", "core_launch_failed", 503);
    // Confirm real listening server through container loopback, not package presence.
    await run(executable, ["exec", created.Id, "/opt/openvscode/node", "-e",
      "const http=require('http'),fs=require('fs');let n=0;function check(){const tcp=fs.readFileSync('/proc/net/tcp','utf8')+fs.readFileSync('/proc/net/tcp6','utf8');const lines=tcp.split('\\n').filter(x=>x.trim().split(/\\s+/)[1]?.endsWith(':0BB8')&&x.trim().split(/\\s+/)[3]==='0A');if(lines.some(x=>x.trim().split(/\\s+/)[1]!=='0100007F:0BB8'))process.exit(2);http.get('http://127.0.0.1:3000/',r=>process.exit(lines.length===1&&r.statusCode===200?0:1)).on('error',()=>{if(++n<30)setTimeout(check,200);else process.exit(1)})}check()"]);
    return { running: true, runtimeId: context.runtimeId };
  }

  async function stop(context) {
    let receipt;
    try { receipt = JSON.parse(await readFile(receiptPath(context), "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT") throw fault("Native IDE launch receipt is unreadable.", "core_identity_unconfirmed", 503);
      // Exact random name + daemon-confirmed absence is safe even after preflight
      // failed before preparing. Never assume absence from a missing local file.
      if (await inspect(context)) throw fault("Native IDE has no trusted launch receipt.", "core_identity_unconfirmed", 503);
      return proof(context, true);
    }
    if (receipt.identityDigest !== context.identityDigest || receipt.runtimeId !== context.runtimeId)
      throw fault("Native IDE launch receipt changed.", "core_identity_mismatch", 409);
    const current = await inspect(context);
    if (!current) {
      try { await readFile(join(context.directory, "container-id")); }
      catch (error) { if (error.code === "ENOENT") return proof(context, true); throw error; }
      throw fault("A launched runtime disappeared; retain its recovery until reviewed.", "core_identity_unconfirmed", 503);
    }
    let exactId;
    try { exactId = await readFile(join(context.directory, "container-id"), "utf8"); }
    catch {
      if (!current.State.Running && current.State.Pid === 0 && current.State.StartedAt === "0001-01-01T00:00:00Z") return proof(context, true);
      throw fault("Native IDE has no confirmed container identity.", "core_identity_unconfirmed", 503);
    }
    if (exactId !== current.Id) throw fault("Native IDE container identity changed.", "core_identity_mismatch", 409);
    if (current.State.Running) await run(executable, ["stop", "--time", "10", exactId]);
    const stopped = await inspect(context);
    if (!stopped || stopped.State.Running || stopped.State.Pid !== 0)
      throw fault("Native IDE still has running processes.", "core_processes_running", 503);
    const top = await run(executable, ["top", exactId], { allowFailure: true });
    if (top.code === 0 && top.stdout.trim().split(/\r?\n/).length > 1)
      throw fault("Native IDE descendants are still running.", "core_processes_running", 503);
    if (top.code !== 0 && !/is not running/i.test(top.stderr))
      throw fault("Native IDE child-empty proof is unavailable.", "core_processes_unconfirmed", 503);
    return proof(context, current.State.StartedAt === "0001-01-01T00:00:00Z");
  }
  async function connect(context) {
    const current = await inspect(context), exactId = await readFile(join(context.directory, "container-id"), "utf8");
    if (!current?.State?.Running || current.Id !== exactId) throw fault("Native IDE container is not the admitted runtime.", "core_identity_mismatch", 409);
    const child = spawn(executable, ["exec", "-i", exactId, "/opt/openvscode/node", "-e",
      "const n=require('net');const s=n.connect(3000,'127.0.0.1');s.on('error',()=>process.exit(1));s.pipe(process.stdout);process.stdin.pipe(s);process.stdin.on('end',()=>s.end())"],
      { stdio: ["pipe", "pipe", "ignore"], shell: false });
    const socket = Duplex.from({ readable: child.stdout, writable: child.stdin });
    child.on("error", error => socket.destroy(error));
    socket.on("close", () => child.kill("SIGTERM"));
    return { socket, tokenMode: "private-loopback-without-connection-token" };
  }
  return { start, stop, inspect, connect };
}
export function assertContainerIsolation(value, context, { artifactRoot, networkName }) {
  const host = value.HostConfig, config = value.Config, networks = Object.keys(value.NetworkSettings?.Networks || {}), cmd = config?.Cmd || [];
  const expected = new Map([["/opt/openvscode", { source: artifactRoot, rw: false }],
    ["/workspace", { source: join(context.projectDirectory, "workspace"), rw: true }],
    ["/user-data", { source: join(context.projectDirectory, "user-data"), rw: true }],
    ["/extensions", { source: join(context.projectDirectory, "extensions"), rw: true }]]);
  const mounts = value.Mounts || [];
  if (!host || host.Privileged !== false || host.ReadonlyRootfs !== true || host.NetworkMode !== networkName ||
    !/^ynx-core-egress-[a-z0-9-]{1,48}$/.test(networkName || "") || networks.length !== 1 || networks[0] !== networkName ||
    Object.keys(host.PortBindings || {}).length || Object.values(value.NetworkSettings?.Ports || {}).some(port => port !== null) ||
    [host.PidMode, host.IpcMode, host.UTSMode].some(mode => mode === "host" || String(mode).startsWith("container:")) ||
    !host.CapDrop?.includes("ALL") || host.CapAdd?.length || !host.SecurityOpt?.includes("no-new-privileges") ||
    host.Devices?.length || host.DeviceRequests?.length || host.Binds?.length ||
    host.Memory !== context.limits.memoryBytes || host.PidsLimit !== context.limits.pids || host.NanoCpus !== context.limits.cpus * 1e9 ||
    !/^[1-9][0-9]*:[0-9]+$/.test(config.User || "") || !cmd.includes("--without-connection-token") ||
    cmd.includes("--connection-token") || cmd.includes("--connection-token-file") ||
    cmd[cmd.indexOf("--host") + 1] !== "127.0.0.1" || cmd[cmd.indexOf("--port") + 1] !== "3000" ||
    mounts.length !== expected.size || mounts.some(mount => mount.Type !== "bind" || !expected.has(mount.Destination) ||
      expected.get(mount.Destination).source !== mount.Source || expected.get(mount.Destination).rw !== mount.RW))
    throw fault("Native IDE container isolation changed or has a direct access path. Launch/proxy is denied.", "core_isolation_invalid", 503);
}
function proof(context, neverStarted) { return { stopped: true, neverStarted, runtimeId: context.runtimeId, identityDigest: context.identityDigest }; }
async function runCommand(command, args, { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(fault("Native IDE provisioning timed out; preserve runtime identity for retry.", "core_driver_timeout", 503)); }, 15000);
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-65536); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-65536); });
    child.on("error", () => { clearTimeout(timer); reject(fault("Native IDE execution driver is unavailable.", "core_driver_unavailable", 503)); });
    child.on("close", code => { clearTimeout(timer); if (code && !allowFailure) reject(fault("Native IDE runtime command failed.", "core_driver_failed", 503)); else resolve({ code, stdout, stderr }); });
  });
}
