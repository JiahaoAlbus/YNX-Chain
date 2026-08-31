import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const servers = [
  ["clangd", ["--background-index=false", "--log=error"]],
  ["typescript-language-server", ["--stdio"]],
  ["pyright-langserver", ["--stdio"]],
  ["gopls", []],
  ["rust-analyzer", []],
  ["nomicfoundation-solidity-language-server", ["--stdio"]],
  ["jdtls", ["-data", "/tmp/ynx-code-jdtls-probe"]],
];

for (const [command, args] of servers) {
  const value = await initialize(command, args);
  assert.equal(value.id, 1, `${command} returned the wrong response ID`);
  assert.ok(value.result?.capabilities, `${command} did not advertise LSP capabilities`);
  console.log(`${command}: initialize passed`);
}

await import("node:fs/promises").then(({ rm }) => rm("/tmp/ynx-code-jdtls-probe", { recursive: true, force: true }));

function initialize(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: "/tmp",
      env: { ...process.env, HOME: "/tmp", GOMAXPROCS: "2" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = Buffer.alloc(0), stderr = "", settled = false;
    const timer = setTimeout(() => finish(new Error(`${command} LSP initialize timed out: ${stderr}`)), 20_000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
      error ? reject(error) : resolve(value);
    };
    child.once("error", finish);
    child.stderr.on("data", chunk => { stderr = (stderr + String(chunk)).slice(-8_192); });
    child.stdout.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const boundary = buffer.indexOf("\r\n\r\n");
        if (boundary < 0) return;
        const match = buffer.subarray(0, boundary).toString("ascii").match(/Content-Length:\s*(\d+)/i);
        if (!match) { buffer = buffer.subarray(boundary + 4); continue; }
        const length = Number(match[1]), start = boundary + 4;
        if (buffer.length < start + length) return;
        const message = JSON.parse(buffer.subarray(start, start + length).toString("utf8"));
        buffer = buffer.subarray(start + length);
        if (message.id === 1) return finish(null, message);
      }
    });
    send(child, { jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri: "file:///tmp", workspaceFolders: [{ uri: "file:///tmp", name: "probe" }], capabilities: {} } });
  });
}

function send(child, value) {
  const body = Buffer.from(JSON.stringify(value));
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}
