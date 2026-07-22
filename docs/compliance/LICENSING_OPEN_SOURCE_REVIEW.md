# Licensing and Open-Source Review

Version: 0.1.0-candidate  
Last reviewed: 2026-07-22  
Status: incomplete; counsel and artifact-specific inventory required

## Current evidence

The repository has Go and npm lock/integrity files. `go list -m all` succeeds. Root npm SBOM generation currently fails because npm cannot construct a package URL for the root package's range-typed version. No top-level project license was found in the audited checkout. `THIRD_PARTY_NOTICES.md` records this boundary.

These facts do not establish permission to publish source or redistribute binaries. A dependency name, registry metadata or lockfile is not a legal conclusion.

## Review procedure

For each final artifact, inventory direct/transitive runtime and bundled build dependencies; resolve exact source/version and license text; identify attribution, notice, source-offer, patent, trademark and modification obligations; detect unknown, conflicting, copyleft, source-available and noncommercial terms; and compare inventory with shipped bytes. Review fonts, icons, images, datasets, model outputs/weights, API terms and copied specifications separately.

Approve a project license, copyright holder, contribution policy and trademark policy. Generate artifact-specific notices and SBOM from the final commit/lockfiles, hash them, include them beside the immutable artifact, and retain legal approval. Package-manager audit severity and license review are separate gates.

## Blockers

Public redistribution remains unapproved until the root package version/SBOM defect is fixed, all subprojects and containers are inventoried, notices are generated, the project license is selected, and qualified counsel approves obligations.
