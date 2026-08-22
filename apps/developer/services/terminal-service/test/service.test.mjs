import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import WebSocket from "ws";
import { createWorkspaceRuntime } from "../../workspace-agent/src/runtime.mjs";
import { createWorkspaceStore } from "../../workspace-manager/src/store.mjs";
import { createTerminalService } from "../src/service.mjs";

test("authenticated PTY streams output and synchronizes text workspace changes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-terminal-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "terminal-test-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    terminal = createTerminalService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "sessions"),
      idleMs: 30_000,
      hardMs: 30_000,
    });
  server.on("upgrade", terminal.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await terminal.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  const saved = await fetch(`${base}/runtime/workspaces/pty-project`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "ynx-code/v1",
      expectedRevision: 0,
      idempotencyKey: "terminal-seed-0001",
      workspace: {
        name: "PTY Project",
        folders: ["src"],
        files: { "src/main.cpp": "int main(){}\n" },
        open: ["src/main.cpp"],
        active: "src/main.cpp",
      },
    }),
  });
  assert.equal(saved.status, 200);
  const messages = [],
    websocket = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=pty-project`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  websocket.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
  websocket.send(
    JSON.stringify({
      type: "input",
      data: "printf 'PTY-STREAM-OK\\n'; printf 'created-through-pty\\n' > src/terminal.txt; exit\n",
    }),
  );
  await waitFor(() => messages.some((value) => value.type === "exit"), 10_000);
  assert.match(
    messages
      .filter((value) => value.type === "output")
      .map((value) => value.data)
      .join(""),
    /PTY-STREAM-OK/,
  );
  const sync = messages.find((value) => value.type === "workspace-synced");
  assert.equal(sync.revision, 2);
  const owner = runtime.ownerForRequest({ headers: { cookie } });
  assert.equal(store.get(owner, "pty-project").files["src/terminal.txt"], "created-through-pty\n");
});

test("terminal upgrade rejects missing session and cross-origin requests", async () => {
  const writes = [],
    socket = {
      write: (value) => writes.push(value),
      destroy() {
        this.destroyed = true;
      },
    },
    service = createTerminalService({
      workspaceStore: {},
      ownerForRequest: () => null,
      sandbox: { kind: "test", ready: true },
    });
  service.handleUpgrade(
    {
      url: "/runtime/terminals?projectId=x",
      headers: { host: "localhost", origin: "https://evil.example" },
    },
    socket,
    Buffer.alloc(0),
  );
  assert.equal(socket.destroyed, true);
  assert.match(writes.join(""), /403 Forbidden/);
  await service.close();
});

test("selected cloud runtime opens through its broker and synchronizes its remote snapshot", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-cloud-terminal-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "cloud-terminal-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    opened = [],
    broker = {
      openTerminal: async (value) => (
        opened.push(value),
        {
          launch: {
            command: "/bin/bash",
            args: ["--noprofile", "--norc"],
            cwd: root,
            env: process.env,
            sandbox: {
              kind: value.runtimeId.startsWith("ssh-") ? "remote-ssh" : "lxd-container",
              network: value.runtimeId.startsWith("ssh-"),
              writableRoot: "workspace",
            },
          },
          collect: async () => ({
            folders: ["src"],
            files: {
              "src/main.cpp": "int main(){}\n",
              "src/cloud.txt": "CLOUD_TERMINAL_OK\n",
            },
          }),
          release: async () => opened.push("released"),
        }
      ),
    },
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    terminal = createTerminalService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      containerTerminalBroker: broker,
      root: join(root, "sessions"),
      idleMs: 30_000,
      hardMs: 30_000,
    });
  server.on("upgrade", terminal.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await terminal.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    owner = runtime.ownerForRequest({ headers: { cookie } }),
    snapshot = {
      name: "Cloud",
      folders: ["src"],
      files: { "src/main.cpp": "int main(){}\n" },
      open: ["src/main.cpp"],
      active: "src/main.cpp",
    };
  store.put(owner, "cloud-project", {
    expectedRevision: 0,
    idempotencyKey: "cloud-terminal-seed",
    payload: snapshot,
  });
  const messages = [],
    websocket = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=cloud-project&runtimeId=0123456789abcdef01234567`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  websocket.send(JSON.stringify({ type: "input", data: "exit\n" }));
  await waitFor(() => messages.some((value) => value.type === "exit"));
  assert.equal(messages.find((value) => value.type === "ready").sandbox.kind, "lxd-container");
  assert.equal(store.get(owner, "cloud-project").files["src/cloud.txt"], "CLOUD_TERMINAL_OK\n");
  assert.equal(store.get(owner, "cloud-project").revision, 2);
  assert.equal(opened[0].runtimeId, "0123456789abcdef01234567");
  assert.equal(opened.at(-1), "released");
});

