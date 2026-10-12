export function sourceDiagnostics(path, source) {
  const diagnostics = [];
  if (path.endsWith(".sol")) {
    if (!/SPDX-License-Identifier:/u.test(source)) diagnostics.push({ severity: "warning", path, line: 1, code: "YNX001", message: "Add an SPDX license identifier." });
    const pragma = source.match(/pragma\s+solidity\s+([^;]+);/u);
    if (!pragma) diagnostics.push({ severity: "error", path, line: 1, code: "YNX002", message: "Solidity pragma is required; YNX supports exact 0.8.24 in this product." });
    else if (pragma[1].replace(/\s/g, "") !== "0.8.24" && pragma[1].replace(/\s/g, "") !== "=0.8.24") diagnostics.push({ severity: "error", path, line: source.slice(0, pragma.index).split("\n").length, code: "YNX003", message: "Unsupported compiler path. Pin pragma to Solidity 0.8.24." });
    let balance = 0; for (const char of source.replace(/\/\/.*$/gm, "")) { if (char === "{") balance++; if (char === "}") balance--; }
    if (balance !== 0) diagnostics.push({ severity: "error", path, line: source.split("\n").length, code: "YNX004", message: "Unbalanced braces; compilation will fail." });
  }
  return diagnostics;
}
