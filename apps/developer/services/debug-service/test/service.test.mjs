import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  access,
  chmod,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
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

test("authenticated container bridge fixes Python, Rust, Go and Node adapter launch paths", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-debug-python-test-")),
    adapter = join(root, "debugpy-adapter.mjs");
  await writeFile(
    adapter,
    `#!/usr/bin/env node\nlet b=Buffer.alloc(0);process.stdin.on('data',c=>{b=Buffer.concat([b,c]);for(;;){const s=b.indexOf('\\r\\n\\r\\n');if(s<0)return;const h=b.subarray(0,s).toString(),n=Number(h.match(/Content-Length:\\s*(\\d+)/i)?.[1]),e=s+4+n;if(b.length<e)return;const q=JSON.parse(b.subarray(s+4,e));b=b.subarray(e);const m={seq:q.seq+100,type:'response',request_seq:q.seq,success:true,command:q.command,body:{program:q.arguments?.program,cwd:q.arguments?.cwd,source:q.arguments?.source?.path,justMyCode:q.arguments?.justMyCode,subProcess:q.arguments?.subProcess,mode:q.arguments?.mode,hideSystemGoroutines:q.arguments?.hideSystemGoroutines,debugType:q.arguments?.type,runtimeExecutable:q.arguments?.runtimeExecutable,console:q.arguments?.console,autoAttachChildProcesses:q.arguments?.autoAttachChildProcesses}};const out=JSON.stringify(m);process.stdout.write('Content-Length: '+Buffer.byteLength(out)+'\\r\\n\\r\\n'+out)}});`,
  );
  await chmod(adapter, 0o755);
  const store = createWorkspaceStore({
      filename: join(root, "workspaces.sqlite"),
    }),
    runtime = createWorkspaceRuntime({
      sessionKey: "python-debug-test-session-key-is-long-enough",
      workspaceStore: store,
    }),
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    brokerCalls = [],
    debug = createDebugService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "sessions"),
      sandbox: { kind: "test-process-boundary", ready: true },
      containerDebugBroker: {
        openContainerDebugProcess: async (value) => {
          brokerCalls.push(value);
          const child = spawn(adapter, ["-m", "debugpy.adapter"], {
            cwd: root,
            env: { ...process.env, HOME: root },
            stdio: ["pipe", "pipe", "pipe"],
          });
          return {
            child,
            visibleRoot: "/workspaces/python-project/.ynx-debug/session",
            program:
              value.language === "python"
                ? "/workspaces/python-project/.ynx-debug/session/src/main.py"
                : value.language === "go"
                  ? "/workspaces/python-project/.ynx-debug/session/main.go"
                  : value.language === "node"
                    ? "/workspaces/python-project/.ynx-debug/session/main.js"
                    : "/workspaces/python-project/.ynx-debug/session/.ynx-build/debug-program",
            adapterId:
              value.language === "python"
                ? "debugpy"
                : value.language === "go"
                  ? "delve-dap"
                  : value.language === "node"
                    ? "js-debug"
                    : "lldb-dap",
            sandbox: { kind: "lxd-container", network: false },
            cleanup: async () => child.kill("SIGKILL"),
          };
        },
      },
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
  await fetch(`${base}/runtime/workspaces/python-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "python-debug-seed-0001",
      workspace: {
        name: "Python Debug",
        folders: ["src"],
        files: { "src/main.py": "value = 7\nprint(value)\n" },
        open: ["src/main.py"],
        active: "src/main.py",
      },
    }),
  });
  const messages = [],
    websocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=python-project&activePath=src%2Fmain.py&runtimeId=0123456789abcdef01234567`,
      "ynx-code-dap-v1",
      { headers: { cookie, origin: base } },
    );
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  const ready = messages.find((value) => value.type === "ready");
  assert.equal(ready.language, "python");
  assert.equal(ready.adapter, "debugpy");
  assert.equal(
    ready.program,
    "/workspaces/python-project/.ynx-debug/session/src/main.py",
  );
  assert.equal(brokerCalls.length, 1);
  assert.equal(brokerCalls[0].runtimeId, "0123456789abcdef01234567");
  websocket.send(
    JSON.stringify({
      type: "dap",
      message: {
        seq: 1,
        type: "request",
        command: "launch",
        arguments: {
          program: "/etc/passwd",
          cwd: "/",
          justMyCode: false,
          subProcess: true,
          args: ["safe"],
        },
      },
    }),
  );
  await waitFor(() => response(messages, 1)?.success === true);
  assert.deepEqual(response(messages, 1).body, {
    program: "/workspaces/python-project/.ynx-debug/session/src/main.py",
    cwd: "/workspaces/python-project/.ynx-debug/session",
    justMyCode: true,
    subProcess: false,
    console: "internalConsole",
  });
  websocket.send(
    JSON.stringify({
      type: "dap",
      message: {
        seq: 2,
        type: "request",
        command: "setBreakpoints",
        arguments: {
          source: { path: "src/main.py" },
          breakpoints: [{ line: 1 }],
        },
      },
    }),
  );
  await waitFor(() => response(messages, 2)?.success === true);
  assert.equal(
    response(messages, 2).body.source,
    "/workspaces/python-project/.ynx-debug/session/src/main.py",
  );
  websocket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fetch(`${base}/runtime/workspaces/python-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 1,
      idempotencyKey: "rust-debug-seed-0001",
      workspace: {
        name: "Rust Debug",
        folders: ["src"],
        files: { "src/main.rs": "fn main() { let value = 9; }\n" },
        open: ["src/main.rs"],
        active: "src/main.rs",
      },
    }),
  });
  const rustMessages = [],
    rustSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=python-project&activePath=src%2Fmain.rs&runtimeId=0123456789abcdef01234567`,
      "ynx-code-dap-v1",
      { headers: { cookie, origin: base } },
    );
  rustSocket.on("message", (raw) => rustMessages.push(JSON.parse(String(raw))));
  await waitFor(() => rustMessages.some((value) => value.type === "ready"));
  const rustReady = rustMessages.find((value) => value.type === "ready");
  assert.equal(rustReady.language, "rust");
  assert.equal(rustReady.adapter, "lldb-dap");
  assert.match(rustReady.program, /\.ynx-build\/debug-program$/);
  rustSocket.send(
    JSON.stringify({
      type: "dap",
      message: { seq: 3, type: "request", command: "launch", arguments: {} },
    }),
  );
  await waitFor(() =>
    rustMessages.some(
      (value) => value.type === "dap" && value.message.request_seq === 3,
    ),
  );
  assert.match(
    rustMessages.find(
      (value) => value.type === "dap" && value.message.request_seq === 3,
    ).message.body.program,
    /\.ynx-build\/debug-program$/,
  );
  rustSocket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fetch(`${base}/runtime/workspaces/python-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 2,
      idempotencyKey: "go-debug-seed-0001",
      workspace: {
        name: "Go Debug",
        folders: [],
        files: {
          "main.go":
            'package main\nimport "fmt"\nfunc main(){ value := 11; fmt.Println(value) }\n',
        },
        open: ["main.go"],
        active: "main.go",
      },
    }),
  });
  const goMessages = [],
    goSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=python-project&activePath=main.go&runtimeId=0123456789abcdef01234567`,
      "ynx-code-dap-v1",
      { headers: { cookie, origin: base } },
    );
  goSocket.on("message", (raw) => goMessages.push(JSON.parse(String(raw))));
  await waitFor(() => goMessages.some((value) => value.type === "ready"));
  const goReady = goMessages.find((value) => value.type === "ready");
  assert.equal(goReady.language, "go");
  assert.equal(goReady.adapter, "delve-dap");
  assert.match(goReady.program, /main\.go$/);
  goSocket.send(
    JSON.stringify({
      type: "dap",
      message: { seq: 4, type: "request", command: "launch", arguments: {} },
    }),
  );
  await waitFor(() => response(goMessages, 4)?.success === true);
  assert.equal(response(goMessages, 4).body.mode, "debug");
  assert.equal(response(goMessages, 4).body.hideSystemGoroutines, true);
  assert.match(response(goMessages, 4).body.program, /main\.go$/);
  goSocket.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await fetch(`${base}/runtime/workspaces/python-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 3,
      idempotencyKey: "node-debug-seed-0001",
      workspace: {
        name: "Node Debug",
        folders: [],
        files: { "main.js": "const value = 13; console.log(value);\n" },
        open: ["main.js"],
        active: "main.js",
      },
    }),
  });
  const nodeMessages = [],
    nodeSocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=python-project&activePath=main.js&runtimeId=0123456789abcdef01234567`,
      "ynx-code-dap-v1",
      { headers: { cookie, origin: base } },
    );
  nodeSocket.on("message", (raw) => nodeMessages.push(JSON.parse(String(raw))));
  await waitFor(() => nodeMessages.some((value) => value.type === "ready"));
  const nodeReady = nodeMessages.find((value) => value.type === "ready");
  assert.equal(nodeReady.language, "node");
  assert.equal(nodeReady.adapter, "js-debug");
  assert.match(nodeReady.program, /main\.js$/);
  nodeSocket.send(
    JSON.stringify({
      type: "dap",
      message: { seq: 5, type: "request", command: "launch", arguments: {} },
    }),
  );
  await waitFor(() => response(nodeMessages, 5)?.success === true);
  assert.equal(response(nodeMessages, 5).body.debugType, "pwa-node");
  assert.equal(
    response(nodeMessages, 5).body.runtimeExecutable,
    "/opt/node-v22.23.1/bin/node",
  );
  assert.equal(response(nodeMessages, 5).body.console, "internalConsole");
  assert.equal(response(nodeMessages, 5).body.autoAttachChildProcesses, false);
  nodeSocket.close();
});

