# SSO fallback consumer correction

Exact parent: 32aa9bdb82e88930f619766adcc0c1cf95d8f2fb.
Scope: Social transport, targeted policy tests and isolated QA only. Existing blue/white UI and original logo unchanged.

## A adapter contract superseding typed-only requirement

The existing reauthenticateDevice callback receives {deviceId, account, userId, homeserver, challenge:{session,flows}}, all identity/target fields from the captured client binding. It may return:

- Direct supported UIA stage: {type:<advertised stage>,session:<exact session>,...stage fields}, as before.
- Completed standard SSO fallback: {completedStage:'m.login.sso',auth:{session:<exact session>}}. completedStage is consumer-local metadata, never sent to SDK or homeserver. Only auth:{session} is retried.

SSO fallback requires upstream-advertised m.login.sso; fallback auth must have exactly one property, session. Wrong stage, modified session, additional auth properties or a replaced account/client generation never retry removal. The upstream remains authoritative: DELETE must actually succeed; local callback completion is not proof of reauthentication or device removal. No adapter hook is configured by default.

Official protocol: https://spec.matrix.org/v1.18/client-server-api/#sso-during-user-interactive-authentication and its fallback mechanism. Operator routes SSO fallback to the fixed HTTPS homeserver /_matrix/client/v3/auth/m.login.sso/fallback/web?session=<encoded session>; the callback must verify actual completion source/window/origin, preserve target/action/current YNX grant and current identity, and retain explicit user confirmation. Browser SSO cookie/proof alone is not an OIDC issuer. Existing YNX identity must actually supply supported OIDC Authorization Code integration to Synapse; exact issuer/client registration and shared authority are A-owned. Empty flows remain blocked, no admin/application-service/password bypass. MAS/OAuth account-management deletion is still NOT_RUN and unsupported by this consumer.

## Executed targeted results

node --test apps/social/web/matrix/transport.test.mjs apps/social/web/matrix/device-reauth.test.mjs: 16/16 PASS. Three new fallback tests check exact session-only forwarding, wrong stage/session/extra fields, and identity-generation replacement. These use synthetic SDK challenges and do not prove real SSO authentication.

Actual two-private-homeserver browser run: ten protocol checks PASS, including initial explicit rejection, bidirectional ciphertext/server readbacks, attachment decryption, original-device cold offline history, newly added offline encrypted attachment cold decryption and cold-restored repeat explicit rejection. No key reset or change of device used for recovery.

Run status FAILED at new persistence fault injection. Actual assertion: locked:true, deviceRetained:true, lockEvent:true, cacheRetained:false. This failure is retained verbatim. SDK source inspection identifies a QA observation limitation: backend.getSavedSync returns a copy of its in-memory syncAccumulator, not a fresh persisted IndexedDB read. Two live snapshots differing is not proof of cache deletion or durability. Correct follow-up requires direct read-only persisted sync records and an independent process restart; do not weaken the expected preservation requirement. That follow-up is NOT_RUN. Abrupt process crash and actual disk/quota loss also NOT_RUN. Page errors were empty in failed receipt; no complete console0 claim.

Separate actual third-device run: four checks PASS (trusted send, new device discovery without key reset, changed/unverified send blocking, removal requires confirmation). Confirmed device deletion FAILED closed at 401 with flows:[]; no supported identity stage available. Real SSO, deletion, token invalidation, new-key exclusion and post-revoke recovery NOT_RUN.

Earlier failed and successful receipts remain unchanged. Own QA containers/network stopped; original profiles/private tokens/keys stay in private local runtime, never committed. No deployment or user account/sign/chain transaction. Production bridge wiring, ordinary user public flow, Native, backup and verified new-device recovery remain NOT_RUN. Targeted tests are not whole-suite acceptance.
