# Pay P0-226 Hosted Chromium Predeploy Request

This is a Pay-only, predeploy evidence request. It does not authorize SSH, production publication, aliases, installation, account approval, signing, typed data, or transactions.

## Why a hosted run is required

P0-225 restored production after the browser gate called the unsupported `networkidle` state. The exact extracted Pay candidate is independently reachable at a fixed local HTTP origin (`200`, `1174` bytes, SHA-256 `22f743c62a976928abd8a6bc3d123d366b5e1cac774b6ad3d20c21cfa07d917e`), but the Codex browser channel blocks that localhost origin with `net::ERR_BLOCKED_BY_CLIENT`; external Chrome control also timed out before a trustworthy snapshot. This is a browser-control boundary, not evidence that the Pay page failed.

## Frozen execution object

- Remote parent: `77d112898f18ce741fe4abcdeabd1eefeedd50ca`
- Workflow implementation: `873c88e18d28f14d8afdf622e5085e4cf6d66094`
- Workflow tree: `a2aab6890c40c65502600a7def84c4e6aa774e49`
- Path: `.github/workflows/pay-web-hosted-browser-preflight-p0226.yml`
- Blob: `fff179ce3737d518ca740a611ab2d40e0736e384`
- Bytes: `9254`
- SHA-256: `12fb884d34a5923bb333ece54acdd7acaee6331ce7cccf1e582e41598fb12f85`
- Required pushed head message: `evidence(pay): hosted Chromium preflight static candidate`

The workflow is push-only on the Pay owner branch and its own path. It has `contents: read`, no secrets, no inputs, no dynamic URL, no dispatch, and a ten-minute bound. It extracts only the frozen archive `release/pay/ynx-pay-web-5f4ce98e-static.tar.gz` (608368 bytes, SHA-256 `ae552951d8e569f04aced60db69e3c11422910cc1098a6e7061b0e84005ad09e`) and serves it only at `127.0.0.1:4189`.

## Browser gate

The hosted run uses only `domcontentloaded` and `load`; `networkidle` is explicitly forbidden. It launches a persistent Chromium profile, proves visible `YNX Pay`, `Waiting for Wallet`, `Sign in`, `Settings`, English default, stable URL, one page, zero console/page/network errors, and no fabricated account or chain. It closes the cold browser process, launches a second process with the same profile, and repeats every assertion.

Evidence is created in a previously absent `$RUNNER_TEMP/pay-p0226-evidence` directory. The upload step always uploads only that directory, including run-generated JSON, screenshots, raw candidate identity, bytes, and hashes.

## Requested Central decision

Issue one new, path-scoped, single-use lease for one force-false push from exact remote parent `77d112898f18ce741fe4abcdeabd1eefeedd50ca`, binding the three paths listed in the JSON request and exactly one push-triggered Actions run. No retry or dispatch is permitted.

On success, release the lease as hosted predeploy evidence only. Production remains unchanged and requires a wholly new Pay-only rollback-first lease. On any failure, release fail-closed without production action.
