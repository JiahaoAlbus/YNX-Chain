# Original contract selector capability — Native/Desktop parity

Inherited full source: fe914490418b3a590f1d01d483feefa583e23d8e. No A App/startup/versions, SDK/Auth/Host/registry, native profile/key/outbox or formal installer writes. Native App stays exact SHA256 05beb31d869cff8955892bfd77095199e38b05dbdc64579e2580bb9dc88ceb73.

## Production correction

Original internal/chain/devnet.go extractContractFunctions uses SHA256 hashParts("evm-selector", signature), with a NUL after each part. This source-analyzer identity is not Ethereum Keccak. Original internal/chain/compiler.go hardhatABIFunctions uses the pinned Hardhat/ethers Keccak selector metadata. The previous Wallet parsers checked only selector syntax; they accepted cross-profile selectors and a source-analyzer bytecodeSelectorMatched claim.

Both current production clients now compute the exact expected selector per existing artifactKind. The optional selectorSource must match that original kind when present. Source-analyzer metadata cannot claim a solc bytecode selector match; its read result also cannot make that claim. The BFT pinned code registry, original routes, pure/view-only gate, stored-origin/account lifecycle, read bounds and request/result/artifact fences are unchanged. No legacy/BFT automatic fallback, Ethereum execution, signing, deployment or state-changing request is added.

An old synthetic test paired readValue() with 0x20965255, which is actually getValue()'s Keccak selector, and also reused it in source-analyzer mode. Correct independent values are source-analyzer readValue() = 0x56e5e2f3 and Keccak readValue() = 0x82da2e57. Tests now use the correct original wire identity, not a policy exemption.

Before fix: two added rejection tests failed in each client (9 PASS / 2 FAIL). The initial corrected run also exposed the invalid old Keccak fixture (Native 9/11, Desktop plus mounted 11/13); those logs remain intact. After correcting that fixture and adding original Go compatibility data: Native contract 12/12, Desktop contract/mounted 14/14 PASS.

## Independent original Go compatibility

scripts/contract-analyzer-fixture.go actually runs the original Go analyzer in a new in-memory Devnet, with a synthetic account/faucet/deployment used only inside that process. No network call, protected profile, key or public deployment occurs. Its complete original artifact/read output is retained as src/chain/testdata/source-analyzer-go-v1.json SHA256 00e370b7d4f6018dfc63a6a8b9cb1d72cbfb4033271bfb51953a8b9c3c32a381.

Both clients consume that Go artifact and its uint/bool results. Original ping() selector 0xc0a40ef8 and ok() selector 0x1350e754, original literal results 7/true and encoded words, source_analyzer_literal_return status, no execution engine and false bytecode selector match remain intact. Read calls use only chain-ID/legacy lookup/read/relookup/chain-ID routes.

A second actual go run reproduced all protocol metadata/results; in-memory creation timestamp and the deployment address derived from that new instance are volatile. Each original address was checked against its own read records before excluding those volatile fields for comparison. An initial comparison excluding only timestamp failed because address also changed; neither frozen fixture nor regenerated output was rewritten or represented as a public state record. The raw regenerated JSON remains contract-analyzer-go-regenerated.log.

## Verification

Native isolated admitted-SDK955 candidate /tmp/ynx-wallet-android-inheritance-clean-test-20261003-1ZEdhW/apps/wallet:

- contract-selector-go-targeted.log: 12/12, SHA256 8e889a94dff3e1924b244b4fcecb97aa64515690c329ff58af029ca615bbd993
- contract-selector-go-full-regression.log: 929/929, no failures/cancellations/skips, exit 0; SHA256 effe357779c5a881e56ac698ad707ff0634e91d4f05aba3942810a376a8ceb2e
- contract-selector-go-typecheck.log: tsc exit 0, empty SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
- contract-selector-android-export.log: Hermes exit 0; SHA256 03fd7b36072f40248012fb687148856e248d8121e5c2bbb4f1f3395eca371132; bundle index-c76620bab7b29ea7b94ba5c587e9d2d6.hbc
- contract-selector-ios-export.log: Hermes exit 0; SHA256 d2d68b8c6760a52a91e68b6e19b4f9ff3feac75fe100d9b69edee44a47a83174; bundle index-2d901ebd08931fc60b7f11469f824673.hbc

Desktop isolated candidate /tmp/ynx-wallet-published-inheritance-test-20261003-weuJ6Z/apps/wallet-desktop:

- contract-selector-go-targeted.log: 14/14, SHA256 b4334bf00630dcf0a1672f48b146fda7a54c3147c2e8d5b26d079a91ced24e59
- contract-selector-go-full-regression.log: 670/670, no failures/cancellations/skips, exit 0; SHA256 9b3f709605b04dfd34487888dd3cc59befd9e4c3bd2b300031fc44e60dfadfc9

Release content check passes across 99 runtime/config/metadata files. Existing dependency-export warnings stay visible. Typechecks, synthetic original Go compatibility and Hermes exports do not verify installed UX, OS protected ports or public business flows.

## Actual public read and remaining gate

At 2026-10-03T13:23:47.034Z, direct credential-free, redirect-refusing GET /status and GET /explorer/summary on the original canonical https://rpc-testnet.ynxweb4.com returned HTTP200 with expected chain6423, build65efa82e0615, mainnetReady false and node-reported contractCount0. Exact small selected-field observation is docs/evidence/public-contract-inventory-20261003.json, matching the raw current log SHA256 1812b80b219c34f26da7461edb4d8061ca84f05824138a6eff4ccff29b2d153e.

This observes that node's reported inventory at that time, not universal absence of every contract, consensus proof or a successful contract read. Earlier GET /ide/contracts and guessed /summary returned405; bounded latest25 transaction discovery did not supply a contract deployment. No alternate endpoint, target address or fake deployment was substituted. A/contract owner must supply an authoritative existing supported target/expected read or explicit authority for their own deployment workflow before actual public contract read can be accepted. Native does not deploy one to make the gate green.

Five A-locked Dashboard bilingual entries, actual Wallet session tuple/protected OS/business composition, rendered fonts/RTL/device scanner, sole-A forward installers/website install/actual payment/user acceptance remain open. Real external inputs and MONSTER remain NOT_VERIFIED; keep the full original goal active.
