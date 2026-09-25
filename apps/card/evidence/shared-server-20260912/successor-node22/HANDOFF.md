# Card-only Node22 backend candidate

Source: `88378ba45917eb817dfed9847c0a9a21e4026ea8`; tree `22a68fd94dfd6c2774ae50385124a7df2e323a89`; branch `codex/card-funding-boundary-20260912`.
Wallet server SDK: `6f332753baae5deaf6b05c8276b20a02cc4887c5`.

Immutable source archive (155695 bytes):

- Local `/private/tmp/ynx-card-node22-6f-7FxZCg/card-server.tar.gz`.
- Host `43.153.202.237`: `/tmp/ynx-card-node22-6f-C41sdd/card-server.tar.gz`.
- SHA256 `379265dda56bdddb1c7fa8e69b16c6eb35e72d04b3747c71512e8e7fb69655fe`.

The remote archive hash matched before extraction into a new mode-0700 private directory. The actual `/usr/bin/node` v22.23.1 ran 32 storage/shared-authorizer/HTTP/Web-Origin tests successfully, then ran the exact source's `server/main.ts` with its fixed shared authentication consumer. The isolated process exited normally. This did not install a service, change public routes or use an existing account.

The loopback version route `/api/card/v1/version` returned HTTP200, 256 bytes, SHA256 `82bc846f702b19eb5852eebc0f08b6dfdce6f574e49f632a039a29352a905efc`, containing this exact source commit. Unauthenticated state returned HTTP401, 157 bytes, SHA256 `b67f6037d7e76eb9e30adc4cc97c05c8fcf9f453be9dd13184647bf949c267fe`, without card/ledger data.

A separate read-only request from the host to the coordinator-assigned `https://rpc.ynxweb4.com` returned `eth_chainId=0x1917` (HTTP200, 69 bytes, SHA256 `ecc6dc4ce2bf09de81103996247e25cd8ac2cf08b40220359c268790d8e32414`). This proves that read only, not a funding transaction or all Core methods.

## Next integration work

1. Provision and verify a dedicated controlled Card Testnet issuer recipient, following `server/deployment/CARD_TESTNET_ISSUER_PROPOSAL.md`; do not borrow a user/Finance/test-fixture address. Protect storage encryption and issuer recovery separately.
2. Install only the exact Card release/service at the assigned `/opt/ynx-card/releases/<source>` and `/var/lib/ynx-card`, loopback `18740`, with root-managed configuration. The service template fails preflight if required production configuration is absent. No empty deployed stub is counted as a product.
3. The coordinator alone serializes the exact shared Caddy route `/api/card/v1/...`; no Caddy or Vercel alias was changed here. The public URL remains `https://card.ynxweb4.com/` after approved backend/Web routing.
4. Card owner continues the actual 6f Native SDK/client/UI application request, protected pending/callback, fresh API proof, explicit Wallet business approval and recovery flow. Current UI is not claimed to use this private backend yet.
5. Actual authorized Session, signed application, backend ACTIVE receipt, exact YNXT transaction/receipt/ledger credit, Data Fabric and installed/public lifecycle evidence remain required. All those gates remain false here. Long-term regulated card readiness is separate; real-world payments/PAN/CVV/fiat remain false.

Only the loopback test process was started and stopped; there is no new installed-service/public rollback to perform from this slice. Retain previous immutable Card release and data compatibility rules before any future production switch. Failed local test attempts remain in sibling evidence directories; the final local gates were 90/90, typecheck and Web build passed.
