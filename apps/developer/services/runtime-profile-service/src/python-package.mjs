import { randomBytes } from "node:crypto";

const EXACT_PYTHON_PACKAGE = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})==(\d+\.\d+\.\d+(?:[A-Za-z0-9._+-]*)?)$/;
const EXACT_LOCK_LINE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}==[0-9][0-9A-Za-z.!_+-]{0,127}$/;

function fault(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}

function canonicalLock(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 256 * 1024)
    throw fault("requirements.ynx.lock exceeds the reviewed text boundary.", "invalid_python_lock", 400);
  const lines = value.split(/\r?\n/).filter(Boolean);
  if (lines.length > 64 || lines.some((line) => !EXACT_LOCK_LINE.test(line)))
    throw fault("requirements.ynx.lock must contain at most 64 exact name==version entries.", "invalid_python_lock", 400);
  return lines.sort((left, right) => left.localeCompare(right)).join("\n") + (lines.length ? "\n" : "");
}

export function validatePythonPackageInstall(value) {
  if (
    !value ||
    value.protocolVersion !== "ynx-code-runtime/v1" ||
    value.approval !== "install-package-once" ||
    value.ecosystem !== "python" ||
    typeof value.projectId !== "string" ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(value.projectId) ||
    typeof value.packageSpec !== "string" ||
    !EXACT_PYTHON_PACKAGE.test(value.packageSpec) ||
    !Number.isInteger(value.workspaceBytes) ||
    value.workspaceBytes < 0 ||
    value.workspaceBytes > 2 * 1024 * 1024 ||
    !Number.isInteger(value.workspaceFileCount) ||
    value.workspaceFileCount < 1 ||
    value.workspaceFileCount > 256 ||
    !Number.isInteger(value.previousRequirementsBytes) ||
    value.previousRequirementsBytes < 0 ||
    value.previousRequirementsBytes > value.workspaceBytes ||
    typeof value.hasRequirementsLock !== "boolean"
  )
    throw fault("A reviewed exact-version Python package request is required.", "invalid_python_package_request", 400);
  if (value.requirementsLock !== undefined && typeof value.requirementsLock !== "string")
    throw fault("Python lock content must be text.", "invalid_python_lock", 400);
  const lockPresent = Object.prototype.hasOwnProperty.call(value, "requirementsLock"),
    requirementsLock = canonicalLock(value.requirementsLock || "");
  if (value.hasRequirementsLock !== lockPresent)
    throw fault("Python lock presence does not match the reviewed workspace.", "invalid_python_lock", 400);
  return {
    manager: "pip",
    packageSpec: value.packageSpec,
    requirementsLock,
    workspaceBoundary: {
      bytes: value.workspaceBytes,
      fileCount: value.workspaceFileCount,
      previousRequirementsBytes: value.previousRequirementsBytes,
      hasRequirementsLock: value.hasRequirementsLock,
    },
  };
}

