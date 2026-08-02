# Third-Party Notices and License Review Status

This source tree uses third-party Go and npm packages. `go.sum` and the root and subproject `package-lock.json` files are dependency-integrity inputs; they are not license notices and do not establish redistribution compliance.

As of 2026-07-22, a complete counsel-reviewed attribution bundle has not been generated. No top-level project license file was found in the audited checkout. Therefore no public source-distribution or binary-redistribution rights conclusion is made here.

Before distribution:

1. identify direct and transitive packages for every shipped binary, web bundle, SDK, mobile artifact, container, and build tool;
2. resolve each package's exact version, source, license expression, copyright notice, and required attribution/source-offer terms;
3. flag copyleft, source-available, unknown, deprecated, unmaintained, and dual-license cases for legal review;
4. generate an artifact-specific SBOM and notices file from the final lockfiles/build graph;
5. compare the inventory with the bytes in the signed artifact and store digests/provenance; and
6. obtain approval for the YNX project license and contribution policy.

Tooling note: `npm sbom --sbom-format cyclonedx --omit=dev` failed on 2026-07-22 because npm could not generate a package URL for the root package's range-typed version. This is an unresolved generation defect, not an empty or passing SBOM. `go list -m all` succeeded, but module enumeration alone does not resolve license obligations.
