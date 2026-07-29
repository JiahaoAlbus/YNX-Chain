# Decision Log

## 2026-07-29 — Preserve parallel main work

Merged `origin/main` into `codex/final-pay` instead of rebasing, resetting or rebuilding. Pay-owned `.ai-bridge` conflicts retained the Pay recovery context; the central `docs/acceptance/NEXT_ACTION.md` conflict retained main's version to avoid overwriting another owner's authority.

## 2026-07-29 — Do not claim public completion from HTTP 200

The `/pay` route returns the generic website shell and root canonical. The Pay health endpoint reports build `98a18815d4ee`, not the current Pay candidate. These observations are recorded as public evidence but do not set `deployedPublic=true` for the current candidate.

## 2026-07-29 — Promote phase only to INTEGRATE

The local contract is frozen and PR #11 exists, so the phase advances from `FREEZE` to `INTEGRATE`. It does not advance to `TESTNET` because central acceptance and fresh end-to-end receipts are absent.
