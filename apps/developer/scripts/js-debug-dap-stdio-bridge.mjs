#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createConnection } from "node:net";

const socketPath = process.argv[2],
  pidFile = process.argv[3],
  sessionPattern = "[a-f0-9]{24}",
  testMode = process.env.NODE_ENV === "test",
  nodePath = testMode
    ? process.env.YNX_CODE_TEST_JS_DEBUG_NODE
    : "/opt/node-v22.23.1/bin/node",
  serverPath = testMode
    ? process.env.YNX_CODE_TEST_JS_DEBUG_SERVER
    : "/opt/ynx-js-debug/src/dapDebugServer.js";
if (
  typeof socketPath !== "string" ||
  !new RegExp(`^/tmp/ynx-js-debug-${sessionPattern}\\.sock$`).test(
    socketPath,
  ) ||
  typeof pidFile !== "string" ||
  !(
    new RegExp(
      `^/workspaces/[A-Za-z0-9_-]{1,160}/\\.ynx-debug/${sessionPattern}/\\.dap\\.pid$`,
    ).test(pidFile) ||
    (testMode && /^\/tmp\/ynx-js-debug-test-[a-f0-9]{24}\.pid$/.test(pidFile))
  ) ||
  typeof nodePath !== "string" ||
  typeof serverPath !== "string"
) {
  process.stderr.write(
    "Invalid reviewed JavaScript DAP bridge configuration.\n",
  );
  process.exit(64);
}

const server = spawn(nodePath, [serverPath, socketPath], {
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
});
await writeFile(pidFile, `${server.pid}\n`, { mode: 0o600, flag: "wx" });
server.stdout.pipe(process.stderr);
server.stderr.pipe(process.stderr);

const rootSocket = await connectWithRetry(socketPath, server),
  rootParser = new DapParser(onRootMessage),
  clientParser = new DapParser(onClientMessage);
let activeSocket = rootSocket,
  childSocket,
  bridgeSeq = 900_000,
  startingChild = false,
  storedBreakpoints = [];
rootSocket.on("data", (chunk) => rootParser.push(chunk));
process.stdin.on("data", (chunk) => clientParser.push(chunk));

function onClientMessage(message) {
  if (
    !childSocket &&
    message.type === "request" &&
    message.command === "setBreakpoints"
  )
    storedBreakpoints = [
      ...storedBreakpoints.slice(-15),
      structuredClone(message.arguments || {}),
    ];
  writeDap(activeSocket, message);
}

