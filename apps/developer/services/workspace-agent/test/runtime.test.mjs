import assert from "node:assert/strict";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceRuntime } from "../src/runtime.mjs";
import { resolveExecutable } from "../src/sandbox.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";

async function fixture(t, runtimeOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "ynx-code-test-")),
    workspaceStore = createWorkspaceStore({
      filename: join(root, "workspaces.sqlite"),
    }),
    runtime = createWorkspaceRuntime({
      root,
      sessionKey: Buffer.alloc(32, 7),
      concurrency: 4,
      queueLimit: 16,
      workspaceStore,
      ...runtimeOptions,
    }),
    server = createServer((request, response) =>
      runtime.handler(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      }),
    );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    workspaceStore.close();
    await rm(root, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${server.address().port}`, runtime };
}
async function session(url) {
  const response = await fetch(`${url}/runtime/health`),
    cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
function task(source = "int main(){return 0;}") {
  return {
    protocolVersion: "ynx-code/v1",
    task: "build-run-active",
    projectId: "cpp-project",
    activePath: "src/main.cpp",
    files: { "src/main.cpp": source },
    approval: "execute-once",
  };
}
function languageTask(activePath, source) {
  return {
    protocolVersion: "ynx-code/v1",
    task: "build-run-active",
    projectId: `language-${activePath.replaceAll(/[^A-Za-z0-9]/g, "-")}`,
    activePath,
    files: { [activePath]: source },
    approval: "execute-once",
  };
}
test("health creates an isolated guest session and reports sandbox truth", async (t) => {
  const { url } = await fixture(t, { release: "0.2.0-testnet-preview-deadbeefcafe-candidate" }),
    response = await fetch(`${url}/runtime/health`),
    value = await response.json();
  assert.equal(value.protocolVersion, "ynx-code/v1");
  assert.equal(value.sessionClass, "ephemeral-guest");
  assert.equal(value.release, "0.2.0-testnet-preview-deadbeefcafe-candidate");
  assert.equal(typeof value.sandboxReady, "boolean");
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
});
test("project environment resolves before a task starts and is reported only by revision", async (t) => {
  const secret = "task-secret-not-returned",
    calls = [],
    { url } = await fixture(t, {
      environmentResolver: async (owner, projectId) => {
        calls.push({ owner, projectId });
        return { revision: 9, environment: { TASK_SETTING: secret } };
      },
    }),
    cookie = await session(url),
    response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(languageTask("src/environment.js", "console.log(process.env.TASK_SETTING)")),
    }),
    value = await response.json();
  assert.equal(response.status, 200);
  assert.match(value.output, new RegExp(secret));
  assert.equal(value.environmentRevision, 9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectId, "language-src-environment-js");
  assert.equal(JSON.stringify(value).includes("TASK_SETTING"), false);
});
test("workspace history export and reviewed restore are authenticated and revision guarded", async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    workspace = {
      name: "Saved C++",
      folders: ["src"],
      files: { "src/main.cpp": "int main(){return 0;}" },
      open: ["src/main.cpp"],
      active: "src/main.cpp",
    },
    saved = await fetch(`${url}/runtime/workspaces/project-persist`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "ynx-code/v1",
        expectedRevision: 0,
        idempotencyKey: "save-00000001",
        workspace,
      }),
    }),
    savedValue = await saved.json();
  assert.equal(savedValue.workspace.revision, 1);
  const changedWorkspace = { ...workspace, files: { "src/main.cpp": "int main(){return 2;}" } },
    changed = await fetch(`${url}/runtime/workspaces/project-persist`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "ynx-code/v1", expectedRevision: 1, idempotencyKey: "save-00000002", workspace: changedWorkspace }),
    });
  assert.equal((await changed.json()).workspace.revision, 2);
  const loaded = await fetch(`${url}/runtime/workspaces/project-persist`, {
    headers: { cookie },
  });
  assert.equal((await loaded.json()).workspace.files["src/main.cpp"], changedWorkspace.files["src/main.cpp"]);
  const history = await fetch(`${url}/runtime/workspaces/project-persist?view=history&limit=20`, { headers: { cookie } }),
    historyValue = await history.json();
  assert.deepEqual(
    historyValue.history.revisions.map(({ revision }) => revision),
    [2, 1],
  );
  assert.equal("payload" in historyValue.history.revisions[0], false);
  assert.equal(historyValue.history.retention.maximumRevisions, 50);
  const exported = await fetch(`${url}/runtime/workspaces/project-persist?view=snapshot&revision=1`, { headers: { cookie } });
  assert.equal((await exported.json()).workspace.files["src/main.cpp"], workspace.files["src/main.cpp"]);
  const unapproved = await fetch(`${url}/runtime/workspaces/project-persist`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code/v1", action: "restore", expectedRevision: 2, sourceRevision: 1 }),
  });
  assert.equal(unapproved.status, 403);
  const stale = await fetch(`${url}/runtime/workspaces/project-persist`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ protocolVersion: "ynx-code/v1", action: "restore", approval: "restore-workspace-once", approvalId: "11111111-1111-4111-8111-111111111111", expectedRevision: 1, sourceRevision: 1, idempotencyKey: "restore-00000001" }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).currentRevision, 2);
  const restored = await fetch(`${url}/runtime/workspaces/project-persist`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ protocolVersion: "ynx-code/v1", action: "restore", approval: "restore-workspace-once", approvalId: "22222222-2222-4222-8222-222222222222", expectedRevision: 2, sourceRevision: 1, idempotencyKey: "restore-00000002" }),
    }),
    restoredValue = await restored.json();
  assert.equal(restoredValue.workspace.revision, 3);
  assert.equal(restoredValue.workspace.restoredFrom, 1);
  assert.equal(restoredValue.workspace.files["src/main.cpp"], workspace.files["src/main.cpp"]);
  const otherCookie = await session(url),
    isolated = await fetch(`${url}/runtime/workspaces/project-persist`, {
      headers: { cookie: otherCookie },
    }),
    isolatedHistory = await fetch(`${url}/runtime/workspaces/project-persist?view=history`, { headers: { cookie: otherCookie } }),
    isolatedSnapshot = await fetch(`${url}/runtime/workspaces/project-persist?view=snapshot&revision=1`, { headers: { cookie: otherCookie } });
  assert.equal(isolated.status, 404);
  assert.deepEqual((await isolatedHistory.json()).history.revisions, []);
  assert.equal(isolatedSnapshot.status, 404);
});
test("language handlers receive the authenticated owner context and remote target", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-language-context-test-")),
    seen = [],
    runtime = createWorkspaceRuntime({
      root,
      sessionKey: Buffer.alloc(32, 8),
      languageRequests: {
        cpp: async (body, context) => (
          seen.push({ body, context }),
          {
            protocolVersion: "ynx-code/v1",
            result: [],
            sandbox: { kind: "test", network: false },
          }
        ),
      },
    }),
    server = createServer((request, response) =>
      runtime.handler(request, response).then((handled) => {
        if (!handled) response.writeHead(404).end();
      }),
    );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`,
    cookie = await session(url),
    response = await fetch(`${url}/runtime/language/cpp`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "ynx-code/v1",
        projectId: "cloud-project",
        runtimeId: "0123456789abcdef01234567",
      }),
    });
  assert.equal(response.status, 200);
  assert.equal(seen[0].body.runtimeId, "0123456789abcdef01234567");
  assert.match(seen[0].context.owner, /^[a-f0-9]{64}$/);
});
test("C++ is really compiled and executed through the approved sandbox", async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(task('#include <iostream>\nint main(){std::cout << "YNX-CPP-42"; return 0;}')),
    }),
    value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.ok, true);
  assert.equal(value.language, "cpp");
  assert.match(value.output, /YNX-CPP-42/);
  assert.equal(value.sandbox.network, false);
  assert.equal(value.sandbox.writableRoot, "workspace");
  assert.equal(JSON.stringify(value).includes(tmpdir()), false);
});
test("C, JavaScript, TypeScript, Python and Go use real installed runtimes", async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    cases = [
      ["src/main.c", '#include <stdio.h>\nint main(void){printf("YNX-C-42");return 0;}', "c", /YNX-C-42/],
      ["src/main.js", 'console.log("YNX-JS-42")', "javascript", /YNX-JS-42/],
      ["src/main.ts", "const value: number = 42; console.log(`YNX-TS-${value}`);", "typescript", /YNX-TS-42/],
      ["src/main.py", 'print("YNX-PY-42")', "python", /YNX-PY-42/],
      ["src/main.go", 'package main\nimport "fmt"\nfunc main(){fmt.Print("YNX-GO-42")}', "go", /YNX-GO-42/],
    ];
  for (const [activePath, source, language, expected] of cases) {
    const response = await fetch(`${url}/runtime/tasks`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(languageTask(activePath, source)),
      }),
      value = await response.json();
    assert.equal(response.status, 200, `${activePath}: ${JSON.stringify(value)}`);
    assert.equal(value.ok, true, `${activePath}: ${value.output}`);
    assert.equal(value.language, language);
    assert.match(value.output, expected);
    assert.equal(value.sandbox.network, false);
  }
});
test("Go execution is constrained to one reviewed scheduler processor in the bounded cloud sandbox", async () => {
  const source = await readFile(new URL("../src/runtime.mjs", import.meta.url), "utf8");
  assert.match(source, /args: \["run", "-p", "1", file\], environment: \{ GOMAXPROCS: "1" \}/);
  assert.match(source, /args: \["test", "-p", "1",[\s\S]{0,300}environment: \{ GOMAXPROCS: "1" \}/);
});
test("project tests are discovered, one-time approved and run without network", async (t) => {
  const junitJar = process.env.YNX_CODE_JUNIT_CONSOLE_JAR || "/usr/local/share/ynx-code/junit-platform-console-standalone.jar",
    junitAvailable = await access(junitJar).then(() => true).catch(() => false),
    cargoAvailable = Boolean(await resolveExecutable(["cargo"])),
    hardhatAvailable = await access(new URL("../../../../../node_modules/hardhat/package.json", import.meta.url)).then(() => true).catch(() => false),
    { url } = await fixture(t),
    cookie = await session(url),
    request = {
      protocolVersion: "ynx-code/v1",
      task: "test-project",
      projectId: "project-tests",
      files: {
        "math.test.mjs": 'import test from "node:test"; import assert from "node:assert/strict"; test("real",()=>assert.equal(6*7,42));',
        "test_math.py": 'import unittest\nclass MathTest(unittest.TestCase):\n def test_real(self): self.assertEqual(6*7,42)\nif __name__ == "__main__": unittest.main()',
        "math.go": "package mathcheck\nfunc multiply(a,b int) int { return a*b }",
        "math_test.go": 'package mathcheck\nimport "testing"\nfunc TestReal(t *testing.T){if multiply(6,7)!=42{t.Fatal("wrong")}}',
        "tests/math.c": '#include <stdio.h>\nint main(void){if(6*7!=42)return 1;printf("C-TEST-PASS");return 0;}',
        "tests/math.cpp": '#include <iostream>\nint main(){if(6*7!=42)return 1;std::cout<<"CPP-TEST-PASS";}',
        ...(cargoAvailable ? {
          "Cargo.toml": '[package]\nname = "ynx_math"\nversion = "0.1.0"\nedition = "2021"\n',
          "src/lib.rs": "pub fn multiply(a:i32,b:i32)->i32{a*b}\n#[cfg(test)] mod tests { use super::*; #[test] fn multiplies(){assert_eq!(multiply(6,7),42);} }\n",
        } : {}),
        ...(junitAvailable ? {
          "src/main/java/dev/ynx/MathOps.java": "package dev.ynx; public final class MathOps { public static int multiply(int a,int b){return a*b;} }",
          "src/test/java/dev/ynx/MathOpsTest.java": "package dev.ynx; import org.junit.jupiter.api.Test; import static org.junit.jupiter.api.Assertions.assertEquals; final class MathOpsTest { @Test void multiplies(){ assertEquals(42,MathOps.multiply(6,7)); } }",
        } : {}),
        ...(hardhatAvailable ? {
          "contracts/Counter.sol": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\ncontract Counter { uint256 public value; function add(uint256 amount) external { value += amount; } }\n",
          "contracts/Counter.t.sol": "// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\nimport {Counter} from './Counter.sol';\ncontract CounterTest { function test_Add() public { Counter counter = new Counter(); counter.add(42); require(counter.value() == 42, 'wrong value'); } }\n",
        } : {}),
      },
      approval: "test-once",
    },
    response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
    value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.ok, true, value.output);
  assert.equal(value.language, "project-tests");
  assert.match(value.output, /pass 1/);
  assert.equal(value.sandbox.network, false);
  assert.match(value.output, /C-TEST-PASS/);
  assert.match(value.output, /CPP-TEST-PASS/);
  if (cargoAvailable) assert.match(value.output, /test result: ok/);
  if (junitAvailable) assert.match(value.output, /1 tests successful/);
  if (hardhatAvailable) assert.match(value.output, /1 passing/);
  assert.deepEqual(
    value.compiler.evidence.runners.map(({ language }) => language),
    ["javascript", "python", "go", "c", "cpp", ...(cargoAvailable ? ["rust"] : []), ...(junitAvailable ? ["java"] : []), ...(hardhatAvailable ? ["solidity"] : [])],
  );
  const unapproved = await fetch(`${url}/runtime/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...request, approval: "execute-once" }),
  });
  assert.equal(unapproved.status, 403);
  const missing = await fetch(`${url}/runtime/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...request, files: { "src/main.js": "export default 42;" } }),
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, "tests_missing");
  const dependencyManifest = await fetch(`${url}/runtime/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ ...request, files: { "Cargo.toml": '[package]\nname = "unsafe"\nversion = "0.1.0"\nedition = "2021"\n[dependencies]\nserde = "1"\n', "src/lib.rs": "#[test] fn blocked(){}" } }),
  });
  assert.equal(dependencyManifest.status, 400);
  assert.equal((await dependencyManifest.json()).code, "invalid_cargo_manifest");
  if (cargoAvailable) {
    const externalLock = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ ...request, files: { "Cargo.toml": '[package]\nname = "unsafe"\nversion = "0.1.0"\nedition = "2021"\n', "Cargo.lock": 'version = 4\n\n[[package]]\nname = "unsafe"\nversion = "0.1.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n', "src/lib.rs": "#[test] fn blocked(){}" } }),
    });
    assert.equal(externalLock.status, 400);
    assert.equal((await externalLock.json()).code, "invalid_cargo_lock");
  }
});
test("Rust is compiled and executed when the reviewed toolchain is installed", { skip: !(await resolveExecutable(["rustc"])) }, async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(languageTask("src/main.rs", 'fn main(){println!("YNX-RUST-42");}')),
    }),
    value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.ok, true, value.output);
  assert.equal(value.language, "rust");
  assert.match(value.output, /YNX-RUST-42/);
  assert.equal(value.sandbox.network, false);
});
test("Java is compiled and executed when the reviewed JDK is installed", { skip: !(await resolveExecutable(["javac"])) || !(await resolveExecutable(["java"])) }, async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(languageTask("src/Main.java", 'package dev.ynx; public final class Main { public static void main(String[] args) { System.out.print("YNX-JAVA-42"); } }')),
    }),
    value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.ok, true, value.output);
  assert.equal(value.language, "java");
  assert.match(value.compiler.version, /javac/i);
  assert.match(value.output, /YNX-JAVA-42/);
  assert.equal(value.sandbox.network, false);
});
test("Solidity is really compiled into integrity-addressed ABI, bytecode and source-map artifacts", { skip: !(await resolveExecutable(["solcjs"])) }, async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    source = "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract Counter { uint256 public value; function set(uint256 next) external { value = next; } }",
    response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(languageTask("contracts/Counter.sol", source)),
    }),
    value = await response.json();
  assert.equal(response.status, 200, JSON.stringify(value));
  assert.equal(value.ok, true, value.output);
  assert.equal(value.language, "solidity");
  assert.match(value.compiler.version, /0\.8\.36/);
  assert.deepEqual(value.compiler.evidence, {
    input: "standard-json",
    abi: true,
    bytecode: true,
    sourceMaps: true,
  });
  assert.equal(value.artifacts.length, 3);
  assert.deepEqual(
    value.artifacts.map((item) => item.path),
    [".ynx-build/solidity/contracts_Counter_sol_Counter.abi", ".ynx-build/solidity/contracts_Counter_sol_Counter.bin", ".ynx-build/solidity/contracts_Counter_sol_Counter.metadata.json"],
  );
  for (const artifact of value.artifacts) {
    assert.ok(artifact.bytes > 0);
    assert.equal(Buffer.byteLength(artifact.content), artifact.bytes);
    assert.equal(createHash("sha256").update(artifact.content).digest("hex"), artifact.sha256);
  }
  assert.match(value.artifacts.find((item) => item.path.endsWith(".abi")).content, /"set"/);
  assert.match(value.artifacts.find((item) => item.path.endsWith(".bin")).content, /^[0-9a-f]+\n$/);
  assert.equal(value.sandbox.network, false);
});
test("streaming tasks emit ordered compiler and program events before the result", async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url),
    response = await fetch(`${url}/runtime/tasks/stream`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(task('#include <iostream>\nint main(){std::cout << "STREAMED-CPP"; return 0;}')),
    });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const sequenced = events.filter((event) => event.sequence);
  assert.deepEqual(
    sequenced.map((event) => event.sequence),
    sequenced.map((_, index) => index + 1),
  );
  assert.equal(events[0].type, "phase");
  assert.ok(events.some((event) => event.type === "output" && event.data.includes("STREAMED-CPP")));
  assert.equal(events.at(-1).type, "result");
  assert.equal(events.at(-1).value.ok, true);
});
test("task approval, path traversal and compiler errors fail closed", async (t) => {
  const { url } = await fixture(t),
    cookie = await session(url);
  for (const body of [
    { ...task(), approval: "chat-approved" },
    { ...task(), activePath: "../main.cpp", files: { "../main.cpp": "" } },
  ]) {
    const response = await fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.ok([400, 403].includes(response.status));
  }
  const failed = await fetch(`${url}/runtime/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(task("int main( {")),
  });
  const value = await failed.json();
  assert.equal(failed.status, 200);
  assert.equal(value.ok, false);
  assert.notEqual(value.code, 0);
});
test("active task inventory is owner scoped and redacts commands and environment", async (t) => {
  const { url } = await fixture(t, { environmentResolver: async () => ({ revision: 6, environment: { PRIVATE_SETTING: "not-in-inventory" } }) }),
    cookie = await session(url),
    attackerCookie = await session(url),
    running = fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(languageTask("src/activity.js", "setTimeout(() => console.log('done'), 5000)")),
    });
  let tasks = [];
  for (let attempt = 0; attempt < 30 && tasks.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    tasks = (await (await fetch(`${url}/runtime/tasks/active`, { headers: { cookie } })).json()).tasks;
  }
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].projectId, "language-src-activity-js");
  assert.equal(tasks[0].environmentRevision, 6);
  assert.equal(JSON.stringify(tasks).includes("PRIVATE_SETTING"), false);
  assert.equal(JSON.stringify(tasks).includes("setTimeout"), false);
  assert.deepEqual((await (await fetch(`${url}/runtime/tasks/active`, { headers: { cookie: attackerCookie } })).json()).tasks, []);
  assert.equal((await fetch(`${url}/runtime/tasks/${tasks[0].taskId}`, { method: "DELETE", headers: { cookie: attackerCookie } })).status, 404);
  assert.equal((await fetch(`${url}/runtime/tasks/${tasks[0].taskId}`, { method: "DELETE", headers: { cookie } })).status, 202);
  const result = await (await running).json();
  assert.equal(result.ok, false);
  assert.equal(result.code, 130);
  assert.match(result.output, /Task cancelled/);
  assert.deepEqual((await (await fetch(`${url}/runtime/tasks/active`, { headers: { cookie } })).json()).tasks, []);
});

