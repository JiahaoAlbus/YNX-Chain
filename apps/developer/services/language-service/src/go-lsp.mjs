import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

export async function runGoLanguageRequest(request, options) {
  return runStdioLanguageRequest(request, {
    language: "go",
    label: "Go",
    extensions: new Set([".go"]),
    serverCandidates: ["gopls"],
    serverName: "gopls",
    serverArgs: [],
    languageId: () => "go",
    memoryBytes: 2147483648,
    // Go 1.26 reserves large virtual arenas; RLIMIT_AS causes nondeterministic
    // startup failures even while resident memory is low. The service-wide
    // queue, process/thread limits, CPU timeout and GOMAXPROCS remain enforced.
    addressSpaceBytes: null,
    requestTimeoutMs: 60000,
    environment: { GOMAXPROCS: "2" },
  }, options);
}
