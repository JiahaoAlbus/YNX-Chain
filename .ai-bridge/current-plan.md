# YNX Shop current plan

Status: Active
Stage: FREEZE_TO_INTEGRATE
Current implementation source: `a9f9ff932ede1091882509a219755b4b18a88c92`

## Completed protected checkpoints

- Privacy runtime, validation gates and twelve-locale Web/native controls through `0347320463466cf9a265c7447fbced0218a32cab`.
- Persistence schema v1→v2 migration, explicit v1 rollback, exact v2 recovery point and restore evidence through `c929056bfd083d124dff7998166bc1ee86d71393`.
- Bounded Prometheus metrics and deterministic local read-capacity test at `14984342ebf49f0b9a1f5ec516b1aef99c6e8879`.
- Exact health build/start/integrity/dependency boundary at `a9f9ff932ede1091882509a219755b4b18a88c92`.

## Current truth

- Current source is implemented and locally tested.
- Historical Shop Staging/API routes returned HTTP 404 on 2026-07-29.
- `https://ynxweb4.com/shop` returned a generic SPA shell with homepage canonical; Shop-specific public deployment is not verified.
- No branch PR, branch workflow run or Shop GitHub Release exists.
- Central Wallet registry, Shop Pay merchant/payout, current native build hosts and Website deployment remain external gates.

## Next autonomous action

Build a deterministic current-source Web/API release bundle with exact SHA-256, SBOM and provenance; verify byte-identical rebuild and tamper/false-claim rejection; commit and push the package tooling and evidence. Do not claim Staging/public deployment until direct runtime evidence exists.
