# YNX Calendar last success

At 2026-08-08T18:57:46Z, runtime source `9abb16167f3e862447d731cba91f6b37a8b82d34` was built as a Linux binary, SHA-256 `18d03deb535fd2df14ea755bdfa34bdd8604d51e9b16c485ad1cc990717ba0fe`, deployed with rollback backup `/var/backups/ynx-chain/calendar-before-9abb1616`, and verified externally.

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
