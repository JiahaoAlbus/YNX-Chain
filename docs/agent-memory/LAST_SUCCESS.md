# YNX Calendar last success

At 2026-08-13T12:02:00Z, runtime source `635f6745db8b5d4e4f00253d72fd5ab97da471ac` was built as a Linux binary, SHA-256 `b74820c013771f29a5b106f7c9ec36e274c64c2501d101afbcb51492d84270ed`, deployed with rollback backup `/var/backups/ynx-chain/calendar-before-635f6745`, and verified externally.

The checkpoint provides:

- explicit Calendar state payload schema version 1;
- authenticated legacy schema-zero compatibility and future-schema fail-closed behavior;
- deterministic HMAC-authenticated backup with state SHA-256;
- isolated restore that never overwrites live state;
- rejection of tamper, wrong product, incompatible version, stale/future time, absolute/path escape, symbolic-link traversal and existing targets;
- operator backup/restore CLI and local restore drill;
- browser-proof reliability hardening with process-derived port ranges, a bounded 45-second health wait and bounded server/process cleanup;
- passing Go, Race, Vet, npm test, release test, build, statectl build, smoke and two consecutive browser-proof runs;
- validated JSON/JSONL evidence, release records, integration vector CAL-X-013, operations, migration, observability, SLO/capacity and unit-economics documentation.
- a 390px week-view gate requiring all seven date headers and zero horizontal overflow;
- exact public build identity plus matching served CSS/JavaScript;
- canonical Wallet public two-user lifecycle, restart persistence and 100/100 authenticated concurrent reads retained from the prior public acceptance run.

GitHub inspection for `06f8b2bc` returned no pull request and no workflow runs. The repository release list contained no current-source Calendar release; the historical `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f` prerelease remains test-only evidence.

The current public proof is `https://www.ynxweb4.com/dapp/calendar` plus `https://calendar-testnet.43.153.202.237.sslip.io/` and its exact-build health endpoint. `websitePublished` and `deployedPublic` are true; current-source native downloads, production scheduling, signing, stores and wider central integration remain false.
