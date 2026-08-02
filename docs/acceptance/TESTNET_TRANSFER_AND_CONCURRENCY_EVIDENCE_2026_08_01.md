# YNX Testnet transfer, Bridge-boundary, and concurrency evidence

Status date: 2026-08-01 UTC. This is operator-observed public Testnet evidence, not independent third-party assurance or a Mainnet claim.

## 100 signed native transfers

- Network: YNX Testnet, numeric chain ID `6423`, native asset `YNXT`.
- Ephemeral self-custody sender: `0x0ba86056ba522defac3e990150abb8458efce37e` / `ynx1pw5xq4462gk7ltp7nyq4p2acgk80ecm7fl0xtr`.
- Funding transaction: `0xf2ed6ad1b00a075c5ed4111e28e36f7e7b1077895db251d310574b410246441f`, `400 YNXT` Testnet faucet value.
- The public authoritative RPC returned exactly 100 transactions from that sender with a contiguous nonce range `1..100` and no gap. The batch transferred `100 YNXT`, charged the deterministic `1 YNXT` fee 100 times, and left `200 YNXT` after nonce 100.
- The transactions were committed between blocks `711989` and `712133`. They were executed before the concurrent-admission release and therefore expose the former one-transaction-per-snapshot serialization behavior.
- The signing key was a disposable mode-`0600` secp256k1 Testnet key. It is excluded from every evidence file and service host.

## Ten Bridge-bound source transactions

Native nonces `91..100` were registered as YNXT source transactions in the Bridge coordinator. Every coordinator record remains `pending_attestations` and `externalSubmissionEnabled=false`; no external-chain asset movement, wrapped asset, destination finality, or spendability is claimed.

| Nonce | Source transaction | Coordinator transfer |
|---:|---|---|
| 91 | `0x53dd6e678dfd59a29f3eca43c853201b3d98d64d161e1239a99e74452a47fb0d` | `brg_8ada44754f584b93865a06c9` |
| 92 | `0x7d019d570cb0d5492a10b6936d91f2c889cfc42efdaad7480e1787b5b6679901` | `brg_9c0e24bfe2db257d33fa38a5` |
| 93 | `0x3d64c03493f1e6025750224b188ab5e59f59006934a0a40998da0c79f5d082cf` | `brg_dca3aed6bfd78a589b285074` |
| 94 | `0x4bea6ff80a311e5027fb6c0745d6967740b51f1e6c8decf36b83ab4e0c3af25f` | `brg_6af39aac6f2ad8a9507245f6` |
| 95 | `0x3765b3ccdfbe4f6d4a5e44aa5108f845f83e7e1b1f0024f8cebbff4e38af9a7b` | `brg_e54d2647f5efb3c0550f2b43` |
| 96 | `0x6c60619798b931cbf9f428faa0e08c854a35941641e0377c9955062bf39d5b93` | `brg_1e286aedb95795f53d11b1fd` |
| 97 | `0x8f91aa27e0eb82d5093728df8e280bb7a215b4cbedc517a50fdf608203cebe23` | `brg_34966bf3fec05d26c8b05b58` |
| 98 | `0xb073860eb4254856930251be69ec55b9b5d20d20f6a27c0203047d2b820384f3` | `brg_c778da079ed374c6cadc3df6` |
| 99 | `0x6c03b827ce6ca4530a439351d1771b9e9f5091a46549bffdc009e20d97483be7` | `brg_ca0c5a7036bfde1593f53410` |
| 100 | `0x3553978e85dfbf616d77cc951f8bcedc1ca05014e01fe30f0c31544032c7ff6b` | `brg_2d73d8fa0bd120c5d5bf91c2` |

After registration, `ynx-bridged` reported 20 coordinator records total, `liveBridge=false`, and `externalSubmissionEnabled=false`. The external execution boundary is intentionally fail-closed until verified contracts, provider support, custody, funding, destination proof, and independent approval exist.

## Concurrent multi-transaction block

Release `ynx-chain-b264945f5d9d` changes native Faucet/transfer admission to standard mempool semantics: accepted but uncommitted transactions are held in memory and the block producer persists the complete block atomically. It removes a synchronous full-history snapshot rewrite from each admission.

- `go test ./...` passed at source commit `b264945f5d9d1d10a893d7521e4529dc3d39ca0c`.
- The focused regression starts 100 concurrent transfers, commits one block, verifies all 100 transactions are present, and reloads the durable block from disk.
- A live 20-client Testnet probe submitted 20 transfers in `4,247 ms`.
- All 20 committed in block `712332`, hash `5ecc74fcea0518de0c826b1f4081be4442bc2586eae5b9d5462c097c00484477`.
- The block contains `20 YNXT` of transfer value and `20 YNXT` of fees. Its reported producer is `ynx_validator_seoul`.

The live probe used the operator Testnet transfer admission route to isolate concurrent state admission from client-side signature generation. The public signed endpoint retains exact chain binding, signature, nonce, amount, fee, balance, and replay checks. Production-scale capacity, multi-replica writes, and a Mainnet SLO remain separate unproven claims.

## Historical block semantics

Block `1` remains readable at the authoritative RPC with hash `a832fa23553f239a4a349320df93c17b885e887bec39ae52dbb12073ff35bb3b` and zero transactions. A historical block is immutable and cannot accept a new transaction now; new transfers can only enter a future block. Explorer search should retrieve block `1` without implying that past blocks are editable.
