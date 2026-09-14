/** P0 Wallet UI policy for Faucet availability. This is intentionally strict:
 * a public link may be offered, but an endpoint without the signed endpoint
 * manifest plus public health/version proof is never represented as online. */

export const OFFICIAL_FAUCET_URL = "https://faucet.ynxweb4.com";

export type FaucetAvailability = Readonly<{
  phase: "AVAILABLE" | "DEGRADED";
  title: string;
  detail: string;
  actionURL: string;
}>;

export function faucetAvailability(input: Readonly<{ endpointManifestAccepted: boolean; healthVerified: boolean; versionVerified: boolean; responseLeaksLoopback: boolean }>): FaucetAvailability {
  if (input.endpointManifestAccepted && input.healthVerified && input.versionVerified && !input.responseLeaksLoopback) {
    return Object.freeze({ phase: "AVAILABLE", title: "Testnet Faucet", detail: "Verified Faucet service for YNXT on YNX Testnet.", actionURL: OFFICIAL_FAUCET_URL });
  }
  return Object.freeze({
    phase: "DEGRADED",
    title: "Testnet Faucet needs verification",
    detail: "The official Faucet page can be opened, but this Wallet will not claim the service is online until the accepted endpoint manifest and public health/version evidence are complete.",
    actionURL: OFFICIAL_FAUCET_URL,
  });
}
