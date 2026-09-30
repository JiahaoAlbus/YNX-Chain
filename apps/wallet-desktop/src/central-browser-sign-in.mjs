import { walletIdentity } from "@ynx-chain/wallet-auth";
import { createRequire } from "node:module";
import { PRODUCT_SESSION_REGISTRY } from "./wallet-auth-contract.mjs";

// Consume the exact shared contract; never import the Node-only Gateway host.
const base = import.meta.resolve("@ynx-chain/wallet-auth");
const requireAuth = createRequire(base);
const { secp256k1 } = await import(requireAuth.resolve("@noble/curves/secp256k1.js"));
const { sha256 } = await import(requireAuth.resolve("@noble/hashes/sha2.js"));
const { bytesToHex, hexToBytes, utf8ToBytes } = await import(requireAuth.resolve("@noble/hashes/utils.js"));
const contract = await import(new URL("./central-browser-session-contract.js", base));
const { createCentralBrowserSessionRegistry } = await import(new URL("./central-browser-session-registry.js", base));
const registry = createCentralBrowserSessionRegistry(PRODUCT_SESSION_REGISTRY);
export const CENTRAL_BROWSER_METHOD = contract.CENTRAL_BROWSER_RPC_METHOD;
export function parseCentralSignIn(params, origin, now = Date.now()) {
  if (!Array.isArray(params) || params.length !== 1) throw Object.assign(new Error("Expected one central sign-in challenge"), {code:"SSO_CHALLENGE_INVALID"});
  return contract.parseCentralBrowserSignInChallenge(params[0], registry, {peerOrigin:origin, now});
}
export function signCentralSignIn(challenge, origin, secret, now = Date.now()) {
  const checked = parseCentralSignIn([challenge], origin, now);
  const identity = walletIdentity(secret);
  const bytes = utf8ToBytes(contract.centralBrowserConsentSignBytes(checked, identity.account, identity.accountPublicKey));
  const signature = secp256k1.sign(sha256(bytes), hexToBytes(secret), {prehash:false, format:"compact", lowS:true});
  return contract.parseCentralBrowserSignInApproval({challengeId:checked.challengeId, ...identity, walletSignature:bytesToHex(signature)});
}
