import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

const base = process.env.YNX_CODE_CHECK_BASE || "http://127.0.0.1:18113";
const stateFile = process.env.YNX_CODE_CHECK_STATE || "/var/lib/ynx-code-candidate/.persistence-probe";
const phase = process.argv[2] || "full";

async function session() {
  const response = await fetch(`${base}/runtime/health`);
  const value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.sandboxReady, true);
  for (const language of ["cpp", "javascript", "typescript", "python", "go", "rust", "solidity"])
    assert.equal(value.compilers[language], true, `${language} compiler missing`);
  if (Object.hasOwn(value.compilers, "java"))
    assert.equal(typeof value.compilers.java, "boolean", "Java compiler capability must be a boolean when advertised.");
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
async function json(cookie, path, options = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers: { cookie, ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    });
  } catch (error) {
    throw new Error(`${path} fetch failed: ${error?.cause?.code || error?.message || "network error"}`, { cause: error });
  }
  const value = await response.json();
  assert.equal(response.status, options.expectedStatus || 200, `${path}: ${JSON.stringify(value)}`);
  return value;
}
const task = (projectId, activePath, source) => ({
  protocolVersion: "ynx-code/v1",
  task: "build-run-active",
  projectId,
  activePath,
  files: { [activePath]: source },
  approval: "execute-once",
});
const workspace = (marker) => ({
  name: `Persistence ${marker}`,
  folders: ["src"],
  files: { "src/probe.txt": marker },
  open: ["src/probe.txt"],
  active: "src/probe.txt",
});

if (phase === "prepare") {
  const cookie = await session();
  const value = await json(cookie, "/runtime/workspaces/public-persistence-probe", {
    method: "PUT",
    body: JSON.stringify({ protocolVersion: "ynx-code/v1", expectedRevision: 0, idempotencyKey: "candidate-persistence-0001", workspace: workspace("before-restart") }),
  });
  assert.equal(value.workspace.revision, 1);
  await writeFile(stateFile, cookie, { mode: 0o600, flag: "wx" });
  console.log("YNX Code persistence probe prepared at revision 1.");
  process.exit(0);
}
if (phase === "resume") {
  const cookie = (await readFile(stateFile, "utf8")).trim();
  const value = await json(cookie, "/runtime/workspaces/public-persistence-probe");
  assert.equal(value.workspace.revision, 1);
  assert.equal(value.workspace.files["src/probe.txt"], "before-restart");
  await rm(stateFile, { force: true });
  console.log("YNX Code workspace and signed session survived a service restart.");
  process.exit(0);
}

const page = await fetch(`${base}/`);
assert.equal(page.status, 200);
assert.match(page.headers.get("content-security-policy") || "", /object-src 'none'/);
assert.match(await page.text(), /<div id="root"><\/div>/);

const cookie = await session();
const compilers = [
  ["cpp", "src/main.cpp", '#include <iostream>\nint main(){std::cout<<"YNX-LIVE-CPP";}'],
  ["javascript", "src/main.js", 'console.log("YNX-LIVE-JS")'],
  ["typescript", "src/main.ts", 'const value:number=42; console.log(`YNX-LIVE-TS-${value}`);'],
  ["python", "src/main.py", 'print("YNX-LIVE-PY")'],
  ["go", "src/main.go", 'package main\nimport "fmt"\nfunc main(){fmt.Print("YNX-LIVE-GO")}'],
  ["rust", "src/main.rs", 'fn main(){println!("YNX-LIVE-RUST");}'],
  ["solidity", "contracts/Counter.sol", '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20; contract Counter { uint256 public value; function set(uint256 next) external { value=next; } }'],
];
for (const [language, activePath, source] of compilers) {
  const value = await json(cookie, "/runtime/tasks", { method: "POST", body: JSON.stringify(task(`live-${language}`, activePath, source)) });
  assert.equal(value.ok, true, `${language}: ${value.output}`);
  assert.equal(value.language, language);
  assert.equal(value.sandbox.network, false);
}

