import { createRequire } from "node:module";
import { dirname, extname } from "node:path";
import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const TSSERVER_PATH = createRequire(import.meta.url).resolve("typescript/lib/tsserver.js");

export async function runTypescriptLanguageRequest(request, options) {
  return runStdioLanguageRequest(request, {
    language: [".ts", ".tsx", ".mts", ".cts"].includes(extname(request.activePath).toLowerCase()) ? "typescript" : "javascript",
    label: "JavaScript/TypeScript",
    extensions: EXTENSIONS,
    serverCandidates: ["typescript-language-server"],
    serverName: "typescript-language-server",
    serverArgs: ["--stdio"],
    memoryBytes: 2147483648,
    initializeTimeoutMs: 20_000,
    requestTimeoutMs: 20_000,
    completionAttempts: 4,
    completionRetryMs: 300,
    languageId: (path) => [".ts", ".tsx", ".mts", ".cts"].includes(extname(path).toLowerCase()) ? "typescript" : "javascript",
    readOnlyBinds: toolBinds,
    initializationOptions: (_executable, sandbox) => ({ tsserver: { path: sandbox.kind === "linux-bubblewrap-prlimit" ? "/ynx-lsp/node_modules/typescript/lib/tsserver.js" : sandbox.kind === "lxd-container" ? "/opt/node-v22.23.1/lib/node_modules/typescript/lib/tsserver.js" : TSSERVER_PATH } }),
  }, options);
}

async function toolBinds(executable) {
  const packageRoot = dirname(dirname(executable)), typescriptRoot = dirname(dirname(TSSERVER_PATH)), binds = [
    { host: packageRoot, guest: "/ynx-lsp/node_modules/typescript-language-server" },
    { host: typescriptRoot, guest: "/ynx-lsp/node_modules/typescript" },
  ];
  return binds;
}
