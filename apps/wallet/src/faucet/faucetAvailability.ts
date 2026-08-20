/** P0 Wallet UI policy for Faucet availability. This is intentionally strict:
 * a public link may be offered, but an endpoint without the signed endpoint
 * manifest plus public health/version proof is never represented as online. */

export const OFFICIAL_FAUCET_URL = "https://faucet.ynxweb4.com";

export type FaucetAvailability = Readonly<{
  phase: "AVAILABLE" | "DEGRADED";
  diagnostic: "READY" | "ENDPOINT_MANIFEST_UNACCEPTED" | "HEALTH_UNVERIFIED" | "VERSION_PROOF_INCOMPLETE" | "UNSAFE_RESPONSE";
  title: string;
  detail: string;
  actionURL: string;
}>;

export function faucetAvailability(input: Readonly<{ endpointManifestAccepted: boolean; healthVerified: boolean; versionVerified: boolean; responseLeaksLoopback: boolean }>): FaucetAvailability {
  if (input.endpointManifestAccepted && input.healthVerified && input.versionVerified && !input.responseLeaksLoopback) {
    return Object.freeze({ phase: "AVAILABLE", diagnostic: "READY", title: "Testnet Faucet", detail: "Verified Faucet service for YNXT on YNX Testnet.", actionURL: OFFICIAL_FAUCET_URL });
  }
  const diagnostic = input.responseLeaksLoopback ? "UNSAFE_RESPONSE" : !input.endpointManifestAccepted ? "ENDPOINT_MANIFEST_UNACCEPTED" : !input.healthVerified ? "HEALTH_UNVERIFIED" : "VERSION_PROOF_INCOMPLETE";
  const detail = diagnostic === "VERSION_PROOF_INCOMPLETE"
    ? "Faucet version proof is incomplete. Only Testnet Faucet is degraded; Wallet accounts, public chain reads, and Connected Apps remain separate."
    : diagnostic === "UNSAFE_RESPONSE"
      ? "Faucet returned an unsafe endpoint response. Only Testnet Faucet is degraded; Wallet accounts, public chain reads, and Connected Apps remain separate."
      : diagnostic === "HEALTH_UNVERIFIED"
        ? "Faucet health is not verified. Only Testnet Faucet is degraded; Wallet accounts, public chain reads, and Connected Apps remain separate."
        : "The accepted public Faucet endpoint manifest is unavailable. Only Testnet Faucet is degraded; Wallet accounts, public chain reads, and Connected Apps remain separate.";
  return Object.freeze({
    phase: "DEGRADED",
    diagnostic,
    title: "Testnet Faucet needs verification",
    detail,
    actionURL: OFFICIAL_FAUCET_URL,
  });
}
