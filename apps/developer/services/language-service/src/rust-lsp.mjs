import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

export async function runRustLanguageRequest(request, options) {
  return runStdioLanguageRequest(request, {
    language: "rust",
    label: "Rust",
    extensions: new Set([".rs"]),
    serverCandidates: ["rust-analyzer"],
    serverName: "rust-analyzer",
    serverArgs: [],
    languageId: () => "rust",
    memoryBytes: 4294967296,
    writeWorkspace: true,
    openDelayMs: 1200,
    completionAttempts: 5,
    completionRetryMs: 500,
    initializationOptions: () => ({ checkOnSave: false, cargo: { buildScripts: { enable: false } } }),
    environment: process.platform === "linux" ? { RUST_SRC_PATH: "/usr/lib/rustlib/src/rust/library" } : {},
  }, options);
}
