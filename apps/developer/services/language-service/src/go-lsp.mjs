import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

export async function runGoLanguageRequest(request, options) {
  return runStdioLanguageRequest(request, {
    language: "go",
    label: "Go",
    extensions: new Set([".go"]),
    serverCandidates: ["gopls"],
    serverName: "gopls",
    serverArgs: [],
    // An existing gopls may live in a user-owned tool directory. Admit only
    // the resolved executable; never expose the user's Go source or cache.
    readOnlyBinds: async (executable) => [{ host: executable, guest: "/ynx-lsp/gopls" }],
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
