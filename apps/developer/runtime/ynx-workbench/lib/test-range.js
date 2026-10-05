// Extension RPC carries Monaco's one-based range. TestService exposes the
// zero-based range expected by VS Code locations and editor open selections.
exports.testRangeFromRpc = range => range ? {
  start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
  end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
} : undefined;
