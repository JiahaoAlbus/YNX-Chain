# Actual isolated Card startup and protected refusal

Source b2fccc4b43607f0b22236f26ed0dc37e8a42ebd3/tree a868712636dabd70877eec0cde6d83c1c0179303. Original main/service/storage/auth consumer are retained. Only the deployment candidate verifier and its regression test changed.

The previous runner configured a private adapter and expected readiness while originalCardRuntimeInputs.current remained null. It now verifies two separate actual subprocess contracts. It never supplies a permissive current producer and never inherits operational credentials, commercial settings or funding configuration. Output directories are exclusive; reruns cannot overwrite prior evidence. Dedicated temporary state remains preserved, not cleaned.

## Direct execution

node --test apps/card/server/deployment/candidate-runtime.test.mjs: 2/2 passed. Runs actual main and verifies inherited auth/processor environment is not used. Reusing the evidence directory fails. Invalid source arguments fail before creating evidence.

node apps/card/server/deployment/candidate-runtime.mjs b2fccc4b43607f0b22236f26ed0dc37e8a42ebd3 apps/card/evidence/20261003-testnet-operations/runtime-b2fccc4b4-20261004: exit0 at 2026-10-04T08:16:09.740Z. Node v26.7.0/darwin/arm64.

Public-unconfigured actual main: /api/card/v1/version HTTP200, 325 bytes SHA37e414041970830fc1e14943a03a4b71f1ebab703d5b3a8325d2027c34f5e69d; /api/card/v1/state HTTP503, 165 bytes SHAb7cead2ef0478fb8cb3b6e467b1cc6bb8469d62d5578e6760f8bddb058c7c321. Loopback only, configurationReady=false, productionRealPayments=false; clean SIGTERM exit0.

Protected-missing-authority actual main: exit1, exact CARD_PROTECTED_RUNTIME_SOURCE_UNAVAILABLE, no ready announcement and stateFiles=[]. It refused before opening encrypted SQLite. Both subprocesses terminated; no service installed, alias altered, account requested, signature or transaction sent.

## Remaining real product gate

This is source-bound local process evidence, not a runnable private authority, real Card account, public deployment or YNXT credit. The genuine original captured-current/role/actor producer and formal paired Host execution remain unproven. No fixture/ENV flag/standard-wallet address may replace them. Earlier 403 frontend,135 backend,8 additional gates belong to source0fd543932; this batch's 2 new subprocess tests are separate and do not re-label those runs.

Full Testnet registration/approval, actual YNXT funding receipt and balance, merchant ledger lifecycle, Data Fabric delivery, live private-session revoke and connected-wallet degradation independence remain incomplete. Product Session v2/migratedV2/real issuance/PAN/CVV/fiat/real merchant clearing/productionRealPayments remain false. Do not announce YNX_CARD_TESTNET_PRODUCT_READY.
