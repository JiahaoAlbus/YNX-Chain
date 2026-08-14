import { DurableSponsorshipAuthorizationLedger } from "../../src/sponsorship-ledger-node.js";
import { userOperationDigest } from "../../src/index.js";
import { vector } from "./sponsorship-vector.mjs";

const [operation, request, policy, binding, at] = vector();
request.userOperationDigest = userOperationDigest(operation);
const ledger = new DurableSponsorshipAuthorizationLedger({ statePath: process.argv[2], maximumConsumed: 2, onCommitted: () => process.kill(process.pid, "SIGKILL") });
ledger.authorize(operation, request, policy, binding, at);
