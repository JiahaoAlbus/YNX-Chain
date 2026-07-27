# Expand YNX 18 public-document metadata authority

Updated: 2026-07-27
Workspace: [LOCAL_WORKTREE]/18-docs-compliance
Branch: codex/final-docs-compliance

## Current phase

PUBLIC. The accepted documentation bundle remains centrally integrated, publicly rendered
and immutably hosted as an unsigned candidate. Source
`2d38cacd11a46efc5c4ef9adb4ebcc992ba6f012` is a newer locally and CI-verified
website-content candidate covering thirteen high-authority documents; it is not yet
Website-accepted, publicly hosted or production signed. The long-term goal remains Active.

## Completed slices

- Created `release/document-metadata-inventory.json` and a fail-closed gate that compares
  Markdown metadata and change-log identity exactly.
- Normalized the technical whitepaper, YNXT tokenomics, security/privacy/AI governance,
  Terms draft, Brand Guide and Website Integration Handoff.
- Expanded the same authority to StreamBFT, execution/local fee markets,
  Treasury/revenue/burn, stablecoin reserve/redemption, proof of solvency, Privacy Notice
  and Acceptable Use Policy.
- Preserved all candidate and failure boundaries: no public StreamBFT activation, active
  local fee market, Treasury audit, burn/buyback, official stablecoin, reserve/redemption,
  solvency attestation or effective legal notice was claimed.
- Added all thirteen documents to the deterministic website-content package and required
  them in package verification.
- Built and verified `ynx-website-content-2d38cacd11a4.zip`: 268,746 bytes, SHA-256
  `4ee1913606d4fdd17af44b0b206a0adfc21044747a69577c7e7f498829318861`.
- GitHub Actions run `30280631459` passed for exact source `2d38cac`; unexpired artifact
  `8658642162` has workflow-container digest
  `sha256:b25b64cfd2bc38f6c5961fad8cbb7eef3a5d3f374c7310ee594ee8e5775356b0`.
- Pushed implementation commit `2d38cacd11a46efc5c4ef9adb4ebcc992ba6f012` and verified
  Local SHA = Remote SHA with Ahead/Behind 0/0.

## Next autonomous slice

Expand metadata authority to the next highest-impact cohort: staking/liquid staking and
safety module, trading core/UltraLiquidity/FairFlow, Wallet/Auth smart-account mandate,
Bridge/Oracle/Data Fabric, Quant architecture, Trust/appeals/market integrity, Product
Architecture and the principal Validator/Developer/Wallet/Exchange/DEX/Quant/Card/Cloud
guides. Preserve owner boundaries and substantive claims. Rebuild and verify the package
from the next committed source; do not change Website acceptance, hosted-download or
signing states without direct evidence from YNX 28 and YNX 30.

## External blockers

- clean exact-commit handoffs from Wallet/Auth, Economics, Oracle, Bridge, Data Fabric
  and Security/SRE;
- named legal, economic, consensus, security, privacy and independent-audit reviews;
- approved media rights and final asset variants;
- production signing authority and certificate-chain evidence;
- independent public/search/indexing evidence; and
- any future Mainnet or public StreamBFT activation evidence from its runtime owner.

## Safety and checkpoint rules

Do not reset, clean, force-push, modify sibling worktrees, expose secrets, execute
value-moving actions or infer stronger release states. Every slice must run focused gates,
review the diff, commit, push, verify Local SHA = Remote SHA and leave an exact next
action. The `2d38cac` package remains a local/CI candidate until separate Website,
public-hosting and signing evidence is returned.