test("Remote SSH runtime identifiers pass only through the authenticated broker", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-ssh-terminal-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "ssh-terminal-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    opened = [],
    broker = {
      openTerminal: async (value) => (
        opened.push(value),
        {
          launch: {
            command: "/bin/bash",
            args: ["--noprofile", "--norc"],
            cwd: root,
            env: process.env,
            sandbox: {
              kind: "remote-ssh",
              network: true,
              writableRoot: "remote-workspace",
            },
          },
          collect: async () => ({
            folders: [],
            files: { "remote.txt": "SSH_OK\n" },
          }),
          release: async () => opened.push("released"),
        }
      ),
    },
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    terminal = createTerminalService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      containerTerminalBroker: broker,
      root: join(root, "sessions"),
      idleMs: 30_000,
      hardMs: 30_000,
    });
  server.on("upgrade", terminal.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await terminal.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    owner = runtime.ownerForRequest({ headers: { cookie } });
  store.put(owner, "ssh-project", {
    expectedRevision: 0,
    idempotencyKey: "ssh-terminal-seed",
    payload: {
      name: "SSH",
      folders: [],
      files: { "README.md": "seed\n" },
      open: ["README.md"],
      active: "README.md",
    },
  });
  const messages = [],
    websocket = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=ssh-project&runtimeId=ssh-0123456789abcdef01234567`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  websocket.send(JSON.stringify({ type: "input", data: "exit\n" }));
  await waitFor(() => messages.some((value) => value.type === "exit"));
  assert.equal(messages.find((value) => value.type === "ready").sandbox.kind, "remote-ssh");
  assert.equal(messages.find((value) => value.type === "ready").sandbox.network, true);
  assert.equal(store.get(owner, "ssh-project").files["remote.txt"], "SSH_OK\n");
  assert.equal(store.get(owner, "ssh-project").revision, 2);
  assert.equal(opened[0].runtimeId, "ssh-0123456789abcdef01234567");
  assert.equal(opened.at(-1), "released");
});

test("idle deadline stops a real PTY and reports the bounded timeout reason", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-timeout-terminal-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "timeout-terminal-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    });
  let now = 0,
    idleCheck;
  const clock = {
      now: () => now,
      setInterval: (callback) => ((idleCheck = callback), 1),
      clearInterval: () => {},
      setTimeout: () => 2,
      clearTimeout: () => {},
    },
    terminal = createTerminalService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "sessions"),
      idleMs: 10_000,
      hardMs: 30_000,
      clock,
    });
  server.on("upgrade", terminal.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await terminal.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    owner = runtime.ownerForRequest({ headers: { cookie } });
  store.put(owner, "timeout-project", {
    expectedRevision: 0,
    idempotencyKey: "timeout-terminal-seed",
    payload: {
      name: "Timeout",
      folders: [],
      files: { "README.md": "seed\n" },
      open: ["README.md"],
      active: "README.md",
    },
  });
  const messages = [],
    websocket = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=timeout-project`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  websocket.send(JSON.stringify({ type: "input", data: "sleep 5\n" }));
  now = 10_001;
  idleCheck();
  await waitFor(() => messages.some((value) => value.type === "exit"));
  assert.equal(messages.find((value) => value.type === "exit").reason, "idle_timeout");
  assert.equal(messages.find((value) => value.type === "exit").code, 124);
  assert.equal(terminal.status().active, 0);
});