async function onRootMessage(message) {
  if (message.type === "request" && message.command === "startDebugging") {
    if (startingChild || childSocket) {
      writeDap(rootSocket, {
        seq: bridgeSeq++,
        type: "response",
        request_seq: message.seq,
        command: message.command,
        success: false,
        message: "Nested JavaScript debug targets are disabled.",
      });
      return;
    }
    startingChild = true;
    try {
      await startChildSession(message.arguments || {});
      writeDap(rootSocket, {
        seq: bridgeSeq++,
        type: "response",
        request_seq: message.seq,
        command: message.command,
        success: true,
      });
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : "JavaScript child DAP failed."}\n`,
      );
      writeDap(rootSocket, {
        seq: bridgeSeq++,
        type: "response",
        request_seq: message.seq,
        command: message.command,
        success: false,
        message: "JavaScript child DAP failed to start.",
      });
    }
    return;
  }
  if (!childSocket || (message.type === "event" && message.event === "output"))
    writeDap(process.stdout, message);
}

async function startChildSession(argumentsValue) {
  const socket = await connectWithRetry(socketPath, server),
    pending = new Map();
  let initializedResolve;
  let bypassingEntry = storedBreakpoints.length > 0;
  const initialized = new Promise((resolve) => {
      initializedResolve = resolve;
    }),
    parser = new DapParser((message) => {
      if (message.type === "request" && message.command === "startDebugging") {
        writeDap(socket, {
          seq: bridgeSeq++,
          type: "response",
          request_seq: message.seq,
          command: message.command,
          success: false,
          message: "Nested JavaScript debug targets are disabled.",
        });
        return;
      }
      if (message.type === "response" && pending.has(message.request_seq)) {
        const resolve = pending.get(message.request_seq);
        pending.delete(message.request_seq);
        resolve(message);
        return;
      }
      if (message.type === "event" && message.event === "initialized") {
        initializedResolve();
        return;
      }
      if (
        bypassingEntry &&
        message.type === "event" &&
        message.event === "stopped" &&
        message.body?.reason !== "breakpoint"
      ) {
        bypassingEntry = false;
        void reapplyBreakpointsAndContinue(message.body?.threadId).catch(
          (error) => process.stderr.write(`${error.message}\n`),
        );
        return;
      }
      if (message.type === "event" && message.event === "terminated") {
        writeDap(process.stdout, message);
        setTimeout(stop, 0);
        return;
      }
      writeDap(process.stdout, message);
    });
  socket.on("data", (chunk) => parser.push(chunk));
  const request = (command, args) => {
    const seq = bridgeSeq++;
    writeDap(socket, {
      seq,
      type: "request",
      command,
      arguments: args,
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(seq);
        reject(new Error(`Timed out during JavaScript DAP ${command}.`));
      }, 10_000);
      pending.set(seq, (message) => {
        clearTimeout(timer);
        if (!message.success)
          reject(new Error(`JavaScript DAP ${command} was rejected.`));
        else resolve(message);
      });
    });
  };
  const reapplyBreakpointsAndContinue = async (threadId) => {
    for (const breakpoint of storedBreakpoints)
      await request("setBreakpoints", breakpoint);
    await request("continue", { threadId });
  };
  await Promise.all([
    request("initialize", {
      clientID: "ynx-code-bridge",
      clientName: "YNX Code",
      adapterID: "node",
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: "path",
      supportsVariableType: true,
    }),
    withTimeout(initialized, "JavaScript child DAP initialization"),
  ]);
  await request("configurationDone", {});
  childSocket = socket;
  activeSocket = socket;
  const configuration = argumentsValue.configuration || {};
  // Do not await this response: the root session completes target binding only
  // after it receives our startDebugging response.
  void request(argumentsValue.request || "launch", {
    ...configuration,
    request: argumentsValue.request || "launch",
  }).catch((error) => process.stderr.write(`${error.message}\n`));
}

const stop = () => {
  childSocket?.destroy();
  rootSocket.destroy();
  if (server.exitCode === null) server.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
rootSocket.once("close", () => {
  if (!childSocket) stop();
});
server.once("exit", (code) => {
  childSocket?.destroy();
  rootSocket.destroy();
  process.exitCode = code ?? 1;
});

function connectWithRetry(path, child) {
  return (async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const candidate = createConnection({ path });
          candidate.once("connect", () => resolve(candidate));
          candidate.once("error", reject);
        });
      } catch {
        if (child.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new Error("JavaScript DAP Unix-socket server did not become ready.");
  })();
}

function writeDap(stream, message) {
  const body = JSON.stringify(message);
  stream.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out.`)), 10_000),
    ),
  ]);
}

function DapParser(onMessage) {
  this.onMessage = onMessage;
  this.buffer = Buffer.alloc(0);
  this.push = (chunk) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const split = this.buffer.indexOf("\r\n\r\n");
      if (split < 0) return;
      const header = this.buffer.subarray(0, split).toString(),
        length = Number(header.match(/Content-Length:\s*(\d+)/i)?.[1]),
        end = split + 4 + length;
      if (!Number.isInteger(length) || length < 2 || length > 8 * 1024 * 1024)
        throw new Error("Invalid JavaScript DAP frame length.");
      if (this.buffer.length < end) return;
      const message = JSON.parse(this.buffer.subarray(split + 4, end));
      this.buffer = this.buffer.subarray(end);
      void this.onMessage(message);
    }
  };
}
