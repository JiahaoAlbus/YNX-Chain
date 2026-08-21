// Browser-safe compatibility surface for the accepted state-only contract.
// The authoritative reducer imports only WalletAuthError from canonical.js.
export class WalletAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WalletAuthError";
    this.code = code;
  }
}
