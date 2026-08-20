import {DAppConnectError} from "./errors.js";

export const COMPATIBILITY_SCENARIOS = Object.freeze([
  "eip6963-discovery", "eip1193-console", "walletconnect-qr-or-deep-link", "siwe-and-signing",
  "transaction-and-chain-switch", "account-chain-disconnect-events", "gateway-relay-api-down",
  "restart-network-interruption", "wrong-origin-chain-malformed-request", "product-session-degradation"
]);

/** Runs supplied real adapters; missing adapters are explicit skips, never simulated passes. */
export async function runCompatibilityLab({scenarios = {}, failOnSkipped = false} = {}) {
  const results = [];
  for (const name of COMPATIBILITY_SCENARIOS) {
    const scenario = scenarios[name];
    if (typeof scenario !== "function") { results.push({name, state: "SKIPPED", reason: "ADAPTER_NOT_PROVIDED"}); continue; }
    try { results.push({name, state: "PASSED", evidence: await scenario()}); }
    catch (error) { results.push({name, state: "FAILED", code: error?.code || "COMPATIBILITY_FAILURE", message: error?.message}); }
  }
  const failed = results.filter(result => result.state === "FAILED");
  const skipped = results.filter(result => result.state === "SKIPPED");
  if (failed.length || (failOnSkipped && skipped.length)) throw new DAppConnectError("COMPATIBILITY_LAB_FAILED", "Compatibility Lab did not meet its requested gate.", {details: {results}});
  return Object.freeze({tool: "ynx-dapp-connect-compatibility-lab", results, passed: results.filter(result => result.state === "PASSED").length, skipped: skipped.length});
}