test("queued tasks are owner visible and can be cancelled before execution", async (t) => {
  const { url } = await fixture(t, { concurrency: 1 }),
    cookie = await session(url),
    attackerCookie = await session(url),
    running = fetch(`${url}/runtime/tasks`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(languageTask("src/running.js", "setTimeout(() => console.log('done'), 5000)")),
    });
  let tasks = [];
  for (let attempt = 0; attempt < 40 && !tasks.some((item) => item.status === "running"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    tasks = (await (await fetch(`${url}/runtime/tasks/active`, { headers: { cookie } })).json()).tasks;
  }
  const queuedRequest = fetch(`${url}/runtime/tasks`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(languageTask("src/queued.js", "console.log('must-not-run')")),
  });
  for (let attempt = 0; attempt < 40 && !tasks.some((item) => item.status === "queued"); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    tasks = (await (await fetch(`${url}/runtime/tasks/active`, { headers: { cookie } })).json()).tasks;
  }
  const queued = tasks.find((item) => item.status === "queued"),
    activeTask = tasks.find((item) => item.status === "running");
  assert.ok(queued);
  assert.ok(activeTask);
  assert.equal(queued.projectId, "language-src-queued-js");
  assert.equal(queued.startedAt, null);
  assert.match(queued.queuedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(queued).includes("must-not-run"), false);
  assert.equal((await fetch(`${url}/runtime/tasks/${queued.taskId}`, { method: "DELETE", headers: { cookie: attackerCookie } })).status, 404);
  const cancelled = await fetch(`${url}/runtime/tasks/${queued.taskId}`, { method: "DELETE", headers: { cookie } });
  assert.equal(cancelled.status, 202);
  assert.equal((await cancelled.json()).previousStatus, "queued");
  const queuedResponse = await queuedRequest,
    queuedResult = await queuedResponse.json();
  assert.equal(queuedResponse.status, 409);
  assert.equal(queuedResult.code, "task_cancelled");
  assert.match(queuedResult.error, /before execution/);
  tasks = (await (await fetch(`${url}/runtime/tasks/active`, { headers: { cookie } })).json()).tasks;
  assert.deepEqual(tasks.map((item) => item.taskId), [activeTask.taskId]);
  assert.equal((await fetch(`${url}/runtime/tasks/${activeTask.taskId}`, { method: "DELETE", headers: { cookie } })).status, 202);
  assert.equal((await (await running).json()).code, 130);
});

test("parallel users receive bounded independent workspaces", async (t) => {
  const { url, runtime } = await fixture(t),
    cookies = await Promise.all(Array.from({ length: 8 }, () => session(url))),
    results = await Promise.all(
      cookies.map((cookie, index) =>
        fetch(`${url}/runtime/tasks`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            ...task(`#include <iostream>\nint main(){std::cout << ${index};}`),
            projectId: `p-${index}`,
          }),
        }).then((response) => response.json()),
      ),
    );
  assert.deepEqual(
    results.map((value) => value.ok),
    Array(8).fill(true),
  );
  assert.deepEqual(
    results.map((value) => value.output.match(/run> (\d)/)?.[1]),
    ["0", "1", "2", "3", "4", "5", "6", "7"],
  );
  assert.equal(runtime.status().active, 0);
  assert.equal(runtime.status().queued, 0);
});
