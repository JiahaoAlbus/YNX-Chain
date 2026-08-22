# P0 Release Acceptance

No release passes because a web page works. Each product-platform artifact must
prove its package identity, source SHA, artifact SHA-256, endpoint-manifest
version, artwork version, public data, standard wallet connection, private
session state, signing, transaction result where applicable, and exact error
classification.

Required negative cases include Gateway unavailable, invalid or expired device
proof, wrong chain, revoked session, missing deep-link callback, retired client,
and invalid endpoint manifest. A failed Product Session may degrade a private
feature only; it cannot delete EIP-1193, WalletConnect, SIWE, signing, or normal
on-chain transaction capability.

Shop Android is accepted as retired only after its build/publish channel,
website/download listing, callback/App Link, sessions, approvals, and device
grants are disabled and new requests return `CLIENT_RETIRED`.
