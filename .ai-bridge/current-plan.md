# Expand YNX 18 public-document metadata authority

Updated: 2026-07-27
Workspace: [LOCAL_WORKTREE]/18-docs-compliance
Branch: codex/final-docs-compliance

## Current phase

PUBLIC. The accepted documentation authority bundle remains centrally integrated,
publicly rendered and immutably hosted as an unsigned candidate. Source
`3dd06bfc272acaca5bf3a263b8d7647a0fd98b3a` creates a newer locally and CI-verified
website-content candidate; it is not yet Website-accepted, publicly hosted or production
signed. The long-term goal remains Active.

## Completed slice

- Added `release/document-metadata-inventory.json` and a fail-closed metadata gate.
- Normalized the complete metadata tuple for the technical whitepaper, YNXT tokenomics,
  security/privacy/AI governance, Terms draft and Brand Guide in implementation commit
  `be7c9aa`; this evidence follow-up also normalizes the Website handoff.
- Corrected the whitepaper's stale claim that the documentation package was not deployed,
  while preserving unsigned-candidate and named-review limitations.
- Added the first five normalized documents and metadata inventory to the deterministic
  website-content package and required them in package verification. The normalized
  Website handoff is included in the verified `3dd06bf` package.
- Built and verified the six-document candidate
  `ynx-website-content-3dd06bfc272a.zip`: 192,324 bytes, SHA-256
  `5eff155c7ce495449f656df3d0567dc23f772b17e53b7d6c7bb0f0f4c50c470d`.
- GitHub Actions run `30277299345` passed for exact source `3dd06bf` and retained
  unexpired artifact `8657308310`; this CI artifact is not the public hosted download.
- Pushed commits `be7c9aabdff51ee29e373baf3342d4837735b9cc` and
  `3dd06bfc272acaca5bf3a263b8d7647a0fd98b3a`, then verified local and remote SHA
  equality with Ahead/Behind 0/0.

## Next autonomous slice

Expand the inventory and metadata gate to the next highest-authority cohort:
StreamBFT, execution/local fee markets, treasury/revenue/burn, stablecoin reserve and
redemption, proof of solvency, Privacy Notice and AUP. Preserve substantive claims unless
accepted owner evidence changes. Rebuild the deterministic package after the cohort is
committed; do not mark the new archive hosted or Website-accepted without direct YNX 28
evidence.

## External blockers

- clean exact-commit handoffs from Wallet/Auth, Economics, Oracle, Bridge, Data Fabric
  and Security/SRE;
- named legal, economic, security, privacy and independent-audit reviews;
- approved media rights and final asset variants;
- production signing authority and certificate-chain evidence;
- independent public/search/indexing evidence; and
- any future Mainnet or public StreamBFT activation evidence from its runtime owner.

## Safety and checkpoint rules

Do not reset, clean, force-push, modify sibling worktrees, expose secrets, execute
value-moving actions or infer stronger release states. Every slice must run focused gates,
review the diff, commit, push, verify local/remote SHA equality and leave an exact next
action. The `be7c9aa` package remains local until separate Website and hosting evidence is
returned.
