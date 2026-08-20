#!/usr/bin/env node
import { canonicalJSON, WalletAuthError } from "../src/canonical.js";
import { materializeMigratedProductSessionState } from "../src/product-session-state-materializer.js";

try {
  const args = options(process.argv.slice(2));
  process.stdout.write(`${canonicalJSON(materializeMigratedProductSessionState(args))}\n`);
} catch (error) {
  const code = error instanceof WalletAuthError ? error.code : "MATERIALIZATION_FAILED";
  const message = error instanceof WalletAuthError ? error.message : "Migrated Product Session state materialization failed";
  process.stderr.write(`${canonicalJSON({ code, message, ok: false, schemaVersion: 1 })}\n`);
  process.exitCode = 1;
}

function options(values) {
  const names = new Map([
    ["--expected-registry-state-binding-sha256", "expectedRegistryStateBindingSha256"],
    ["--expected-source-state-file-sha256", "expectedSourceStateFileSha256"],
    ["--output-gid", "outputGid"],
    ["--output-state", "outputPath"],
    ["--output-uid", "outputUid"],
    ["--source-state", "sourcePath"],
  ]);
  if (values.length !== names.size * 2) throw new WalletAuthError("INVALID_ARGUMENTS", "Exact materialization arguments are required");
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = names.get(values[index]), value = values[index + 1];
    if (!key || Object.hasOwn(result, key) || typeof value !== "string" || value.length === 0) throw new WalletAuthError("INVALID_ARGUMENTS", "Materialization arguments are invalid");
    result[key] = key === "outputUid" || key === "outputGid" ? Number(value) : value;
  }
  return Object.freeze(result);
}
