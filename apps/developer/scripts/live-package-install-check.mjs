import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";

const base = process.env.YNX_CODE_CHECK_BASE || "http://127.0.0.1:18113";
const stateFile = process.env.YNX_CODE_CHECK_STATE || "/var/lib/ynx-code-candidate/.package-persistence-probe";
const phase = process.argv[2] || "full";
const projectId = "public-package-persistence-probe";

async function session() {
  const response = await fetch(`${base}/runtime/health`), value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.sandboxReady, true);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Gateway did not issue a signed workspace session.");
  return cookie;
}

async function json(cookie, path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { cookie, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
  }), value = await response.json();
  assert.equal(response.status, options.expectedStatus || 200, `${path}: ${JSON.stringify(value)}`);
  return value;
}

const task = (activePath, source) => ({
  protocolVersion: "ynx-code-runtime/v1",
  approval: "execute-container-once",
  projectId,
  activePath,
  files: { [activePath]: source },
});

async function removeLease(state) {
  if (!state?.cookie || !/^[a-f0-9]{24}$/.test(state.runtimeId || "")) return;
  try { await json(state.cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}`, { method: "DELETE" }); } catch {}
}

if (phase === "prepare") {
  const cookie = await session(), packageJson = '{"name":"ynx-public-package-probe","version":"1.0.0","private":true}\n';
  const created = await json(cookie, "/runtime/profiles/lxd/leases", {
    method: "POST",
    expectedStatus: 201,
    body: JSON.stringify({ protocolVersion: "ynx-code-runtime/v1", approval: "create-container-once", projectId, image: "ubuntu-24.04" }),
  });
  const state = { cookie, runtimeId: created.runtime.runtimeId, projectId };
  try {
    assert.equal(created.runtime.evidence.network, "disabled");
    const npm = await json(cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}/packages`, {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "ynx-code-runtime/v1", approval: "install-package-once", projectId,
        packageSpec: "kleur@4.1.5", packageJson,
        workspaceBytes: Buffer.byteLength(packageJson), workspaceFileCount: 1,
        previousPackageJsonBytes: Buffer.byteLength(packageJson), previousPackageLockBytes: 0,
        hasPackageJson: true, hasPackageLock: false,
      }),
    });
    assert.equal(npm.manager, "npm");
    assert.equal(npm.scripts, false);
    assert.equal(npm.network.restored, true);
    assert.equal(JSON.parse(npm.packageJson).dependencies.kleur, "4.1.5");
    assert.match(npm.packageLock, /"lockfileVersion"/);
    const npmRun = await json(cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}/tasks`, {
      method: "POST",
      body: JSON.stringify(task("src/main.js", 'console.log(require("kleur").green("YNX_NPM_PACKAGE_OK"))')),
    });
    assert.equal(npmRun.ok, true, npmRun.output);
    assert.match(npmRun.output, /YNX_NPM_PACKAGE_OK/);
    assert.equal(npmRun.sandbox.network, false);

    const npmBytes = Buffer.byteLength(npm.packageJson) + Buffer.byteLength(npm.packageLock);
    const python = await json(cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}/packages`, {
      method: "POST",
      body: JSON.stringify({
        protocolVersion: "ynx-code-runtime/v1", approval: "install-package-once", ecosystem: "python", projectId,
        packageSpec: "colorama==0.4.6", workspaceBytes: npmBytes, workspaceFileCount: 2,
        previousRequirementsBytes: 0, hasRequirementsLock: false,
      }),
    });
    assert.equal(python.manager, "pip");
    assert.equal(python.binaryOnly, true);
    assert.equal(python.buildScripts, false);
    assert.equal(python.network.restored, true);
    assert.match(python.requirementsLock, /^colorama==0\.4\.6 --hash=sha256:[a-f0-9]{64}\n$/);
    const pythonRun = await json(cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}/tasks`, {
      method: "POST",
      body: JSON.stringify(task("src/main.py", 'import colorama; print(colorama.Fore.GREEN + "YNX_PYTHON_PACKAGE_OK" + colorama.Style.RESET_ALL)')),
    });
    assert.equal(pythonRun.ok, true, pythonRun.output);
    assert.match(pythonRun.output, /YNX_PYTHON_PACKAGE_OK/);
    assert.equal(pythonRun.sandbox.network, false);
    const workspaceFiles = {
      "package.json": npm.packageJson,
      "package-lock.json": npm.packageLock,
      "requirements.ynx.lock": python.requirementsLock,
      "src/main.js": 'console.log(require("kleur").green("YNX_NPM_PACKAGE_RESTART_OK"))\n',
      "src/main.py": 'import colorama; print(colorama.Fore.GREEN + "YNX_PYTHON_PACKAGE_RESTART_OK" + colorama.Style.RESET_ALL)\n',
    };
    const workspace = await json(cookie, `/runtime/workspaces/${projectId}`, {
      method: "PUT",
      body: JSON.stringify({
        protocolVersion: "ynx-code/v1", expectedRevision: 0, idempotencyKey: "package-persistence-probe-0001",
        workspace: { name: "Package persistence probe", folders: ["src"], files: workspaceFiles, open: ["src/main.js", "src/main.py"], active: "src/main.py" },
      }),
    });
    assert.equal(workspace.workspace.revision, 1);
    await writeFile(stateFile, `${JSON.stringify({ ...state, packageJson: npm.packageJson, packageLock: npm.packageLock, pythonLock: python.requirementsLock })}\n`, { mode: 0o600, flag: "wx" });
    console.log(`YNX Code package probe installed npm and SHA-256-bound Python dependencies into runtime ${state.runtimeId}; temporary egress was removed.`);
  } catch (error) {
    await removeLease(state);
    throw error;
  }
  process.exit(0);
}

const state = JSON.parse(await readFile(stateFile, "utf8"));
if (phase === "cleanup") {
  await removeLease(state);
  await rm(stateFile, { force: true });
  console.log("YNX Code package probe cleanup completed.");
  process.exit(0);
}
if (phase !== "resume") throw new Error("Usage: live-package-install-check.mjs <prepare|resume|cleanup>");

try {
  const profiles = await json(state.cookie, "/runtime/profiles");
  assert.ok(profiles.leases.some((lease) => lease.runtimeId === state.runtimeId && lease.projectId === projectId && lease.status === "running"));
  assert.match(state.pythonLock, /^colorama==0\.4\.6 --hash=sha256:[a-f0-9]{64}\n$/);
  const workspace = await json(state.cookie, `/runtime/workspaces/${projectId}`);
  assert.equal(workspace.workspace.revision, 1);
  assert.equal(workspace.workspace.files["package.json"], state.packageJson);
  assert.equal(workspace.workspace.files["package-lock.json"], state.packageLock);
  assert.equal(workspace.workspace.files["requirements.ynx.lock"], state.pythonLock);
  const npmRun = await json(state.cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}/tasks`, {
    method: "POST",
    body: JSON.stringify(task("src/main.js", 'console.log(require("kleur").green("YNX_NPM_PACKAGE_RESTART_OK"))')),
  });
  assert.equal(npmRun.ok, true, npmRun.output);
  assert.match(npmRun.output, /YNX_NPM_PACKAGE_RESTART_OK/);
  assert.equal(npmRun.sandbox.network, false);
  const pythonRun = await json(state.cookie, `/runtime/profiles/lxd/leases/${state.runtimeId}/tasks`, {
    method: "POST",
    body: JSON.stringify(task("src/main.py", 'import colorama; print(colorama.Fore.GREEN + "YNX_PYTHON_PACKAGE_RESTART_OK" + colorama.Style.RESET_ALL)')),
  });
  assert.equal(pythonRun.ok, true, pythonRun.output);
  assert.match(pythonRun.output, /YNX_PYTHON_PACKAGE_RESTART_OK/);
  assert.equal(pythonRun.sandbox.network, false);
  console.log("YNX Code npm and SHA-256-bound Python package environments survived restart and ran with network disabled.");
} finally {
  await removeLease(state);
  await rm(stateFile, { force: true });
}
