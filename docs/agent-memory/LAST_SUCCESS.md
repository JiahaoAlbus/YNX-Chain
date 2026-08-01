# YNX Calendar last success

At 2026-08-01T14:52:31Z, evidence checkpoint `06f8b2bce60780ca27cf71a0705bfdf060dc57f6` was committed and pushed to `origin/codex/final-calendar`. Local and remote SHAs matched and Ahead/Behind was `0/0`. Runtime source remains `b00f32da16218edb90fcc9f9b504607e374077ce`.

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

GitHub inspection for `06f8b2bc` returned no pull request and no workflow runs. The repository release list contained no current-source Calendar release; the historical `ynx-mail-calendar-v0.2.0-testnet-preview-e227c4f` prerelease remains test-only evidence.

The public probe still does not qualify as deployment evidence: `https://ynxweb4.com/calendar` redirects to `https://www.ynxweb4.com/dapp/calendar`, serves the generic YNX Chain homepage title, has no Calendar-specific H1 and declares canonical `https://ynxweb4.com/`. `websitePublished` and `deployedPublic` remain false.
