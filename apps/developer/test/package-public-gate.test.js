import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/live-package-install-check.mjs", import.meta.url));

function run(phase, base, stateFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, phase], {
      env: { ...process.env, YNX_CODE_CHECK_BASE: base, YNX_CODE_CHECK_STATE: stateFile },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`package gate exited ${code}: ${stderr}`)));
  });
}

test("public package gate installs npm and hashed Python dependencies, then reuses them after restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-package-public-gate-")), stateFile = join(root, "state.json"), requests = [];
  let deleted = 0, workspace;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    requests.push({ method: request.method, path: request.url, body });
    const send = (status, value, headers = {}) => { response.writeHead(status, { "content-type": "application/json", ...headers }); response.end(JSON.stringify(value)); };
    if (request.url === "/runtime/health") return send(200, { sandboxReady: true }, { "set-cookie": "ynx_session=test; HttpOnly" });
    if (request.url === "/runtime/profiles/lxd/leases" && request.method === "POST") return send(201, { runtime: { runtimeId: "a".repeat(24), evidence: { network: "disabled" } } });
    if (request.url?.endsWith("/packages")) {
      if (body.ecosystem === "python") return send(200, { manager: "pip", binaryOnly: true, buildScripts: false, network: { restored: true }, requirementsLock: `colorama==0.4.6 --hash=sha256:${"b".repeat(64)}\n` });
      return send(200, { manager: "npm", scripts: false, network: { restored: true }, packageJson: '{"dependencies":{"kleur":"4.1.5"}}\n', packageLock: '{"lockfileVersion":3}\n' });
    }
    if (request.url?.endsWith("/tasks")) {
      const marker = body.activePath.endsWith(".py") ? (body.files[body.activePath].includes("RESTART") ? "YNX_PYTHON_PACKAGE_RESTART_OK" : "YNX_PYTHON_PACKAGE_OK") : (body.files[body.activePath].includes("RESTART") ? "YNX_NPM_PACKAGE_RESTART_OK" : "YNX_NPM_PACKAGE_OK");
      return send(200, { ok: true, output: `${marker}\n`, sandbox: { network: false } });
    }
    if (request.url === "/runtime/profiles") return send(200, { leases: [{ runtimeId: "a".repeat(24), projectId: "public-package-persistence-probe", status: "running" }] });
    if (request.url === "/runtime/workspaces/public-package-persistence-probe" && request.method === "PUT") { workspace = { ...body.workspace, revision: 1 }; return send(200, { workspace }); }
    if (request.url === "/runtime/workspaces/public-package-persistence-probe" && request.method === "GET") return send(200, { workspace });
    if (request.url === `/runtime/profiles/lxd/leases/${"a".repeat(24)}` && request.method === "DELETE") { deleted++; return send(200, { removed: "a".repeat(24) }); }
    return send(404, { error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.match(await run("prepare", base, stateFile), /temporary egress was removed/);
  await access(stateFile);
  assert.equal(deleted, 0);
  assert.equal(requests.find((value) => value.body?.packageSpec === "kleur@4.1.5").body.approval, "install-package-once");
  assert.equal(requests.find((value) => value.body?.packageSpec === "colorama==0.4.6").body.ecosystem, "python");

  assert.match(await run("resume", base, stateFile), /survived restart/);
  assert.equal(deleted, 1);
  await assert.rejects(access(stateFile));
});
