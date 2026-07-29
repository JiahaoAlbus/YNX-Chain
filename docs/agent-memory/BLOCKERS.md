# YNX Trust Center Blockers

These blockers do not prevent autonomous local UI, observability, capacity, documentation or packaging work.

## TRUST-EXT-001 — Canonical central integration

- Owner: `29-integration`
- Reason: `ynx-trust-center-v1`, exact scopes and authoritative routes are not registered and executed in the canonical shared Testnet.
- Evidence: `release/integration/trust-center-contract.json`, `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`, `docs/integration/DEPENDENCY_ACCEPTANCE.md`.
- Preparation complete: product adapters, exact scope enforcement, fail-closed 503 behavior, contract and vectors.
- Why product 15 cannot solve it alone: product 29 owns the canonical registry, shared Gateway and cross-product Testnet execution.
- Minimum external input: accepted registry/route configuration and an authoritative shared-Testnet endpoint.
- Recovery condition: return deployed commit/config digest and execute every frozen vector.
- First action after input: run the full Trust cross-product vector set and bind results to the exact deployed SHA.

## TRUST-POLICY-001 — Retention and deletion policy

- Owner: legal/privacy policy owner
- Reason: destructive deletion cannot be implemented without canonical retention durations and mandatory audit-preservation exceptions.
- Evidence: subject export is complete; destructive lifecycle remains deliberately absent.
- Preparation complete: exact subject-scoped export and omission policy.
- Why product 15 cannot solve it alone: retention semantics are legal/policy decisions, not reversible engineering defaults.
- Minimum external input: approved durations, preservation exceptions, notice and appeal requirements.
- Recovery condition: signed/frozen policy with version and effective date.
- First action after input: implement policy-versioned deletion/retention with audit and negative tests.

## TRUST-SECURITY-001 — Production release acceptance

- Owner: `30-security-sre-release`
- Reason: the current provenance and restore evidence are local/CI evidence, not independent production attestation or custody approval.
- Evidence: successful CI run `30416831778`, prerelease `trust-center-v0.1.0-testnet-preview.1`, hosted SBOM/provenance/verification.
- Preparation complete: deterministic build, checksums, vulnerability/license/secret gates, cold-start install evidence.
- Why product 15 cannot solve it alone: production signing, encrypted remote custody and independent acceptance belong to the central release owner.
- Minimum external input: accepted release policy, custody target, independent restore witness and signing class.
- Recovery condition: 30 returns source/deployed SHA, attestation, custody and rollback evidence.
- First action after input: rebuild/sign under the accepted process and compare all subject digests.

## TRUST-MOBILE-001 — Native install targets and signing

- Owner: founder release operator
- Reason: current healthy Android install/cold-launch and full iOS Xcode/Simulator/signing evidence are unavailable.
- Evidence: source projects exist; historical build evidence is not treated as current install proof.
- Preparation complete: independent Android and iOS projects, package/bundle IDs, locale and semantic contracts.
- Why product 15 cannot solve it alone: healthy devices/emulators and production signing accounts are external execution assets.
- Minimum external input: healthy Android target, full Xcode/Simulator host, signing identities and store accounts when distribution is requested.
- Recovery condition: toolchains report healthy targets and authorized signing access.
- First action after input: build, install, cold-launch and record exact binary/source identities.

## TRUST-WEBSITE-001 — Canonical public route

- Owner: `28-website`
- Reason: `https://ynxweb4.com/trust-center` is not yet independently verified as deployed.
- Evidence: `docs/handoffs/trust-center-website.md`, `public-product-metadata.json`, hosted GitHub preview.
- Preparation complete: canonical metadata, release URLs, exact checksum, SEO/structured-data requirements and acceptance checklist.
- Why product 15 cannot solve it alone: product 28 owns the Website repository, Vercel deployment, SEO and public route.
- Minimum external input: consume the handoff and deploy the route through the Website pipeline.
- Recovery condition: return Website source/deployed SHA, live route proof, canonical/OG/JSON-LD/sitemap validation and rollback evidence.
- First action after input: independently verify the live route content and checksum, then set `deployedPublic=true` only if all evidence matches.

## Non-product repository preflight limitation

Repository-wide `go test ./...` is red outside the Trust slice because generated Solidity devtool artifacts are absent and two host-permission fixtures fail on this host. Trust-specific Race, Vet, smoke and CI gates pass. This is not classified as a Trust product external blocker and must not be used to hide autonomous Trust work.
