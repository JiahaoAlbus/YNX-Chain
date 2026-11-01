#!/usr/bin/env node
import { migrateProductSessionControlStateFileV2 } from "../src/product-session-control-node-store.js";

const HELP = `Usage: ynx-wallet-control-migrate-v3 --source ABSOLUTE_V2_FILE --target ABSOLUTE_V3_FILE --backup ABSOLUTE_BACKUP_FILE --source-sha256 STOPPED_SOURCE_SHA256

OFFLINE ONLY. Stop every source writer before hashing or copying the source.
Hold the same external state-writer lock used for the entire daemon lifetime.
The Node store serializes one process only; atomic rename and identity checks
are not a cross-process compare-and-swap. No boolean flag proves lock ownership.

The target and backup must not exist. Startup does not auto-migrate or create
missing v3 state. Preserve the exact latest source backup for evidence, but
never use it as a fallback after v3 begins serving: old runtimes reject v3 and
cannot enforce its intent/device cutoffs. Rollback requires a v3-aware runtime
that preserves the latest v3 state, replay records, audit and intent receipts.

Linux launch shape (the lock remains held through exec until Node exits):
  /usr/bin/flock --nonblock --exclusive --no-fork /var/lib/ynx-wallet-gateway/product-session-state-writer.lock /usr/bin/node /opt/ynx/wallet-auth/packages/wallet-auth/scripts/ynx-wallet-gatewayd.mjs
Run this migration tool under exactly that lock as well, after stopping all
old writers. Set YNX_PRODUCT_SESSION_GATEWAY_STATE_VERSION=3 and an explicit
YNX_PRODUCT_SESSION_GATEWAY_STATE_PATH for the new daemon. Deployment must
independently verify that a competing daemon/migration cannot acquire the lock.
`;
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") { process.stdout.write(HELP); process.exit(0); }
try {
  if (args.length !== 8) throw new Error("Expected exactly four named migration arguments. Use --help.");
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!["--source", "--target", "--backup", "--source-sha256"].includes(args[index]) || values.has(args[index])) throw new Error("Unknown or duplicate migration argument");
    values.set(args[index], args[index + 1]);
  }
  const result = migrateProductSessionControlStateFileV2({ sourcePath: values.get("--source"), targetPath: values.get("--target"), backupPath: values.get("--backup"), expectedSourceDigest: values.get("--source-sha256") });
  process.stdout.write(`${JSON.stringify({ ...result, migrated: true, sourceWritersMustRemainStoppedUntilCutover: true })}\n`);
} catch (error) {
  process.stderr.write(`${error?.code ?? "MIGRATION_FAILED"}: ${error?.message ?? "Offline migration failed"}\n`);
  process.exitCode = 1;
}
