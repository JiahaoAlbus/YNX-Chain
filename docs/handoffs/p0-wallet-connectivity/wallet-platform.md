# Wallet Platform Handoff

Checkpoint: `713bfe0f61dd3aa821eea0dba73801a6e723685a` on
`codex/p0-wallet-platform-20260820`; candidate PR #106.

The candidate adds Gateway-independent EIP-1193 state, EIP-6963 declaration,
durable inbound authorization state, Product Session degradation, and an honest
Faucet entry point. At handoff, 46/46 tests, TypeScript, product check, release
content check, and diff check passed.

Continue only from this candidate after the independent owner takes the lease:
accepted endpoint manifest, Android/iOS installed E2E, WalletConnect,
extension/DApp Browser, desktop scope, Faucet runtime repair, and individual
vector/download-cover/current-screenshot evidence. No extension, DApp Browser,
desktop, WalletConnect runtime, or public E2E is claimed by this checkpoint.

## Public desktop installer checkpoint — P0-142

- Website source `12a5113abb66a2ae5ebdab9fd553188a3a750f66`, Vercel deployment `dpl_3hXz9xTVEeqwYJ1oDrNnuo2FkaH2` is READY.
- macOS has a real universal DMG on the official downloads domain: 237777236 bytes, SHA-256 `69b4fa5db7b8a9ab105af6633de44f5a5a4a9fceeaa0925a306f77b22381b044`.
- Windows x64 has a direct EXE: 104334744 bytes, SHA-256 `856b2a260efc43c25f62508dabc6bb6b74b84da71c9b477e8a02a12d17598cd7`.
- Windows ARM64 was built and owner-tested with SHA-256 `929315133c68eda1cabac51cec889c4aeca5e3ee1701578916bc67e096c5dc35`, but is not yet publicly hosted.
- These are testnet previews. macOS is unsigned/not notarized and Windows Authenticode is `NotSigned`; neither is production-signed or store-released.
- The macOS DMG reaches native authorization review, but approval fails closed with `CANONICAL_AUTH_BRIDGE_UNAVAILABLE`. Windows installed authorization/account evidence is incomplete.
- Standard Wallet connection, account approval, callback, Product Session, signing and transaction remain false. Computer Control is blocked because the Mac is locked.

Next: preserve the public installers, repair native authorization, prove installed account/chain lifecycle on macOS and Windows, then publish and fully rehash ARM64 EXE.
