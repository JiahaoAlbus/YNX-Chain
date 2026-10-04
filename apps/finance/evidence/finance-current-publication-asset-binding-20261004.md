# Current-publication minimal asset correction

Predecessor `164b6fb4186647f0c5cd4912662232fcb6f9f723`, tree `91f546772d152ae384ed3597c3bf7bdca88cf2b0`. User's current-version publication instruction permits only necessary compatible release corrections; new feature work remains stopped.

Actual full Linux candidate builder against this predecessor exited 1 with `FINANCE_ASSET_HASH_MISMATCH:app.js` before producing a final archive. Its generated isolated work was finalized by the existing builder; no original candidate was overwritten. The historical failed predecessor must not be relabeled as a successful full package merely because its three bundle relations had passed separately.

The HTML still pinned app.js to `6811107c1942cda53445954b523744630e85843cf29842e889920d3bf3d06ab3`, while the inherited, already tested 67c7 full-caller implementation has SHA256 `af194fc31267836b70c656f4a7818d7c0951ccd64b7d464c649f805df0a62e3e`. Only that one HTML content-version reference was updated. No application, backend, shared protocol, authorization or runtime pin changed. Existing versioned-asset and release-tooling tests are executed separately; actual package success must be recorded only after a clean successor build.

This correction is local source/release compatibility, not deployment, installer or real Wallet approval. Publication remains with A via Root; UNKNOWN channels and account/sign/transaction boundaries are unchanged. The earlier pause report remains immutable.
