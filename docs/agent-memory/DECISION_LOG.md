# Decision Log — YNX 21 Bridge

## 2026-07-29 — Preserve public-read-only versus executable-product distinction

Decision: Keep top-level Bridge product `deployedPublic=false` while `publicReadDeployment.deployedPublic=true` for the scoped TLS read-only evidence surface.

Reason: A public status endpoint does not prove public mutation, asset movement, funded transfers or an executable YNX route.

## 2026-07-29 — Treat threshold-relayer proof honestly

Decision: Continue labeling the implemented proof verifier as `threshold-relayer-attestation`, with `lightClientProofVerified=false` and `canonicalBridgeClaim=false`.

Reason: Signature quorum evidence is not independent consensus proof.

## 2026-07-29 — Isolate restore drill ports

Decision: Allocate an ephemeral loopback port in `bridge-restore-check.sh` instead of hard-coding port `16435`.

Reason: Fixed ports make concurrent CI or stale listeners produce false restore failures. The revised drill passed normally and in two concurrent executions.

## 2026-07-29 — Do not claim generic Website routes as Bridge acceptance

Decision: Record `ynxweb4.com/support`, `/privacy`, `/security` and `/status` as observed official-site links, but keep Bridge-specific support and status acceptance unset until owner `28-website` returns direct evidence.

Reason: HTTP 200 and a generic SPA shell are insufficient product-level acceptance.

## 2026-07-29 — Prefer unsigned candidate release over production-signing claims

Decision: The next autonomous release slice is an immutable unsigned Testnet candidate with SBOM, provenance, hashes, installation and cold-start evidence.

Reason: Production signing, custody and public mutation authority require external Security/SRE and Governance inputs.
