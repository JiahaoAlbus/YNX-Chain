const canonicalRequest = /^[A-Za-z0-9_-]{32,}$/u;

const outcome = (code, message) => Object.freeze({ intercept: true, code, message });

/**
 * A browser preview cannot turn an external URI into a Wallet connection on
 * its own. Keep unsupported transports in the current tab and make the
 * absence explicit instead of opening a blank protocol page or inventing a
 * session.
 */
export function inspectWalletTransportURL(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value));
  } catch {
    return Object.freeze({ intercept: false });
  }

  const scheme = url.protocol.toLowerCase();
  if (scheme === "wc:" || scheme === "walletconnect:") {
    return outcome(
      "WALLETCONNECT_NOT_CONFIGURED",
      "WalletConnect is not configured in this preview. The request was not opened; no account, session, signature, or transaction was created."
    );
  }

  if (scheme !== "ynxwallet:" && scheme !== "ynx-wallet:") return Object.freeze({ intercept: false });
  if (scheme !== "ynxwallet:") {
    return outcome(
      "CANONICAL_WALLET_SCHEME_REQUIRED",
      "This Wallet request uses an unsupported scheme. It was not opened and no Wallet state changed."
    );
  }
  if (url.hostname !== "authorize" || url.port || url.username || url.password || url.hash) {
    return outcome(
      "CANONICAL_WALLET_ROUTE_REQUIRED",
      "This Wallet request does not use the canonical authorize route. It was not opened and no Wallet state changed."
    );
  }

  const query = [...url.searchParams.entries()];
  if (query.length !== 1 || query[0][0] !== "request" || !canonicalRequest.test(query[0][1])) {
    return outcome(
      "CANONICAL_WALLET_REQUEST_REQUIRED",
      "A complete canonical Wallet request is required. This link was not opened and no Wallet state changed."
    );
  }
  return outcome(
    "CANONICAL_WALLET_BRIDGE_UNAVAILABLE",
    "This browser preview has no approved canonical Wallet transport bridge. The request was not opened; no account, session, signature, or transaction was created."
  );
}
