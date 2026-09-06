# Creator / Video real Testnet QA execution plan

Prepared 2026-09-06. This document describes an opt-in QA CLI, not a completed online run. The source of truth is `internal/video` and the canonical Wallet/Auth v2 SDK. No actual business writes were executed while preparing this script.

## Invocation and dependencies

Run from this dedicated worktree with Node 22 or newer:

```sh
node apps/video/scripts/qa-product-session-workflow.mjs
node apps/video/scripts/qa-product-session-workflow.mjs --check
node apps/video/scripts/qa-product-session-workflow.mjs --probe
# Only after consumer, registry and public origins are deployed and reviewed:
node apps/video/scripts/qa-product-session-workflow.mjs --execute \
  --identity-file apps/video/.qa-private/creator-video-testnet-qa.json
```

Default mode reads local inputs and prints the plan without creating identity files. `--check` checks canonical request, signed approval, callback binding and device-signing locally, with no network requests. `--probe` performs public GETs only. **`--execute` requires an explicit `--identity-file` and authorizes real QA sessions and business mutations, including public publication.** No business mutation is automatically retried.

The ignored SDK is expected at `apps/video/.qa-runtime/sdk-b3e4b5269`, with dependencies installed and the owner's exact `product-session-registry.json`. This is the Wallet specialist's reviewed SDK successor `b3e4b5269`, frozen by the Creator/Video owner. `--sdk-dir PATH` and `--registry PATH` may select a reviewed successor. The script hashes the directly imported SDK source files and registry, verifies the exact Creator web binding, and verifies the repository media checksum before execution. It does not install dependencies or modify Auth state files.

Network origins are fixed to `https://wallet-auth.ynxweb4.com`, `https://creator.ynxweb4.com` and `https://video.ynxweb4.com`, using ordinary verified TLS, no redirects, no cookies and no personal Wallet. No endpoint override, certificate bypass, database access, fabricated Gateway, unsigned session or fake provider is available.

## Identity and authority

Two independent QA identities and two P-256 device keys are created or loaded from the explicitly selected identity file. Custody is limited to a direct child JSON file inside `apps/video/.qa-private/`, a nonsymlink directory with mode 0700. A new file uses exclusive creation with mode 0600; an existing file must be regular, single-link, owned by the current user, mode 0600, and contain the exact `YNX_TESTNET_QA_IDENTITIES` schema and public QA identity ID. Saved accounts and device keys are validated cryptographically before network authorization. The canonical SDK signs the account approval; the real Auth Gateway issues the challenge/session and independently confirms it. The generated callback URL is parsed locally against the pending request; it is never opened in a browser or logged.

The exact registration is chain `ynx_6423-1`, product `creator-studio`, client `ynx-creator-studio-web-v1`, application `com.ynxweb4.creator-studio.web`, platform `web`, null bundle/package IDs, Creator origin, and `/wallet-auth/callback`. Requested scopes are only `creator:account` and `creator:publish`. Creator `GET` calls require `creator:account`; this workflow's writes require `creator:publish`. Revenue operations are rejected by the QA scope allowlist.

Each business request carries a fresh device proof for the **Auth introspection POST path and canonical requiredScopes body**, matching the deployed Video consumer contract. It does not incorrectly sign the `/video/api` path. Every mutation receives its own Idempotency-Key. New request/challenge/complete cycles renew sessions near expiry; real Auth is the sole session authority. Sessions are revoked at exit when possible, with expiry recorded if revocation is unconfirmed.

Only QA account/device secrets enter that private custody file. No secret is printed, and no approval, callback URL, session object, proof or raw authenticated response is persisted. The receipt includes public QA addresses, identity public ID/file path, object IDs, response hashes/status, source checksums and workflow states only. Buffer clearing is best-effort; JavaScript cannot promise erasure of all transient string copies. The private custody file remains available for later cleanup and failure recovery without using a personal Wallet.

After the failed step has been inspected and fixed, an explicit new invocation with the same identity file issues fresh sessions, reuses the existing QA channel and active/pending moderator membership, and reads the owner's Studio snapshot for the exact QA identity marker. It reuses at most one matching owned video, rights declaration and completed review stages; ambiguous multiple matches, failed processing, an unexpected reviewer or invalid rights stop for manual inspection. It does not replay a timed-out mutation automatically, delete existing content, or fabricate a missing processing/review state.

