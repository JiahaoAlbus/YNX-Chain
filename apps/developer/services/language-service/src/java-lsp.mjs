import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

const EXTENSIONS = new Set([".java"]);

export async function runJavaLanguageRequest(request, options) {
  return runStdioLanguageRequest(request, {
    language: "java",
    label: "Java",
    extensions: EXTENSIONS,
    serverCandidates: ["jdtls"],
    serverName: "jdtls",
    serverArgs: ["-data", ".ynx-build/jdtls"],
    languageId: () => "java",
    memoryBytes: 2147483648,
    addressSpaceBytes: null,
    initializeTimeoutMs: 45_000,
    requestTimeoutMs: 30_000,
    diagnosticsTimeoutMs: 12_000,
    diagnosticsAccept: (items) => items.some((item) => String(item.code) !== "16"),
    openDelayMs: 1_500,
    completionAttempts: 4,
    completionRetryMs: 500,
    initializationOptions: () => ({ bundles: [], workspaceFolders: [] }),
  }, options);
}
