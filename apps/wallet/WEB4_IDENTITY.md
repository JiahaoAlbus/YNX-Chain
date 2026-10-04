# Unified Web4 identity contract

The Wallet is the identity, device, permission and signing root; every consuming product remains independent. The canonical sequence is Authorization Request → Wallet Approve/Reject → P-256 product-device challenge → Gateway Completion → Product Session → Introspection → Expiry/Revoke.

Every request binds network, product, client, bundle, callback, device public key, account, ordered scopes, purpose, nonce, timestamps and request digest. Approval and session add approval digest, device binding and session binding. Unknown fields, scope reorder/widening, callback replacement, wrong product/device/account, future time, replay, tampered storage and revoked state fail closed.

Sensitive execution additionally requires a human-approved Signed Intent. AI may explain or propose the displayed intent but cannot produce the Wallet signature, change fields, approve, broadcast, revoke, withdraw or alter risk. Evidence records distinguish YNX authoritative state, third-party state, estimates, AI inference, cache and user input with source/as-of/version and failure status.