test("detached long-running terminal replays output on owner-bound reconnect and stops explicitly", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-reconnect-terminal-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "reconnect-terminal-session-key-that-is-long-enough",
      workspaceStore: store,
    }),
    server = createServer(async (request, response) => {
      if (!(await runtime.handler(request, response))) {
        response.statusCode = 404;
        response.end();
      }
    }),
    terminal = createTerminalService({
      workspaceStore: store,
      ownerForRequest: (request) => runtime.ownerForRequest(request),
      root: join(root, "sessions"),
      idleMs: 30_000,
      hardMs: 30_000,
    });
  server.on("upgrade", terminal.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await terminal.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const address = server.address(),
    base = `http://127.0.0.1:${address.port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    owner = runtime.ownerForRequest({ headers: { cookie } });
  store.put(owner, "reconnect-project", {
    expectedRevision: 0,
    idempotencyKey: "reconnect-terminal-seed",
    payload: {
      name: "Reconnect",
      folders: [],
      files: { "README.md": "seed\n" },
      open: ["README.md"],
      active: "README.md",
    },
  });
  const firstMessages = [],
    first = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=reconnect-project`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  first.on("message", (raw) => firstMessages.push(JSON.parse(String(raw))));
  await waitFor(() => firstMessages.some((value) => value.type === "ready"));
  const sessionId = firstMessages.find((value) => value.type === "ready").sessionId;
  first.send(
    JSON.stringify({
      type: "input",
      data: "printf 'BEFORE-DETACH\\n'; sleep 0.3; printf 'AFTER-DETACH\\n'; sleep 5\n",
    }),
  );
  await waitFor(() => firstMessages.some((value) => value.type === "output" && value.data.includes("BEFORE-DETACH")));
  await new Promise((resolve) => {
    first.once("close", resolve);
    first.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(terminal.status().active, 1);
  const attackerHealth = await fetch(`${base}/runtime/health`),
    attackerCookie = attackerHealth.headers.get("set-cookie")?.split(";")[0],
    attackerStatus = await rejectedUpgrade(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=reconnect-project&sessionId=${sessionId}`, attackerCookie, base);
  assert.equal(attackerStatus, 403);
  const resumedMessages = [],
    resumed = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=reconnect-project&sessionId=${sessionId}`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  resumed.on("message", (raw) => resumedMessages.push(JSON.parse(String(raw))));
  await waitFor(() => resumedMessages.some((value) => value.type === "replay"));
  assert.equal(resumedMessages.find((value) => value.type === "ready").reconnected, true);
  assert.match(resumedMessages.find((value) => value.type === "replay").data, /BEFORE-DETACH[\s\S]*AFTER-DETACH/);
  const resumedClose = new Promise((resolve) => resumed.once("close", (code) => resolve(code))),
    replacementMessages = [],
    replacement = new WebSocket(`ws://127.0.0.1:${address.port}/runtime/terminals?projectId=reconnect-project&sessionId=${sessionId}`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  replacement.on("message", (raw) => replacementMessages.push(JSON.parse(String(raw))));
  await waitFor(() => replacementMessages.some((value) => value.type === "ready"));
  assert.equal(await resumedClose, 4001);
  replacement.send(JSON.stringify({ type: "close" }));
  await waitFor(() => replacementMessages.some((value) => value.type === "exit"));
  assert.equal(replacementMessages.find((value) => value.type === "exit").reason, "client_close");
  assert.equal(replacementMessages.find((value) => value.type === "workspace-synced").revision, 2);
  assert.equal(terminal.status().active, 0);
});

test("project environment reaches the PTY while HTTP inventory exposes only bounded session metadata", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ynx-terminal-environment-test-")),
    store = createWorkspaceStore({ filename: join(root, "workspaces.sqlite") }),
    runtime = createWorkspaceRuntime({
      sessionKey: "environment-terminal-session-key-long-enough",
      workspaceStore: store,
    });
  let terminal;
  const environmentService = {
      resolve: async (owner, projectId) => ({
        revision: 7,
        environment: { VISIBLE_SETTING: `${owner}:${projectId}` },
      }),
    },
    server = createServer(async (request, response) => {
      if (await runtime.handler(request, response)) return;
      if (await terminal.handler(request, response)) return;
      response.statusCode = 404;
      response.end();
    });
  terminal = createTerminalService({
    workspaceStore: store,
    ownerForRequest: (request) => runtime.ownerForRequest(request),
    environmentService,
    root: join(root, "sessions"),
    idleMs: 30_000,
    hardMs: 30_000,
  });
  server.on("upgrade", terminal.handleUpgrade);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await terminal.close();
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`,
    health = await fetch(`${base}/runtime/health`),
    cookie = health.headers.get("set-cookie")?.split(";")[0],
    owner = runtime.ownerForRequest({ headers: { cookie } });
  store.put(owner, "environment-project", {
    expectedRevision: 0,
    idempotencyKey: "environment-terminal-seed",
    payload: {
      name: "Environment",
      folders: [],
      files: { "README.md": "seed\n" },
      open: ["README.md"],
      active: "README.md",
    },
  });
  const messages = [],
    websocket = new WebSocket(`ws://127.0.0.1:${server.address().port}/runtime/terminals?projectId=environment-project`, "ynx-code-terminal-v1", { headers: { cookie, origin: base } });
  websocket.on("message", (raw) => messages.push(JSON.parse(String(raw))));
  await waitFor(() => messages.some((value) => value.type === "ready"));
  websocket.send(
    JSON.stringify({
      type: "input",
      data: "printf '%s\\n' \"$VISIBLE_SETTING\"; sleep 5\n",
    }),
  );
  await waitFor(() => messages.some((value) => value.type === "output" && value.data.includes(":environment-project")));
  const sessionId = messages.find((value) => value.type === "ready").sessionId,
    list = await fetch(`${base}/runtime/terminals?projectId=environment-project`, { headers: { cookie } }),
    inventory = await list.json();
  assert.equal(inventory.terminals[0].sessionId, sessionId);
  assert.equal(inventory.terminals[0].environmentRevision, 7);
  assert.equal(JSON.stringify(inventory).includes("VISIBLE_SETTING"), false);
  assert.equal(JSON.stringify(inventory).includes(owner), false);
  const attackerHealth = await fetch(`${base}/runtime/health`),
    attackerCookie = attackerHealth.headers.get("set-cookie")?.split(";")[0],
    attackerStop = await fetch(`${base}/runtime/terminals/${sessionId}`, {
      method: "DELETE",
      headers: { cookie: attackerCookie },
    });
  assert.equal(attackerStop.status, 404);
  const stopped = await fetch(`${base}/runtime/terminals/${sessionId}`, {
    method: "DELETE",
    headers: { cookie },
  });
  assert.equal(stopped.status, 200);
  await waitFor(() => terminal.status().active === 0);
  assert.deepEqual((await (await fetch(`${base}/runtime/terminals`, { headers: { cookie } })).json()).terminals, []);
});

async function waitFor(predicate, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for terminal event.");
}
async function rejectedUpgrade(url, cookie, origin) {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url, "ynx-code-terminal-v1", {
      headers: { cookie, origin },
    });
    websocket.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    websocket.once("open", () => {
      websocket.close();
      reject(new Error("Upgrade unexpectedly succeeded."));
    });
    websocket.once("error", () => {});
  });
}
