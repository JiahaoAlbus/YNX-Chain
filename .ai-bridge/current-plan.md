# YNX Wallet/Auth current plan

Status: Active. Current phase: FREEZE, with the observability checkpoint protected and the next autonomous safety slice in progress.

1. Preserve the source-bound canonical Gateway observability checkpoint: runtime source `2eb3198a99fcd98a1c6d56e3e99e97166ceab7f6`, evidence commit `2d07dd49c6bc737c49d6a8e205b6f2db99ce6fec`, local/upstream equality verified.
2. Complete the pending backup/restore drill with integrity, tamper, restart, RTO/RPO and version-compatibility evidence for Wallet/Auth state.
3. Run the targeted restore, migration, replay and release gates; review, commit, push and verify local/upstream SHA equality.
4. Reattempt current-source Android/iOS installed evidence only when a real emulator/device or full Xcode runtime exists.
5. Keep central Gateway/Monitor acceptance, shared Testnet, production signing, public URLs and store states false until direct owner/operator evidence exists.
