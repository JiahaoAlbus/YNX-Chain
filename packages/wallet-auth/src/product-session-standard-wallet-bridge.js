import { WalletAuthError } from "./canonical.js";
import { PRODUCT_SESSION_CLIENT_STATE } from "./product-session-recovery.js";
import { reduceStandardWalletConnectState } from "./standard-wallet-connect-state.js";

// This adapter belongs to the Product Session side of the boundary.  The
// Layer 1 reducer deliberately imports neither Gateway nor Product Session
// code, so a private-service failure can never become a Standard Wallet
// connection prerequisite.
const DEGRADATION_CODES = new Set(["GATEWAY_UNAVAILABLE", "ROUTE_NOT_MOUNTED"]);

/**
 * Converts only authoritative, machine-readable Product Session states into
 * the existing Standard Wallet private-service events.  `null` means that
 * there is no safe private-service transition to apply; callers must retain
 * their current Layer 1 state rather than guessing an error classification.
 */
export function productSessionStateToStandardWalletPrivateServiceEvent(productSessionState) {
  if (!object(productSessionState) || !Object.values(PRODUCT_SESSION_CLIENT_STATE).includes(productSessionState.status)) {
    fail("INVALID_PRODUCT_SESSION_STATE", "Product Session state cannot be mapped to Standard Wallet state");
  }
  switch (productSessionState.status) {
    case PRODUCT_SESSION_CLIENT_STATE.CONNECTING:
      return frozen({ type: "PRIVATE_SESSION_CONNECTING" });
    case PRODUCT_SESSION_CLIENT_STATE.CONNECTED:
      return frozen({ type: "PRIVATE_SESSION_READY" });
    case PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE:
      return degradationEvent(productSessionState.code, PRODUCT_SESSION_CLIENT_STATE.NETWORK_UNAVAILABLE);
    case PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED:
      return DEGRADATION_CODES.has(productSessionState.code) ? degradationEvent(productSessionState.code, PRODUCT_SESSION_CLIENT_STATE.RETRY_REQUIRED) : null;
    default:
      // Guest, disconnected, and unclassified retry states have no Product
      // Session authority and must not alter an independently established
      // Standard Wallet connection.
      return null;
  }
}

/**
 * Convenience bridge for shared consumers.  The Standard Wallet reducer
 * still enforces selected-provider + approved-account + 0x1917 before it
 * accepts any private-service transition.
 */
export function applyProductSessionStateToStandardWallet(standardWalletState, productSessionState) {
  const event = productSessionStateToStandardWalletPrivateServiceEvent(productSessionState);
  return event === null ? standardWalletState : reduceStandardWalletConnectState(standardWalletState, event);
}

function degradationEvent(value, status) {
  if (!DEGRADATION_CODES.has(value)) fail("UNCLASSIFIED_PRODUCT_SESSION_FAILURE", `Product Session ${status} state lacks a canonical private-service failure code`);
  return frozen({ type: "PRIVATE_SESSION_DEGRADED", code: value });
}
function frozen(value) { return Object.freeze(value); }
function object(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function fail(code, message) { throw new WalletAuthError(code, message); }