export async function installContainerPythonPackage(run, { containerName, projectId, packageSpec, requirementsLock, workspaceBoundary, packageNetwork }) {
  if (typeof packageNetwork !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(packageNetwork))
    throw fault("A reviewed LXD package-egress network is not configured.", "package_network_unavailable", 503);
  const started = performance.now(),
    installId = randomBytes(10).toString("hex"),
    base = `/opt/ynx-code-dependencies/${projectId}`,
    current = `${base}/python`,
    stage = `${base}/python-stage-${installId}`,
    previous = `${base}/python-previous-${installId}`,
    device = "ynx-package-egress";
  let attached = false, swapped = false, currentExists = false;
  try {
    try {
      await run("lxc", ["exec", containerName, "--", "test", "-x", `${current}/bin/python`], { timeout: 5_000 });
      currentExists = true;
    } catch {}
    if (currentExists) {
      if (!requirementsLock) throw fault("The persisted Python environment requires its reviewed workspace lock.", "python_lock_state_mismatch", 409);
      const installed = canonicalLock((await run("lxc", ["exec", containerName, "--", `${current}/bin/python`, "-m", "pip", "freeze", "--local", "--exclude-editable"], { timeout: 20_000, maxBuffer: 256 * 1024 })).stdout);
      if (installed !== requirementsLock) throw fault("The persisted Python environment no longer matches requirements.ynx.lock.", "python_lock_state_mismatch", 409);
      await run("lxc", ["exec", containerName, "--", "mkdir", "-p", stage], { timeout: 20_000 });
      await run("lxc", ["exec", containerName, "--", "cp", "-a", `${current}/.`, `${stage}/`], { timeout: 60_000 });
    } else {
      if (requirementsLock) throw fault("The workspace Python lock has no matching persisted environment.", "python_lock_state_mismatch", 409);
      await run("lxc", ["exec", containerName, "--", "python3", "-m", "venv", "--copies", stage], { timeout: 60_000 });
    }
    try {
      await run("lxc", ["config", "device", "add", containerName, device, "nic", "network", packageNetwork], { timeout: 20_000 });
      attached = true;
    } catch {
      try { await run("lxc", ["stop", containerName, "--force"], { timeout: 30_000 }); } catch {}
      throw fault("Package egress could not be established from a known isolated state; the runtime was stopped.", "package_network_state_unknown", 503);
    }
    const value = await run("lxc", ["exec", containerName, "--env", `HOME=${stage}`, "--env", `PIP_CACHE_DIR=${stage}/.pip-cache`, "--", `${stage}/bin/python`, "-m", "pip", "install", "--only-binary=:all:", "--disable-pip-version-check", "--no-input", packageSpec], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    await run("lxc", ["exec", containerName, "--", "rm", "-rf", `${stage}/.pip-cache`], { timeout: 20_000 });
    const lock = canonicalLock((await run("lxc", ["exec", containerName, "--", `${stage}/bin/python`, "-m", "pip", "freeze", "--local", "--exclude-editable"], { timeout: 20_000, maxBuffer: 256 * 1024 })).stdout),
      size = Number((await run("lxc", ["exec", containerName, "--", "du", "-sk", stage], { timeout: 20_000, maxBuffer: 64 * 1024 })).stdout.trim().split(/\s+/)[0]) * 1024,
      nextFiles = workspaceBoundary.fileCount + (workspaceBoundary.hasRequirementsLock ? 0 : 1),
      nextBytes = workspaceBoundary.bytes - workspaceBoundary.previousRequirementsBytes + Buffer.byteLength(lock);
    if (!Number.isSafeInteger(size) || size < 0 || size > 512 * 1024 * 1024)
      throw fault("Installed Python dependencies exceed the 512 MiB project boundary.", "package_store_too_large", 413);
    if (nextFiles > 256 || nextBytes > 2 * 1024 * 1024)
      throw fault("Updated Python package metadata exceeds the persistent workspace boundary.", "package_metadata_too_large", 413);
    if (currentExists) await run("lxc", ["exec", containerName, "--", "mv", current, previous], { timeout: 20_000 });
    await run("lxc", ["exec", containerName, "--", "mv", stage, current], { timeout: 20_000 });
    swapped = true;
    if (currentExists) try { await run("lxc", ["exec", containerName, "--", "rm", "-rf", previous], { timeout: 20_000 }); } catch {}
    return {
      ok: true,
      packageSpec,
      manager: "pip",
      buildScripts: false,
      binaryOnly: true,
      scope: "project-container",
      bytes: size,
      output: `${value.stdout}${value.stderr}`.slice(0, 1024 * 1024),
      requirementsLock: lock,
      durationMs: Math.round(performance.now() - started),
      network: { temporary: true, restored: true },
    };
  } catch (error) {
    try { await run("lxc", ["exec", containerName, "--", "rm", "-rf", stage], { timeout: 20_000 }); } catch {}
    if (!swapped && currentExists) try {
      await run("lxc", ["exec", containerName, "--", "test", "-e", previous], { timeout: 5_000 });
      await run("lxc", ["exec", containerName, "--", "mv", previous, current], { timeout: 20_000 });
    } catch {}
    throw error;
  } finally {
    if (attached) try {
      await run("lxc", ["config", "device", "remove", containerName, device], { timeout: 20_000 });
    } catch {
      try { await run("lxc", ["stop", containerName, "--force"], { timeout: 30_000 }); } catch {}
      throw fault("Package network cleanup failed; the runtime was stopped.", "package_network_cleanup_failed", 503);
    }
  }
}