test("installed debugpy stops a real Python process and exposes local variables", async (t) => {
  const pythonRoot =
      process.env.YNX_CODE_TEST_DEBUGPY_ROOT ||
      fileURLToPath(new URL("../../../.ynx-debugpy", import.meta.url)),
    python = join(
      pythonRoot,
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
  try {
    await access(python);
  } catch {
    t.skip("reviewed debugpy runtime is not installed on this host");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "ynx-debug-real-python-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "real-python-debug-session-key-is-long-enough",
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
      pythonRoot,
      sandbox: { kind: "macos-sandbox-exec", ready: true },
      createLaunch: ({ workspace, command, args }) => ({
        command,
        args,
        cwd: workspace,
        env: {
          ...process.env,
          HOME: workspace,
          TMPDIR: join(workspace, ".tmp"),
        },
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
  await fetch(`${base}/runtime/workspaces/debugpy-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "debugpy-real-seed-0001",
      workspace: {
        name: "debugpy",
        folders: ["src"],
        files: { "src/main.py": "value = 7\nprint(value)\n" },
        open: ["src/main.py"],
        active: "src/main.py",
      },
    }),
  });
  const messages = [],
    websocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=debugpy-project&activePath=src%2Fmain.py`,
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
  await waitFor(
    () =>
      messages.some(
        (value) => value.type === "ready" || value.type === "error",
      ),
    10_000,
  );
  assert.ok(
    messages.some((value) => value.type === "ready"),
    JSON.stringify(messages),
  );
  const initialize = request("initialize", {
    clientID: "ynx-code",
    adapterID: "python",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
  });
  await waitFor(() => response(messages, initialize)?.success === true, 10_000);
  const launch = request("launch", { args: [] });
  await waitFor(
    () =>
      event(messages, "initialized") ||
      response(messages, launch) ||
      messages.some((value) =>
        ["adapter-stderr", "exit", "error"].includes(value.type),
      ),
    10_000,
  );
  assert.ok(event(messages, "initialized"), JSON.stringify(messages));
  const breakpoints = request("setBreakpoints", {
    source: { path: "src/main.py" },
    breakpoints: [{ line: 2 }],
  });
  await waitFor(
    () => response(messages, breakpoints)?.success === true,
    10_000,
  );
  assert.equal(
    response(messages, breakpoints).body.breakpoints[0].verified,
    true,
  );
  const configured = request("configurationDone");
  await waitFor(() => response(messages, configured)?.success === true, 10_000);
  const stopped = await waitValue(() => event(messages, "stopped"), 10_000);
  assert.equal(stopped.body.reason, "breakpoint");
  const threads = request("threads");
  await waitFor(() => response(messages, threads)?.success === true);
  const threadId = response(messages, threads).body.threads[0].id,
    stack = request("stackTrace", { threadId, startFrame: 0, levels: 20 });
  await waitFor(() => response(messages, stack)?.success === true);
  const top = response(messages, stack).body.stackFrames[0];
  assert.equal(top.line, 2);
  const scopes = request("scopes", { frameId: top.id });
  await waitFor(() => response(messages, scopes)?.success === true);
  const localScope = response(messages, scopes).body.scopes.find(
      (value) => value.name === "Locals",
    ),
    variables = request("variables", {
      variablesReference: localScope.variablesReference,
      start: 0,
      count: 200,
    });
  await waitFor(() => response(messages, variables)?.success === true);
  assert.ok(
    response(messages, variables).body.variables.some(
      (value) => value.name === "value" && value.value === "7",
    ),
  );
  request("disconnect", { terminateDebuggee: true });
  websocket.close();
});

test("installed js-debug stops a real Node process and exposes local variables", async (t) => {
  const jsDebugRoot =
      process.env.YNX_CODE_TEST_JS_DEBUG_ROOT ||
      fileURLToPath(new URL("../../../.ynx-js-debug", import.meta.url)),
    jsDebugServer = join(jsDebugRoot, "src/dapDebugServer.js");
  try {
    await access(jsDebugServer);
  } catch {
    t.skip("reviewed js-debug runtime is not installed on this host");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "ynx-debug-real-node-")),
    resolvedRoot = await realpath(root),
    bridge = fileURLToPath(
      new URL(
        "../../../scripts/js-debug-dap-stdio-bridge.mjs",
        import.meta.url,
      ),
    ),
    source = join(resolvedRoot, "main.js"),
    sessionId = process.pid.toString(16).padStart(24, "0").slice(-24),
    socketPath = `/tmp/ynx-js-debug-${sessionId}.sock`,
    pidFile = `/tmp/ynx-js-debug-test-${sessionId}.pid`;
  await writeFile(
    source,
    '"use strict";\nconst value = 13;\nconsole.log(value);\n',
  );
  const store = createWorkspaceStore({
      filename: join(root, "workspaces.sqlite"),
    }),
    runtime = createWorkspaceRuntime({
      sessionKey: "real-node-debug-session-key-is-long-enough",
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
      sandbox: { kind: "test-process-boundary", ready: true },
      containerNodePath: process.execPath,
      containerDebugBroker: {
        openContainerDebugProcess: async () => {
          const child = spawn(process.execPath, [bridge, socketPath, pidFile], {
            cwd: resolvedRoot,
            env: {
              ...process.env,
              HOME: resolvedRoot,
              TMPDIR: "/tmp",
              NODE_ENV: "test",
              YNX_CODE_TEST_JS_DEBUG_NODE: process.execPath,
              YNX_CODE_TEST_JS_DEBUG_SERVER: jsDebugServer,
            },
            stdio: ["pipe", "pipe", "pipe"],
            detached: true,
          });
          return {
            child,
            visibleRoot: resolvedRoot,
            program: source,
            adapterId: "js-debug",
            sandbox: { kind: "lxd-container", network: false },
            cleanup: async () => {
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {}
            },
          };
        },
      },
    });
  server.on("upgrade", debug.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await debug.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
    await rm(socketPath, { force: true });
    await rm(pidFile, { force: true });
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0];
  await fetch(`${base}/runtime/workspaces/node-debug-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "node-real-seed-0001",
      workspace: {
        name: "Node js-debug",
        folders: [],
        files: {
          "main.js": '"use strict";\nconst value = 13;\nconsole.log(value);\n',
        },
        open: ["main.js"],
        active: "main.js",
      },
    }),
  });
  const messages = [],
    websocket = new WebSocket(
      `ws://127.0.0.1:${address.port}/runtime/debug?projectId=node-debug-project&activePath=main.js&runtimeId=0123456789abcdef01234567`,
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
    adapterID: "node",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
    supportsVariableType: true,
  });
  await waitFor(
    () =>
      response(messages, initialize)?.success === true &&
      event(messages, "initialized"),
    10_000,
  );
  const launch = request("launch", {}),
    breakpoints = request("setBreakpoints", {
      source: { path: "main.js" },
      breakpoints: [{ line: 3 }],
    });
  await waitFor(
    () => response(messages, breakpoints)?.success === true,
    10_000,
  );
  const configured = request("configurationDone");
  await waitFor(
    () =>
      response(messages, configured)?.success === true &&
      response(messages, launch)?.success === true,
    10_000,
  ).catch(() => assert.fail(JSON.stringify(messages)));
  await waitFor(
    () => event(messages, "stopped")?.body?.reason === "breakpoint",
    10_000,
  ).catch(() => assert.fail(JSON.stringify(messages)));
  const threads = request("threads");
  await waitFor(() => response(messages, threads)?.success === true);
  const threadId = response(messages, threads).body.threads[0].id,
    stack = request("stackTrace", { threadId, startFrame: 0, levels: 20 });
  await waitFor(() => response(messages, stack)?.success === true);
  const top = response(messages, stack).body.stackFrames[0];
  assert.equal(top.line, 3);
  const scopes = request("scopes", { frameId: top.id });
  await waitFor(() => response(messages, scopes)?.success === true);
  let found = false;
  for (const scope of response(messages, scopes).body.scopes) {
    if (!scope.variablesReference) continue;
    const variables = request("variables", {
      variablesReference: scope.variablesReference,
      start: 0,
      count: 200,
    });
    await waitFor(() => response(messages, variables)?.success === true);
    if (
      response(messages, variables).body.variables.some(
        (value) => value.name === "value" && String(value.value).includes("13"),
      )
    ) {
      found = true;
      break;
    }
  }
  assert.equal(found, true);
  request("disconnect", { terminateDebuggee: true });
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
            "int main() {\n  int value = 7;\n  return value;\n}\n",
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
  await waitFor(
    () =>
      messages.some(
        (value) => value.type === "ready" || value.type === "error",
      ),
    10_000,
  );
  assert.ok(
    messages.some((value) => value.type === "ready"),
    JSON.stringify(messages),
  );
  const initialize = request("initialize", {
    clientID: "ynx-code",
    adapterID: "lldb",
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: "path",
  });
  await waitFor(() => response(messages, initialize)?.success === true);
  const launch = request("launch", { args: [] });
  await waitFor(
    () =>
      event(messages, "initialized") ||
      response(messages, launch) ||
      messages.some((value) =>
        ["adapter-stderr", "exit", "error"].includes(value.type),
      ),
    10_000,
  );
  assert.ok(event(messages, "initialized"), JSON.stringify(messages));
  const breakpoints = request("setBreakpoints", {
    source: { path: "src/main.cpp" },
    breakpoints: [{ line: 2 }],
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
  assert.equal(response(messages, stack).body.stackFrames[0].line, 2);
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
