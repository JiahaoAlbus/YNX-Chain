# Actual local process cold and second start

Source: `13bfb94a2d5abd14ae26cbfa035b5b36c4cff5e4`.
Tree: `61881cd8092a106f8365618c610cfdf5d39ac4a5`.

Build: `go build -trimpath -ldflags '-X github.com/JiahaoAlbus/YNX-Chain/internal/quantlab.BuildCommit=13bfb94a2d5abd14ae26cbfa035b5b36c4cff5e4'` for `./apps/quant-lab/server`.

Local QA executable retained at
`/tmp/ynx-quant-source-startup-20261003.uZLIfC/ynx-quant-local-qa`:
Mach-O arm64, 11365506 bytes,
SHA256 `9b2974b7a1df595ded631e409dc1648bb24012cbbe150c263e5231410f86740e`.
This is an unsigned-status-unverified engineering executable, not a DMG,
installer, formally published artifact or public release.

Two real child processes were started sequentially from the owner worktree with
the same isolated temporary state path. Both were polled for readiness, queried,
then stopped by SIGTERM; each exited 0. No live service was stopped. No market,
private identity, credentials or tenant was configured. No state file was
created: this proves process restart and guest unavailable-state truth only,
not stored user recovery or multi-instance persistence.

Both launches returned identical receipts:

| Local route | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| / | 200 | 28381 | 8aefb6de883533363f1ba25957cb96742583399708e75ba8035a27bb538b73cd |
| /api/version | 200 | 274 | f1d1fe096c8252add1e9c8140b5483c7c1cd794f6951c781dc7780c6a80f1937 |
| /api/health | 200 | 462 | 2391c25f8d8a892b4cbcfa6d05224fa0b648665ee6176df049db731cb932ef7a |
| /api/v1/public/status | 200 | 433 | f82bce765544f0f1368c8d17bd2ea250c84536ceab6f204211bbaf711af61355 |

Each JSON response read back the exact source commit. Health said live funds
disabled. Public status said marketData unavailable and research/testnetExecution
false. Actual loopback ports were dynamically allocated, not product endpoints.
No account requests, signing, orders, transactions or shared-runtime changes.

Formal publication needs A's complete matching source/build graph. Real public
Wallet/private identity and the independent PostgreSQL concurrency gate remain
unverified. Do not promote these local receipts into public or installed proof.
