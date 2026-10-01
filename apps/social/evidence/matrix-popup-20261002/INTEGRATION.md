# Normal Social SSO popup candidate

Parent 46833dcbcb84edf7c34aee88a507b59e45d72d35. DELIVERY 18:33Z read before edits: A and existing Social are the only source writers; deployment/shared Auth remain A-owned.

Product root cause: normal Social Matrix panel never supplied reauthenticateDevice, despite session-only transport support. It now supplies a controller using the actual challenge, original account/userId/fixed homeserver binding, live existing Social identity/private grant validation and captured transport generation.

The user must click a specific Continue button to open the fixed homeserver fallback URL directly. No about:blank staging tab. Popup response must be authDone from exact homeserver origin and exact window source. Identity is rechecked before completion; switch/revoke locks and cancels. Cancel, popup-close and consumer timeout reject, clean listeners and close popup. Timeout is a local bounded consumer deadline, not a claim about upstream UIA expiry. No OIDC issuer or authDone issuer is created by this module. Same-MXID/device whoami is now checked from the captured actual Matrix client before final DELETE retry. Actual server success is still required.

Targeted tests: 21/21 PASS including exact session-only replay, wrong upstream MXID, origin/source rejection, cancellation/expiry, identity/generation replacement. Some use synthetic SDK/popup inputs; not real SSO evidence.

Actual new isolated two-Synapse run: federation.json 13/13 checks PASS, preserving prior SAS/reject, bidirectional ciphertext, attachment/offline cold recovery, disk failure lock/retention and independent process recovery. Original room and device are retained, no key reset.

Actual third device run: four checks PASS; confirmed deletion FAILED at 401 flows:[], with no reauth hook available in that dedicated QA client. Production SSO and deletion/token invalidation/new-Megolm exclusion remain NOT_RUN. Failed delete is not labelled NOT_RUN.

New browser popup harness popup.mjs FAILED at initial Node parsing due to a missing closing brace in its validateIdentity callback. Browser popup acceptance is NOT_RUN, not PASS. This defect has been reported with a request to repair; no original failure receipt is overwritten. The policy tests are not a substitute for real popup clicks. This candidate is not a release signoff.

A still needs the actual operator fixed HTTPS homeserver, Central OIDC issuer/discovery, RP client registration and exact /_synapse/client/oidc/callback, stable Central subject/account mapping and supported m.login.sso stage. Empty flows block; no administrator, AS token, invented password or parallel YNX account fallback. The QA callback route, once corrected, is only engineering UI flow, never production OP proof.

Original data/keys/cache and prior failed evidence preserved. Own QA homeserver containers/network stopped; private profiles retained. No shared source, deployment, host/real user browser or sensitive account/sign/chain requests.
