import { existsSync, writeFileSync } from "node:fs";
import { DurableSponsorshipAuthorizationLedger } from "../../src/sponsorship-ledger-node.js";
import { userOperationDigest } from "../../src/index.js";
import { vector } from "./sponsorship-vector.mjs";

const [, , statePath, nonceByte, readyPath, startPath] = process.argv;
const ledger = new DurableSponsorshipAuthorizationLedger({ statePath, maximumConsumed: 32 });
writeFileSync(readyPath, "", { mode: 0o600 });
while (!existsSync(startPath)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
const [operation, request, policy, binding, at] = vector();
request.requestNonce = Number(nonceByte).toString(16).padStart(2, "0").repeat(32);
request.userOperationDigest = userOperationDigest(operation);
ledger.authorize(operation, request, policy, binding, at);
