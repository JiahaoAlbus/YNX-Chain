# YNX Music integration handoff

## Package identity

- Product owner: **YNX Music**
- Product ID: `ynx-music`
- Contract version: `music-contract-v1`
- Runtime source commit: `74716a19d95fc191b54102adc02000a91fafec24`
- Current stage: **PROTECT**
- Current long-term status: **ACTIVE**
- Central integration accepted: **No**

The merge package consists of:

- `release/integration/music-contract.json`
- `docs/integration/CROSS_PRODUCT_TEST_VECTORS.json`
- `docs/integration/DEPENDENCY_ACCEPTANCE.md`
- `apps/music/central/wallet-registry-v2.json`
- `apps/music/product-release.json`
- `apps/music/public-product-metadata.json`
- `apps/music/ARTIFACT_MANIFEST.json`

## Authoritative Music facts

YNX Music owns:

- listener profile, library, favorites, queue, playlists and playback progress;
- creator profile, private drafts, Music metadata, release state and Music-side rights declaration hash;
- private media object reference, audio/artwork hashes and local authorization checks;
- Music usage records before canonical Data Fabric acceptance;
- local review intents for Pay and local case references for Trust;
- user-reviewed AI proposal state inside Music.

YNX Music does **not** own:

- Wallet identity, approval, session, revocation or private keys;
- committed payment status, balance or Billing Ledger finality;
- Trust decisions or protocol-wide dispute finality;
- central AI provider policy or model inventory;
- public deployment, download hosting, production signing or store release;
- commercial music rights not backed by external evidence.

## Wallet / Auth merge request

Merge the exact `ynx-music-v1` registry entry. Expose challenge, session and introspection operations defined in `apps/music/central/CENTRAL_INTEGRATION.md`. The accepted implementation must bind:

- requesting product `music`;
- bundle `com.ynxweb4.music`;
- callback `ynxmusic://auth/callback`;
- compressed P-256 device key;
- exact scopes `music.creator`, `music.library`, `music.playback`, `music.profile`;
- expiry, revocation, request digest and completion replay.

No wildcard scope, long-lived browser token, local verifier or legacy bearer fallback is accepted.

## Pay and Billing merge request

Music currently produces only `requires_wallet_review` settlement intents. Pay and Data Fabric must freeze:

- the signed review request;
- the committed receipt schema;
- the canonical ledger event and deduplication domain;
- amount, currency, creator, payee and allocation binding;
- provider cost, protocol fee, rights-holder split and creator-net semantics;
- replay, tamper, duplicate-allocation, revoke and refund/dispute paths.

Music must not change a settlement to paid from an unsigned callback or status string.

## Trust merge request

Trust Center must freeze one rights-case schema for report, takedown, dispute and appeal. Music requires central IDs and decisions to bind the local case, track, opener, evidence hash, decision reference and exact status version. A central outage must leave the local case open without inventing a decision.

## AI merge request

AI proposals are advice only. The accepted gateway response must include provider, model, cost/estimated units, status and bounded output. The user must approve or reject before Music changes playlist state. The gateway cannot publish a track, delete data, accept rights or trigger payment.

## Data Fabric events

The contract proposes Music-owned publication, usage and allocation events, plus dependency-owned committed settlement and Trust case events. Integration must freeze one canonical version for each before any `integratedCentral` claim. Listener privacy and private draft data must be excluded from public Explorer evidence.

## Current verification evidence

At runtime commit `74716a1`:

- Music unit/integration tests: pass locally and in GitHub Actions;
- Music Race tests: pass locally and in GitHub Actions;
- daemon smoke, Wallet contract audit and 12-locale audit: pass locally and in GitHub Actions;
- Android CI build: pass and artifact upload step succeeded;
- iOS Simulator CI build: fail; no iOS artifact or install proof exists;
- full workflow conclusion: fail because iOS failed;
- central owner acceptance, shared Testnet, public deployment and hosted download: not verified.

## Acceptance order

1. Integration reviews and freezes `music-contract-v1` or returns a versioned conflict report.
2. Wallet/Auth merges the registry and passes Wallet vectors.
3. Pay, Trust, AI and Data Fabric freeze their owned schemas and pass adapter vectors.
4. Music runs deployed cross-product E2E and negative vectors.
5. Explorer, Monitor and Trust evidence is recorded for the exact source commit.
6. Security/SRE runs migration, restore, security and artifact gates.
7. Website consumes public metadata; website publication remains separate from runtime deployment.

No step in this handoff authorizes direct edits to another product worktree.
