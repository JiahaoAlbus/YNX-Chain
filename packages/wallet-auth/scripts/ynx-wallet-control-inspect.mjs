#!/usr/bin/env node
import { inspectProductSessionControlStateFile } from "../src/product-session-control-node-store.js";

// Does not construct a serving host, normalize a file, migrate or write a lock.
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--state") throw new Error("Usage: node ynx-wallet-control-inspect.mjs --state ABSOLUTE_V2_OR_V3_FILE");
  const capacityPolicy = process.env.YNX_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY === undefined ? undefined : JSON.parse(process.env.YNX_PRODUCT_SESSION_CONTROL_CAPACITY_POLICY);
  process.stdout.write(`${JSON.stringify(inspectProductSessionControlStateFile({ statePath: args[1], capacityPolicy }))}\n`);
} catch (error) {
  process.stderr.write(`${error?.code ?? "INSPECTION_FAILED"}: ${error?.message ?? "Read-only state inspection failed"}\n`);
  process.exitCode = 1;
}