const languageRequests = [
  ["cpp", { files: { "src/main.c": "int add(int a,int b){return a+b;}\nint main(void){return ad;}" }, activePath: "src/main.c", operation: "completion", position: { line: 1, character: 25 } }],
  ["cpp", { files: { "src/main.cpp": "int add(int a,int b){return a+b;}\nint main(){return ad;}" }, activePath: "src/main.cpp", operation: "completion", position: { line: 1, character: 20 } }],
  ["typescript", { files: { "src/main.ts": "function add(a:number,b:number){return a+b}\nad" }, activePath: "src/main.ts", operation: "completion", position: { line: 1, character: 2 } }],
  ["python", { files: { "src/main.py": "def add(a: int,b: int)->int: return a+b\nad" }, activePath: "src/main.py", operation: "completion", position: { line: 1, character: 2 } }],
  ["go", { files: { "main.go": "package main\nimport \"fmt\"\nfunc main(){ fmt.Pr }" }, activePath: "main.go", operation: "completion", position: { line: 2, character: 20 } }],
  ["rust", { files: { "Cargo.toml": "[package]\nname='probe'\nversion='0.1.0'\nedition='2021'\n", "src/main.rs": "fn main(){ let values=Vec::<i32>::new(); values. }" }, activePath: "src/main.rs", operation: "completion", position: { line: 0, character: 48 } }],
  ["solidity", { files: { "contracts/Counter.sol": "pragma solidity ^0.8.20; contract Counter { uint value; function set(uint next) external { val } }" }, activePath: "contracts/Counter.sol", operation: "completion", position: { line: 0, character: 94 } }],
];
for (const [language, request] of languageRequests) {
  const value = await json(cookie, `/runtime/language/${language}`, { method: "POST", body: JSON.stringify({ protocolVersion: "ynx-code/v1", projectId: `lsp-${language}`, ...request }) });
  assert.equal(value.language, language);
  assert.equal(value.sandbox.network, false);
}

const concurrent = await Promise.all(Array.from({ length: 12 }, async (_, index) => {
  const userCookie = await session();
  return json(userCookie, "/runtime/tasks", { method: "POST", body: JSON.stringify(task(`concurrent-${index}`, "src/main.js", `console.log("TENANT-${index}")`)) });
}));
assert.equal(concurrent.filter((value, index) => value.ok && value.output.includes(`TENANT-${index}`)).length, 12);

const tenantA = await session(), tenantB = await session();
for (const [tenant, marker] of [[tenantA, "tenant-a"], [tenantB, "tenant-b"]])
  await json(tenant, "/runtime/workspaces/shared-name", { method: "PUT", body: JSON.stringify({ protocolVersion: "ynx-code/v1", expectedRevision: 0, idempotencyKey: `isolation-${marker}-0001`, workspace: workspace(marker) }) });
assert.equal((await json(tenantA, "/runtime/workspaces/shared-name")).workspace.files["src/probe.txt"], "tenant-a");
assert.equal((await json(tenantB, "/runtime/workspaces/shared-name")).workspace.files["src/probe.txt"], "tenant-b");

const chain = await json(cookie, "/runtime/chain/status");
assert.equal(chain.status.chainId, 6423);
assert.equal(chain.status.catchingUp, false);
const wallet = await json(cookie, "/runtime/wallet/readiness");
assert.equal(wallet.developerBinding.attested, true);
assert.equal(wallet.gateway.remoteDeployed, false);
assert.equal(wallet.gateway.publicDeploymentReady, false);
const models = await json(cookie, "/runtime/models");
assert.equal(models.hosted.available, true);
assert.equal(models.hosted.model, "qwen3:4b");
let agent;
for (let attempt = 0; attempt < 3 && !agent; attempt++) {
  const aiProjectId = `ai-live-probe-${randomUUID().replaceAll("-", "")}`;
  await json(cookie, `/runtime/workspaces/${aiProjectId}`, {
    method: "PUT",
    body: JSON.stringify({ protocolVersion: "ynx-code/v1", expectedRevision: 0, idempotencyKey: `ai-live-probe-${attempt}`, workspace: { name: "AI live probe", folders: ["src"], files: { "src/main.js": 'console.log("before")' }, open: ["src/main.js"], active: "src/main.js" } }),
  });
  const response = await fetch(`${base}/runtime/agent/runs`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code-agent/v1", projectId: aiProjectId, intent: "Return a minimal plan that changes only existing src/main.js to print after. contextPaths must be exactly [\"src/main.js\"] and createPaths/deletePaths must be empty arrays.", provider: "ynx-hosted", outputLanguage: "en", approval: "model-request-once", approvalId: randomUUID() }),
  });
  const value = await response.json();
  if (response.status === 201) agent = value;
  else {
    assert.equal(response.status, 400, `/runtime/agent/runs: ${JSON.stringify(value)}`);
    assert.equal(value.code, "unsafe_workspace_path", JSON.stringify(value));
  }
}
assert.ok(agent, "Hosted Planner returned no safe workspace plan after three isolated attempts.");
assert.equal(agent.run.status, "plan_review");
assert.ok(agent.run.plan.steps.length > 0);

console.log(`YNX Code public candidate passed 7 required host runtimes, 6 declared host LSP routes, 12 concurrent tenants, isolation, Chain ${chain.status.height}, a hosted AI Planner run and fail-closed Wallet readiness; optional Java advertisement is schema-checked here, while the protected cloud gate separately verifies all 9 runtime languages and 7 LSP routes.`);
