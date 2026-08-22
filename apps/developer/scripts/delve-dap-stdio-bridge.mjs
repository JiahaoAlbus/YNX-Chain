#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";

const pidFile = process.argv[2];
if (
  typeof pidFile !== "string" ||
  !/^\/workspaces\/[A-Za-z0-9_-]{1,160}\/\.ynx-debug\/[a-f0-9]{24}\/\.dap\.pid$/.test(
    pidFile,
  )
) {
  process.stderr.write("Invalid reviewed Delve bridge configuration.\n");
  process.exit(64);
}

const port = await reserveLoopbackPort();

const child = spawn(
  "/usr/local/bin/dlv",
  ["dap", `--listen=127.0.0.1:${port}`, "--log=false"],
  { stdio: ["ignore", "pipe", "pipe"], shell: false },
);
await writeFile(pidFile, `${child.pid}\n`, { mode: 0o600, flag: "wx" });
child.stdout.pipe(process.stderr);
child.stderr.pipe(process.stderr);

let socket;
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    socket = await connect(port);
    break;
  } catch {
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
if (!socket) {
  child.kill("SIGTERM");
  throw new Error("Delve DAP loopback server did not become ready.");
}

process.stdin.pipe(socket);
socket.pipe(process.stdout);
const stop = () => {
  socket.destroy();
  if (child.exitCode === null) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
socket.once("close", stop);
child.once("exit", (code) => {
  socket.destroy();
  process.exitCode = code ?? 1;
});

function connect(targetPort) {
  return new Promise((resolve, reject) => {
    const candidate = createConnection({ host: "127.0.0.1", port: targetPort });
    candidate.once("connect", () => resolve(candidate));
    candidate.once("error", reject);
  });
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address(),
        selected = typeof address === "object" && address ? address.port : 0;
      server.close((error) =>
        error || selected < 1024
          ? reject(error || new Error("No reviewed loopback port available."))
          : resolve(selected),
      );
    });
  });
}
