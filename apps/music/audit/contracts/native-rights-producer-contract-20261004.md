# Music original rights consumer and publisher contract

This describes the owned original Music consumer at source dc4396011c77f4c5c0c228d26ca7aec766d96154. It does not attest the current shared producer, Host actor, live provider or deployment. Shared authority, registered clients, protected producer adapters and formal mounts remain the unique release owner's scope.

## Original private client and business inputs

The original generated native SDK uses product `music`, client `ynx-music-v1`, Android package / Apple bundle `com.ynxweb4.music`, callback `ynxmusic://auth/callback` and the unchanged four scopes `music.creator`, `music.library`, `music.playback`, `music.profile`. Android / Apple native origins are the corresponding `app://<platform>/com.ynxweb4.music`. The original private Music proof header is `X-YNX-Music-Business-Proof-V2`. A connected SDK alone is not currentActor or business authorization; the original Host/currentActor factory and registered matching clients must actually validate the same original session and user.

The client submits `POST /api/cases` under original Music proof with a durable per-account `Idempotency-Key: music-trust-<UUID>` and a body bounded to 16 KiB: `kind`, `trackID`, `reason`, `evidenceRef`. Kinds are `report`, `dispute`, `appeal`, `takedown`. The original service enforces the exact same-key body/account; NEW appeal/takedown is restricted to the original track owner. Admitted original-key replay precedes the new owner check. Client preflight follows the original current private snapshot; it does not mint an owner role. The original server is authoritative.

## Original outbound submission and receipt

`internal/music/server.go` creates/replays one original local case before invoking `centralBusinessEffect`. The existing operator-configured `music.Config.TrustGatewayURL` must be an exact HTTPS endpoint (no guessed route/query/fragment/userinfo); `TrustGatewayKey` and the original configured HTTPClient remain operator inputs.

The original POST has `Content-Type: application/json`, `Authorization: Bearer <configured operator credential>`, and `X-YNX-Product-Client: ynx-music-v1`. Its exact existing body is:

```json
{
  "type": "open_case",
  "idempotencyKey": "music-trust-<original UUID>",
  "subject": "<original Music trackID>",
  "requestScope": "music.rights",
  "purpose": "<original submitted reason>",
  "requestedAction": "<report|dispute|appeal|takedown>",
  "evidence": [{
    "source": "ynx-music",
    "digest": "<original evidenceRef>",
    "summary": "<original submitted reason>",
    "collectedAt": "<original persisted case CreatedAt>",
    "visibleToSubject": true
  }]
}
```

The receipt contract is strict single JSON `{"id":"<nonblank bounded Trust reference>"}`. Extra fields, a wrapped `case` result, redirects and invalid receipt shapes do not confirm the original effect. This wire does not contain a client-supplied requester role or an upstream signed currentActor proof. The original Music effect journal binds actor/kind/object/wire/endpoint and revalidates original business authority locally. The actual shared adapter must establish the REAL same requester/currentActor with its original protected producer contract; an operator key, a body `requestScope`, source inspection or the SDK connection alone does not establish that actor. Do not add a guessed actor header, credential store, grant or guessed shared action URL on the consumer side.

The inherited repository Trust product reference uses a different `submit_case` action and a wrapped Result.Case. That reference is not attestation of the release owner's latest producer. It demonstrates why the original Music endpoint cannot be blindly pointed at an arbitrary shared endpoint: the unique release owner must provide an exact current compatible adapter, identity/role handling and original-key receipt contract, with accurate current source/runtime receipt.

## Unknown outcome and original record readback

The original Music journal admits a single external dispatch. A receipt may be replayed locally under fresh authority. An admitted effect without a verified receipt remains UNKNOWN; it is never forcibly resent, rekeyed or reconciled through a guessed provider status route. Reconciliation requires the release owner's actual compatible provider contract, preserving the exact actor, original key/body, endpoint and local object. Native local pause does not withdraw a case or undo an external effect. Restoring a paused request retains the original key/account/body.

Original `GET /api/me` returns only cases whose `openedBy` is the verified account. Fields are `id`, `kind`, `trackId`, `openedBy`, `reason`, optional `evidenceRef`, `status`, optional `centralCaseId`, and `createdAt`. Before a confirmed receipt, original status is `open`. `LinkCentralCase` persists the exact reference and changes status to `submitted_to_trust`. Neither status is a decision, accepted appeal, resolved dispute or completed takedown. The native records view reads these original fields under the same current private snapshot and never clears an unknown intent simply because a local case or a reference is visible.

There is no owned original Music endpoint that fetches or authenticates a final shared Trust decision. The publisher must supply the exact protected shared read/reconciliation/outcome producer contract and evidence of same-case/same-requester authorization before final decision display or application can be implemented. Consumer route/schema/persistence work can then be completed within the existing Music service; no ad-hoc status URL, unsigned decision or invented success is an acceptable substitute.

## Verified engineering and separate remaining gates

The native four-kind software exercise uses the original generated SDK, original Go Music service and an explicitly isolated synthetic HTTPS provider. Each logical original request is created once, each isolated action is dispatched once, the successful native response is deliberately lost, cold original SDK/cache restoration retries the original key, and original record fields/receipt/actor are checked. Non-owner appeal/takedown each yields original HTTP403 without SDK retirement or a persisted case. Existing report unavailable-provider/local-only/tamper/foreign/old-epoch/pause/same-body recovery checks remain.

This is not a live shared Trust producer, Wallet approval, installed/rendered native UI, public Host/currentActor or final review acceptance. Exact native packages, source pins and source composition results belong to the accompanying frozen checkpoint. The earlier Creator iOS 120-second full-run timeout remains a retained NOT_CONFIRMED historical failure; later greens do not identify its cause. The first four-kind status assertion failure is separate and explained: the check incorrectly expected `open` after the original service had linked a receipt and persisted `submitted_to_trust`; original source and failed outputs are retained.
