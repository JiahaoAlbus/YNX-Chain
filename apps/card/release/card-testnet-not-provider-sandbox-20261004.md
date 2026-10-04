# Card is YNX Testnet; Guest is a local demo

User requested continued owned work, independent retrieval of existing inputs, and correction that YNX is Testnet rather than an already-operated provider sandbox. This is a terminology and concrete provider-compatibility checkpoint, not a deployment or full-product completion.

Changes: all twelve existing product locale environment labels now identify YNX Testnet, rather than combining Testnet and Sandbox. English lifecycle copy says Testnet card created/Testnet spending limit. Guest product badge is YNX TESTNET; its local interaction boundary says LOCAL DEMO in twelve locales, retaining no-real-funds/PAN/CVV/personal-data disclaimer. The existing Arabic guest assertion now expects the localized local-demo boundary, not the old sandbox string. No local fixture is promoted to a real account, balance, chain transaction or provider service.

Actually executed: new owned catalog tests2/2; frontend/server compiler-only typecheck after guest changes passed. Existing guest renderer suite NOT_RUN in this restricted checkpoint because its mounting graph is outside the current no-actual-SDK gate. No claim of actual rendered public branding update. Original i18n and Guest behavior otherwise retained. Two relative-path command attempts failed before the intended guest writes; corrected commands applied in apps/card. Original earlier catalog typecheck log retained separately; final testnet-and-demo-typecheck log is the post-guest compiler result.

## Independently retrieved official provider facts

Read on2026-10-04:
- https://docs.immersve.com/resources/public-sandbox-account/
- https://docs.immersve.com/guides/universal-evm-funding-protocol/
- https://docs.metamask.io/metamask-connect/

Immersve documents a public Test API at https://test.immersve.com, with public sandbox partner account credentials that may be revoked. Its public example funding type is polygon-amoy-usdc-universal-evm-test; its public frontend allowed origin is http://localhost:3000. This is a real documented third-party testing environment, not proof of this Card origin admission or YNX/YNXT support. Credentials were not copied into source, configuration or evidence; no provider API account/write/funding/PAN request made.

Owned source already contains ImmersveSandbox at fixed Test origin and CardProviderLifecycle. The adapter doctor explicitly reports ynxtChainSupported=false/tusdSupported=false/cardLedgerCredited=false; provider operation reservations must not create Card ledger credit from a response alone. These files were inspected, not changed or executed. An existing adapter is not a configured or deployed account. Third-party sandbox cannot replace the YNX Testnet YNXT flow or authorize its private users. No new provider dependency, account, credential, grant, registry mutation or USDC substitution.

MetaMask official integration docs confirm installed EIP-6963/EIP-1193 discovery for EVM networks; source inspection or docs alone is not real provider approval. Existing distinct YNX/MetaMask identity remains intact, without Web custom schemes.

Full goal remains real usable Testnet application/registration, YNX/MetaMask connection, actual YNXT transaction accepted by backend, simulated merchant lifecycle, statements/recovery. Remaining current authority/source-pair/Host input belongs to A and is not a request for human keys or blanket permission. Owned changes continue independently; latest source must be matched by formal build/runtime before public testing. No real issuance/PAN/CVV/fiat/real merchant clearing or Product Session migration claimed.
