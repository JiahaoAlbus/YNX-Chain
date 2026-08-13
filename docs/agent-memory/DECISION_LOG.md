# YNX Calendar decision log

## 2026-07-29 — state payload version is independent

Calendar state payload now has explicit schema version 1 in addition to disk envelope version 1 and recurrence schema version 1. These versions address different compatibility boundaries and must not be conflated.

## 2026-07-29 — legacy compatibility is additive

Authenticated state with a missing/zero payload version normalizes to version 1. Existing IDs and unrelated state are preserved. Unknown future versions fail closed rather than being guessed or downgraded.

## 2026-07-29 — backup is authenticated, not encrypted

The local backup envelope uses the Calendar state HMAC key and a state SHA-256 digest. This proves integrity and product/version binding. It does not provide confidentiality or independent disaster-recovery key escrow. Release evidence must state this limitation.

## 2026-07-29 — restore is isolated by design

Restore writes only to a new relative target inside an existing operator-selected restore root. It does not overwrite live state and rejects existing targets and symbolic-link traversal. Promotion is a separate maintenance decision with quarantine and rollback.

## 2026-07-29 — local drill is not production RTO/RPO

The 522-byte, 61 ms empty-state restore is recorded as local control-path evidence only. Production claims require representative data, encrypted offsite retention, independent key escrow, restore environment provisioning and promotion/rollback timing.

## 2026-07-29 — HTTP 200 is not Website completion

`ynxweb4.com/calendar` currently returns the generic homepage shell with root canonical. The route remains unpublished for Calendar despite HTTP 200. `websitePublished` and `deployedPublic` stay false.

## 2026-07-29 — official domain separation

YNX Calendar product, canonical, status, support and public evidence use only `ynxweb4.com`. `huangjeo.com` remains the Founder site. `mcp36.huangjeo.com` is valid MCP infrastructure only.

## 2026-07-29 — no premature current-source release

No current-source GitHub Release will be created without exact-source CI, artifacts, SHA-256, SBOM, provenance, install/cold-start proof and truthful signing class. Historical `e227c4f` preview artifacts remain separate.

## 2026-08-01 — browser proof must own and clean its resources

Browser proof uses process-derived port ranges, a bounded 45-second health wait, child-exit detection, bounded wallet-server closure, process-group SIGTERM/SIGKILL fallback and temporary data-directory cleanup. Two consecutive proof runs on distinct ports are required evidence for this reliability fix.

## 2026-08-01 — redirected generic content is still not deployment

`https://ynxweb4.com/calendar` now redirects to `https://www.ynxweb4.com/dapp/calendar`, but the response still has the generic YNX Chain homepage title, no Calendar-specific H1 and root canonical. Redirect success and HTTP 200 do not change `websitePublished=false` or `deployedPublic=false`.

## 2026-08-01 — evidence checkpoint does not authorize a release

Evidence checkpoint `06f8b2bce60780ca27cf71a0705bfdf060dc57f6` is pushed and remote-equal. GitHub returned no PR or workflow runs for that commit, and the release list contained no current-source Calendar release. This checkpoint freezes truthful evidence; it does not satisfy CI, artifact, SBOM, provenance, install or signing gates.

## 2026-08-08 — exact-build Testnet publication supersedes the old route finding

Website `/dapp/calendar`, the owner registry and the direct Testnet Web/API runtime are now public. External health and served-asset checks bind runtime `55587bb6cc8c7c49202e4fc3222b69772dd05b5f`; `websitePublished` and `deployedPublic` are therefore true. This does not authorize production scheduling, native package, signing, store, Mail, AI or Data Fabric claims.

## 2026-08-08 — mobile week is seven days in one viewport

The 390px week view no longer hides days behind horizontal scrolling. Browser proof requires seven rendered headers and rejects any timeline scroll width beyond the viewport; long event labels truncate visually but retain their accessible/event-detail names.