## Actual business sequence

1. Public GET Auth version, Video health/version and anonymous catalog; fail before writing if an endpoint is unavailable.
2. Issue and confirm real Creator v2 sessions for owner and reviewer.
3. Owner `POST /v1/channels` with a unique `testnet-qa-*` handle and explicit YNX Testnet QA name. Note: existing Channel JSON uses `ID` and `Owner`, while newer team/video JSON uses snake_case.
4. Owner `POST /v1/channels/{id}/team/invites` with the reviewer's canonical account and `role: moderator`; reviewer `POST /v1/team/invites/{id}/accept`. Confirm account, channel, role and active membership.
5. Owner multipart `POST /v1/uploads` uploads the repository-owned `internal/video/testdata/ynx-owned-test.mp4`, with exact size, SHA-256, owned declaration, source, license, worldwide territory and source README hash as rights evidence. This is a synthetic blue clip and 642 Hz tone authorized by the project owner for public Testnet QA, not third-party content or a business adoption metric.
6. Upload currently scans, probes and transcodes synchronously. The HTTP timeout is 300 seconds. If returned status is still scanning/transcoding, bounded authenticated GET polls confirm ready state, nonzero real probe metadata and a hashed processed variant. A failed or uncertain upload is not automatically replayed.
7. Owner `POST /v1/videos/{id}/rights` creates the separate source-bound rights declaration. Upload multipart rights alone do **not** create `RightsDeclarationID`. Body includes owned basis, license reference, worldwide territory, nonexclusive declaration, 10000 basis points attributed to the QA owner, README evidence hash and exact media source hash. A `declared` record permits noncommercial publication; this script does not claim global moderator verification or commercial rights.
8. Owner `POST /v1/videos/{id}/submit-review`; the reviewer independently performs authenticated `GET /v1/videos/{id}` and checks source checksum, rights linkage and processing metadata before `POST /v1/videos/{id}/review-publication`. The reason explicitly identifies automated QA review, not human visual or commercial rights verification. Confirm `submitted_by` and `reviewed_by` are the two distinct accounts. The API requires channel moderator access and forbids reviewing one's own submission.
9. Owner `POST /v1/videos/{id}/publish` with public visibility. The corresponding local API fix now requires approved state and independent submission/review records for first public or unlisted publication. Already-published visibility changes have their own audit event; private state does not manufacture reviewed-publication evidence. Editing published metadata makes it private draft content requiring a new independent review. These source changes still need deployment before an online claim.
10. Anonymous GET through the **Video domain** confirms published detail and catalog inclusion, then downloads the original media and recomputes its exact hash. No `/watch`, engagement, payout or transaction mutation is called. A public Viewer URL is returned for a separate real CUA playback check.

## Known readiness gates and evidence limits

- Public Auth must expose the corrected Creator base registration without `.web.web`, preserving durable v2 state.
- Video API must run the v2 proof consumer and authenticate credentialled private GETs. The old deployed API cannot be accepted as a successful v2 consumer.
- Creator and Video domain routing and TLS must point to the authorized services. Existing web4 routes remain outside this script's mutation scope.
- Real scanner and FFmpeg availability, object storage access, and rights declarations are required. Failures remain failures; no direct DB or placeholder asset substitute is used.
- API flow, downloadable bytes and a scripted QA signature do **not** prove installed YNX Wallet UI, browser callback handoff, native installation, commercial readiness, or browser playback. Receipt flags retain those distinctions.
- Execution receipts use `apps/video/audit/qa-workflow-videoqa-*.json` with mode 0600. They are source-bound evidence to review before any claim of online completion.

## Preparation validation

`node --check`, default dry run, and `--check` passed with no network writes. The API package passed `GOMAXPROCS=2 GOPROXY=off go test -p 1 ./internal/video`, including draft/rejected publication rejection, stale metadata approval invalidation, legitimate independent review, and private visibility audit behavior. Existing successful publication fixtures use real team invite/accept and submission/review methods, not direct state changes that manufacture approval.
