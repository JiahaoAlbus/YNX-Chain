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
