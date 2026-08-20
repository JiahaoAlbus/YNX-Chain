# Wallet Product Session v2 migration compatibility

The accepted v2 source is integrated through the single public root factory.
The prior Developer Wallet deployment surface remains present only as a
fail-closed compatibility path while v2 lacks native lifecycle evidence.

- Browser sessions cannot claim OS-protected v2 storage.
- The current macOS package actually found `ynxwallet` unavailable through
  `NSWorkspace URLForApplicationToOpenURL`; this proves only the absent-Wallet
  path, not a simulated installed Wallet.
- An unavailable `ynxwallet` scheme exposes download and Guest choices; Guest
  mode has no balance, transaction or Chain authority.
- Optional Product Session degradation never disconnects Standard Wallet.
- Developer must not accept endpoint, callback, origin, Session, clock or
  transport injection from product callers.
- `migratedV2` is false until runtime factory, public v2 route and the visible
  native lifecycle sequence all have direct evidence.

No legacy token is converted into a v2 Product Session, and no unverified
browser storage is used as a substitute for native secure storage.
