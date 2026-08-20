import { dirname } from "node:path";
import { runStdioLanguageRequest } from "./cpp-lsp.mjs";

const EXTENSIONS = new Set([".py", ".pyi"]);

export async function runPythonLanguageRequest(request, options) {
  return runStdioLanguageRequest(request, {
    language: "python",
    label: "Python",
    extensions: EXTENSIONS,
    serverCandidates: ["pyright-langserver"],
    serverName: "pyright",
    serverArgs: ["--stdio"],
    languageId: () => "python",
    memoryBytes: 2147483648,
    readOnlyBinds: async (executable) => [{ host: dirname(executable), guest: "/ynx-lsp/node_modules/pyright" }],
  }, options);
}
