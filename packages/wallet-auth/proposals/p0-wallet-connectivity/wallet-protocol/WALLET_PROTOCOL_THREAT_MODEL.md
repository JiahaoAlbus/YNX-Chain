# Wallet protocol threat model — Candidate

The protocol rejects provider impersonation, ambiguous EIP-6963 announcements, raw `eth_sign`, callback and origin substitution, package/device/account/product substitution, scope expansion or reorder, replay, clock skew, stale state and response loss. Product Session proof uses canonical JSON, P-256 DER signature verification, base64url canonicalization and replay state. Logs record only request IDs and hashes; they never record seed phrases, private keys, device secrets, WalletConnect symmetric keys, full signatures, or long-lived tokens.
