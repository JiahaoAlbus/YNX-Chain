# Third-Party Notices

YNX Oracle server dependencies and their versions are recorded in `go.mod` and
`go.sum`. The Oracle Web/PWA dependency graph and integrity hashes are recorded
in `apps/oracle/package-lock.json`. Those lockfiles are authoritative for the
candidate source; this file does not replace individual license texts.

The Web runtime uses Next.js, React, vinext, Vite, Tailwind CSS, Cloudflare
Workers tooling, and their transitive dependencies. Provider APIs are not
bundled dependencies and are inactive. Coinbase, Kraken, and Bitstamp names are
used only to document candidate integrations and applicable official terms; no
partnership, endorsement, license, or production activation is claimed.

Candidate CycloneDX SBOMs are stored under `release/` and bound by SHA-256 in
`SECURITY_RELEASE_GATE.md`. Before distributing an image or downloadable bundle,
CI must also produce a license inventory, vulnerability report, build provenance,
artifact SHA-256/byte size, and the complete notices derived from the locked
graph. No downloadable artifact is released by this candidate.
