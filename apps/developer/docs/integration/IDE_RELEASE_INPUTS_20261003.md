# IDE release inputs and desktop source identity — 2026-10-03

The owned source remains a candidate for A's formal publication, not full-product acceptance.

## Corrected release records

The prior product-release.json described the September 6 source 59508494 and older installation/artifact outcomes as current. Its exact bytes are preserved in release/HISTORICAL_PRODUCT_RELEASE_59508494_20260906.json. The schema-2 current record distinguishes owned source, observed public gateway and unverified current installation/business gates. Resolve delivery sourceCommit/sourceTree from the frozen handoff manifest, and local packages from clean Git HEAD.

Mac package production and verification now bind runtimeCheckpoint to their exact sourceCommit. The bundled code-server.mjs validates schema/product/version/architecture/clean source and exact commit/tree/checkpoint before any user-state write, then supplies the gateway's source identity and source-suffixed release. Inherited environment labels cannot override that identity. Invalid or absent provenance fails startup. This is provenance consistency, not an independent signature or payload-integrity proof; package verification/signing remain separate requirements.

## Verification

- Actual launcher subprocess: 9 passing tests, using a bundled gateway-import observer fixture. Valid provenance sets exact source/release and creates the private session key; missing metadata, stale checkpoint, inexact hashes, wrong product/architecture/schema and dirty source fail before user state exists.
- Both Mac shell scripts pass bash syntax checks; Developer static claim/workflow check and git diff --check pass.
- Historical JSON bytes and SHA-256 match the preceding source's product-release.json.
- Frontend/protocol artifacts are inherited unchanged from the e9cf4ace desktop-entry build; no new frontend compile/browser acceptance is claimed for this metadata/launcher batch.
- No current Mac installer build, installation, notarization or real native workbench/terminal test was run.

## Public observation and remaining release dependencies

The recorded public /healthz response identifies a5e4905a1d595a02479115fd28ea1fd6276677fd (tree e5efc7e8eb6c5ead07689de8d899bb48a0d1ea3c). /runtime/codeoss?projectId=wallet-projects returned HTTP 404, and terminal recoveryRequired was 1. Evidence in evidence/integration/ide-release-inputs-20261003 is an observation, not a new publication or native acceptance.

The shared registry already defines client ynx-developer-v1 and account:read/developer:deploy. This does not prove active business configuration or real Wallet approval. A owns shared configuration and Host publication. Formal source-bound publication, Linux executor/PTY, normal-user open/edit/save/terminal/reopen, canonical Wallet approval and business readback, configured real AI and isolation/capacity remain unverified. Rejected network/package-egress/LXD work remains stopped.
