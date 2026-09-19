import { parseProductSessionRegistry } from "@ynx-chain/wallet-auth";
import registry from "../../../../packages/wallet-auth/product-session-registry.json";

// Use the same reviewed product, platform, origin and callback bindings as Auth.
export const PRODUCT_SESSION_REGISTRY = parseProductSessionRegistry(registry);

export const SCOPE_EXPLANATIONS: Readonly<Record<string, string>> = Object.freeze({
  "account:read": "Share this account's public ynx1 address. No secret or recovery material leaves Wallet.",
  "card:application:write": "Create or update only this account's sandbox Card application.",
  "card:controls:write": "Manage only this account's Card controls after a separate review.",
  "card:dispute:write": "Create and update this account's Card disputes; it cannot move funds.",
  "pay:case:create": "Create a Pay support case for this account without authorizing a transfer.",
  "pay:settlement:submit": "Submit a settlement request for separate Pay review; Wallet approval is not a payment signature.",
  "profile:link": "Allow this exact Social device to link the public account to its profile.",
});
