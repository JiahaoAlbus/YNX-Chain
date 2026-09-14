import assert from "node:assert/strict";
import test from "node:test";
import { faucetAvailability, OFFICIAL_FAUCET_URL } from "./faucetAvailability";

test("Faucet stays degraded until the accepted endpoint manifest and public proof are complete", () => {
  const state = faucetAvailability({ endpointManifestAccepted: false, healthVerified: true, versionVerified: false, responseLeaksLoopback: true });
  assert.equal(state.phase, "DEGRADED");
  assert.equal(state.actionURL, OFFICIAL_FAUCET_URL);
  assert.match(state.detail, /will not claim/i);
});

test("Faucet becomes available only with all P0 endpoint checks", () => {
  assert.equal(faucetAvailability({ endpointManifestAccepted: true, healthVerified: true, versionVerified: true, responseLeaksLoopback: false }).phase, "AVAILABLE");
});
