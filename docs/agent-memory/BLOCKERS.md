# Blockers

## YNX18-B01 — Website canonical conflict

- Owner: YNX 28 Website / SEO / Product Micro-sites
- Evidence: `release/evidence/website-public-audit-2026-07-29.json`
- Cause: `/what-is-ynx-chain` emits both the site-root canonical and route canonical.
- Prepared: exact route, observed HTML finding, official-domain rule and acceptance criteria.
- Why YNX 18 cannot resolve it: Website rendering is outside this worktree and owner boundary.
- Minimum input: a YNX 28 commit/deployment that emits exactly one route canonical.
- Resume condition: route HTML proves one canonical equal to `https://ynxweb4.com/what-is-ynx-chain`.
- First action after input: ingest deployment evidence, rerun public audit and update Website Handoff.

## YNX18-B02 — Integration compatibility

- Owner: YNX 29 Integration
- Evidence: branch is 10 commits ahead of and 47 commits behind `origin/main` at checkpoint.
- Cause: concurrent product integration on main.
- Prepared: versioned contract, handoff, test vectors, evidence and exact source commits.
- Why YNX 18 cannot resolve it alone: a broad merge could overwrite sibling-owner work or violate merge order.
- Minimum input: accepted merge order or exact compatibility decision from YNX 29.
- Resume condition: integration owner identifies the accepted source and migration strategy.
- First action after input: run compatibility checks in this worktree without discarding product commits.

## YNX18-B03 — Professional review and signing

- Owners: named legal/economic/security/privacy reviewers and YNX 30 signing authority
- Evidence: candidate disclosures and release records explicitly keep these states false or pending.
- Prepared: review packets, candidate wording, risk boundaries, deterministic artifact and hashes.
- Why YNX 18 cannot resolve it: approval, professional attestation and production custody are external authority decisions.
- Minimum input: named signed review evidence or production signing authorization tied to an exact artifact.
- Resume condition: verifiable reviewer/signing evidence is supplied.
- First action after input: validate scope, source and expiry before changing any release boolean.
