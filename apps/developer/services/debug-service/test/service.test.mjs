import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import WebSocket from "ws";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createDebugService } from "../src/service.mjs";
import { resolveExecutable } from "../../workspace-agent/src/sandbox.mjs";

test("authenticated C debug bridge compiles and forwards bounded DAP frames", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-debug-test-")),
    compiler = join(root, "compiler.sh"),
    adapter = join(root, "adapter.mjs");
  await writeFile(
    compiler,
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = \'-o\' ]; then shift; printf \'#!/bin/sh\\nexit 0\\n\' > "$1"; chmod +x "$1"; exit 0; fi; shift; done\nexit 2\n',
  );
  await chmod(compiler, 0o755);
  await writeFile(
    adapter,
    `#!/usr/bin/env node\nlet b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf('\\r\\n\\r\\n');if(s<0)return;const h=b.subarray(0,s).toString(),n=Number(h.match(/Content-Length:\\s*(\\d+)/i)?.[1]),e=s+4+n;if(b.length<e)return;const q=JSON.parse(b.subarray(s+4,e));b=b.subarray(e);const m={seq:q.seq+100,type:'response',request_seq:q.seq,success:true,command:q.command,body:{receivedPath:q.arguments?.source?.path}};const out=JSON.stringify(m);process.stdout.write('Content-Length: '+Buffer.byteLength(out)+'\\r\\n\\r\\n'+out)}});`,
  );
  await chmod(adapter, 0o755);
  const store = createWorkspaceStore({
      filename: join(root, "workspaces.sqlite"),
    }),
    runtime = createWorkspaceRuntime({
      sessionKey: "debug-test-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    debug = createDebugService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "sessions"),
      compilerPath: compiler,
      adapterPath: adapter,
      sandbox: { kind: "test-process-boundary", ready: true },
      createLaunch: ({ workspace, command, args }) => ({
        command,
        args,
        cwd: workspace,
        env: { ...process.env, HOME: workspace },
      }),
    });
  server.on("upgrade", debug.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await debug.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  await fetch(`${base}/runtime/workspaces/debug-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "debug-seed-0001",
      workspace: {
        name: "Debug",
        folders: ["src"],
        files: { "src/main.c": "int main(void){int value=7;return value;}\n" },
        open: ["src/main.c"],
        active: "src/main.c",
      },
    }),
  });
  const messages = [],
    websocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=debug-project&activePath=src%2Fmain.c`,
      "ynx-code-dap-v1",
      { headers: { cookie, origin: base } },
    );
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  assert.equal(messages.find((value) => value.type === "ready").language, "c");
  websocket.send(
    JSON.stringify({
      type: "dap",
      message: {
        seq: 1,
        type: "request",
        command: "initialize",
        arguments: { clientID: "ynx-code" },
      },
    }),
  );
  await waitFor(() => messages.some((value) => value.type === "dap"));
  assert.equal(
    messages.find((value) => value.type === "dap").message.command,
    "initialize",
  );
  websocket.send(
    JSON.stringify({
      type: "dap",
      message: {
        seq: 2,
        type: "request",
        command: "setBreakpoints",
        arguments: {
          source: { path: "src/main.c" },
          breakpoints: [{ line: 1 }],
        },
      },
    }),
  );
  await waitFor(
    () => messages.filter((value) => value.type === "dap").length === 2,
  );
  assert.equal(
    messages.filter((value) => value.type === "dap")[1].message.body
      .receivedPath,
    "/workspace/src/main.c",
  );
  websocket.send(
    JSON.stringify({
      type: "dap",
      message: { seq: 3, type: "request", command: "arbitraryHostCommand" },
    }),
  );
  await waitFor(() =>
    messages.some((value) => value.code === "unapproved_dap_request"),
  );
  websocket.close();
});

test("installed LLDB DAP stops a real C++ process at a source breakpoint", async (t) => {
  const compiler = await resolveExecutable(["clang++", "g++"]),
    adapter = await resolveExecutable([
      "lldb-dap-18",
      "lldb-dap",
      "lldb-vscode",
    ]);
  if (!compiler || !adapter) {
    t.skip("reviewed LLDB DAP adapter is not installed on this host");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "ynx-debug-lldb-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "real-debug-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    debug = createDebugService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "sessions"),
      compilerPath: compiler,
      adapterPath: adapter,
    });
  server.on("upgrade", debug.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await debug.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0];
  await fetch(`${base}/runtime/workspaces/lldb-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "lldb-seed-0001",
      workspace: {
        name: "LLDB",
        folders: ["src"],
        files: {
          "src/main.cpp":
            "#include <iostream>\nint main() {\n  int value = 7;\n  std::cout << value << std::endl;\n  return 0;\n}\n",
        },
        open: ["src/main.cpp"],
        active: "src/main.cpp",
      },
    }),
  });
  const messages = [],
    websocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=lldb-project&activePath=src%2Fmain.cpp`,
      "ynx-code-dap-v1",
      { headers: { cookie, origin: base } },
    );
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  let seq = 1;
  const request = (command, args = {}) => {
    const id = seq++;
    websocket.send(
      JSON.stringify({
        type: "dap",
        message: { seq: id, type: "request", command, arguments: args },
      }),
    );
    return id;
  };
  await waitFor(() => messages.some((value) => value.type === "ready"), 10_000);
  const initialize = request("initialize", {
    clientID: "ynx-code",
    adapterID: "lldb",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
  });
  await waitFor(() => response(messages, initialize)?.success === true);
  request("launch", { args: [] });
  await waitFor(() => event(messages, "initialized"), 10_000);
  const breakpoints = request("setBreakpoints", {
    source: { path: "src/main.cpp" },
    breakpoints: [{ line: 3 }],
  });
  await waitFor(() => response(messages, breakpoints)?.success === true);
  assert.equal(
    response(messages, breakpoints).body.breakpoints[0].verified,
    true,
  );
  const configured = request("configurationDone");
  await waitFor(() => response(messages, configured)?.success === true);
  const stopped = await waitValue(() => event(messages, "stopped"), 10_000);
  assert.equal(stopped.body.reason, "breakpoint");
  const threads = request("threads");
  await waitFor(() => response(messages, threads)?.success === true);
  const threadId = response(messages, threads).body.threads[0].id,
    stack = request("stackTrace", { threadId, startFrame: 0, levels: 20 });
  await waitFor(() => response(messages, stack)?.success === true);
  assert.equal(response(messages, stack).body.stackFrames[0].line, 3);
  request("disconnect", { terminateDebuggee: true });
  websocket.close();
});

async function waitFor(predicate, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for debug event.");
}
async function waitValue(predicate, timeout = 5000) {
  await waitFor(predicate, timeout);
  return predicate();
}
function response(messages, requestSeq) {
  return messages.find(
    (value) =>
      value.type === "dap" &&
      value.message.type === "response" &&
      value.message.request_seq === requestSeq,
  )?.message;
}
function event(messages, name) {
  return messages.find(
    (value) =>
      value.type === "dap" &&
      value.message.type === "event" &&
      value.message.event === name,
  )?.message;
}
