# Wallet Desktop, CLI and SDK Website Handoff

Status: mergeable operator handoff; artifacts are not publicly hosted

Canonical route: `https://www.ynxweb4.com/wallet`

Machine-readable input: `release/wallet-cli/public/website-download-manifest.json`

## Current evidence boundary

The Wallet route currently resolves publicly, but this environment has no directly evidenced Website deployment authority. Representative proposed artifact URLs return the Website's 1,018-byte HTML fallback rather than the requested package. Consequently every new artifact retains `downloadHosted=false` and `deployedPublic=false`.

Do not use GitHub release URLs as the Website download destination for this slice. Do not render an enabled download button from a proposed URL. The Go SDK is source-only at this checkpoint and must not receive a download button.

## Website operator implementation

1. In the authorized `JiahaoAlbus/YNX-Chain-website` release workflow, upload each local artifact byte-for-byte to the manifest's content-addressed `proposedCanonicalUrl`.
2. Serve the actual binary with an appropriate content type and download disposition. Use immutable caching only because the path contains the full SHA-256.
3. Make `/wallet` consume a copy of the manifest. Display platform, architecture, Bytes, SHA-256, minimum OS/runtime and signing class next to each download.
4. Clearly label all packages as unsigned or ad-hoc-signed Testnet engineering previews. Do not claim production signing, store release, Mainnet readiness, audit completion or unavailable runtime coverage.
5. Keep each action disabled with an explicit unavailable state until post-deploy verification succeeds. Preserve keyboard operation, visible focus, accessible names, narrow-screen layout and Arabic RTL behavior.

## Publication gate

For every artifact, perform a full HTTP GET from the public URL (not only HEAD), then compare the response Bytes and SHA-256 to the manifest. Reject HTML, redirects to generic pages, authentication challenges, partial responses and any mismatch. Return:

- Website source commit and immutable deployment identity;
- final public URL, HTTP status, content type and content disposition;
- response Bytes and SHA-256 for every artifact;
- `/wallet` rendered-link/accessibility acceptance evidence.

Only after every item passes may a follow-up evidence commit set its `downloadHosted=true`. `deployedPublic` for the download surface must remain false if even one advertised button points to an unverified response.

The exact operator input request is `release/wallet-cli/operator-inputs.request.json`; credentials must stay in the authorized provider, never in Git or chat.
