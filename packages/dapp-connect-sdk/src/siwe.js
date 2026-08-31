import {DAppConnectError} from "./errors.js";
export function createSiweMessage({domain, address, uri, chainId = 6423, nonce, issuedAt = new Date().toISOString(), statement} = {}) {
  if (!domain || !/^0x[0-9a-fA-F]{40}$/.test(address || "") || !uri || !nonce) throw new DAppConnectError("SIWE_INVALID_INPUT", "SIWE requires domain, 0x address, URI, and nonce.");
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${statement || "Sign in with YNX Wallet."}\n\nURI: ${uri}\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}
