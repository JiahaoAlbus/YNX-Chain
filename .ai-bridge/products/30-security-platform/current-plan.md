# YNX 30 Current Plan

Status: ACTIVE
Phase: FREEZE
Accepted source commit: `fa5f3edfdac0fe21ed17028845e4faa09ae89143`
Updated: 2026-07-27T15:18:12Z

## Current objective

Freeze release truth and supply-chain evidence around the exact CI-green source without overstating external state:

1. Generate a reproducible source artifact, CycloneDX SBOM, SLSA-candidate provenance, manifest, ephemeral test signature and tamper-rejection evidence for `fa5f3ed...`.
2. Update the artifact registry and product release to select that exact source artifact while retaining `productionSigned=false`, `downloadHosted=false`, `deployedStaging=false` and `deployedPublic=false`.
3. Rebind the integration contract, public metadata, completion evidence and coverage matrix to the accepted source and exact evidence paths.
4. Commit and push the release metadata/artifact checkpoint and require green protected-branch checks.
5. Verify the checkpoint from a clean Git archive, then implement real clean-install and CLI cold-start evidence.
6. Continue in order through INTEGRATE, TESTNET and PUBLIC only when direct evidence permits.

## Immediate next action

Run the local reproducible artifact drill for `fa5f3ed...`, inspect every generated file, and update release truth without changing any external deployment or signing boolean.
