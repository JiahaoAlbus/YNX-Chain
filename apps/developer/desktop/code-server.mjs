import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const resources = dirname(fileURLToPath(import.meta.url));
// The package producer records the clean checkout that supplied this runtime.
// Validate it before touching user state; inherited shell values are not build
// provenance and must never label a different package as the released source.
const provenance = JSON.parse(await readFile(join(resources, "build-provenance.json"), "utf8"));
if (provenance?.schemaVersion !== 1 || provenance.productId !== "ynx-developer-v1"
  || provenance.version !== "0.2.0" || provenance.sourceDirty !== false
  || provenance.platform !== `macos-${process.arch}`
  || typeof provenance.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(provenance.sourceCommit)
  || typeof provenance.sourceTree !== "string" || !/^[0-9a-f]{40}$/.test(provenance.sourceTree)
  || provenance.runtimeCheckpoint !== provenance.sourceCommit) {
  throw new Error("Desktop bundled build provenance is invalid.");
}
const applicationRoot = join(resources, "code", "apps", "developer");
const supportRoot = process.env.YNX_CODE_DESKTOP_SUPPORT_DIR || join(homedir(), "Library", "Application Support", "YNXDeveloper");
const sessionKeyPath = join(supportRoot, "workspace-session.key");

await mkdir(supportRoot, { recursive: true, mode: 0o700 });
let sessionKey;
try {
  sessionKey = (await readFile(sessionKeyPath, "utf8")).trim();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
  const candidate = randomBytes(32).toString("hex");
  try { await writeFile(sessionKeyPath, `${candidate}\n`, { flag: "wx", mode: 0o600 }); }
  catch (writeError) { if (writeError?.code !== "EEXIST") throw writeError; }
  sessionKey = (await readFile(sessionKeyPath, "utf8")).trim();
}
if (!/^[0-9a-f]{64}$/.test(sessionKey)) throw new Error("Desktop workspace session key is invalid.");
await chmod(sessionKeyPath, 0o600);

process.env.NODE_ENV = "production";
process.env.HOST = "127.0.0.1";
process.env.YNX_CODE_RELEASE = `${provenance.version}-testnet-preview-${provenance.sourceCommit.slice(0, 12)}`;
process.env.YNX_CODE_SOURCE_COMMIT = provenance.sourceCommit;
process.env.YNX_CODE_SOURCE_TREE = provenance.sourceTree;
process.env.YNX_CODE_WORKSPACE_SESSION_KEY = sessionKey;
process.env.YNX_CODE_STATE_DIR = join(supportRoot, "code-state");
process.env.YNX_CODE_STATIC_ROOT = join(applicationRoot, "frontend", "dist");
process.chdir(applicationRoot);

await import(pathToFileURL(join(applicationRoot, "services", "gateway", "src", "server.mjs")).href);

// Cocoa may be terminated by the operating system without delivering the
// application delegate's graceful callback. Never leave a re-parented IDE
// runtime behind after its only trusted native host disappears.
const desktopParent = process.ppid;
const parentMonitor = setInterval(() => {
  if (process.ppid !== desktopParent) process.kill(process.pid, "SIGTERM");
}, 250);
parentMonitor.unref();
