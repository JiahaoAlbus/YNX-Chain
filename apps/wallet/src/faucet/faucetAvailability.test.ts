import assert from "node:assert/strict";
import test from "node:test";
import { faucetAvailability, OFFICIAL_FAUCET_URL } from "./faucetAvailability";

test("Faucet stays degraded until the accepted endpoint manifest and public proof are complete", () => {
  const state = faucetAvailability({ endpointManifestAccepted: false, healthVerified: true, versionVerified: false, responseLeaksLoopback: true });
  assert.equal(state.phase, "DEGRADED");
  assert.equal(state.diagnostic, "UNSAFE_RESPONSE");
  assert.equal(state.actionURL, OFFICIAL_FAUCET_URL);
  assert.match(state.detail, /Only Testnet Faucet is degraded/i);
});

test("missing version proof is precisely degraded without taking Wallet or chain offline", () => {
  const state = faucetAvailability({ endpointManifestAccepted: true, healthVerified: true, versionVerified: false, responseLeaksLoopback: false });
  assert.deepEqual({phase:state.phase,diagnostic:state.diagnostic},{phase:"DEGRADED",diagnostic:"VERSION_PROOF_INCOMPLETE"});
  assert.match(state.detail, /Only Testnet Faucet is degraded/i);
  assert.match(state.detail, /Wallet accounts, public chain reads, and Connected Apps remain separate/i);
});

test("Faucet becomes available only with all P0 endpoint checks", () => {
  assert.deepEqual(faucetAvailability({ endpointManifestAccepted: true, healthVerified: true, versionVerified: true, responseLeaksLoopback: false }).diagnostic, "READY");
});
