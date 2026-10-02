# Restricted Moments consumer checkpoint

Production consumer: web/matrix/restricted-moments.mjs. This consumer requires
an injected live audience authority and the existing MatrixSocialTransport.
No audience endpoint, consent scope, Matrix user or cryptographic primitive
is created by this checkpoint. It is not yet wired into the product UI.

Local policy regression: 83 tests pass, zero skipped. The first comment-enabled
typecheck failed TS2322 because JS inferred parent as null-only. The initial
checkpoint incorrectly recorded typecheck as passing before awaiting its exit.
This successor adds explicit parent parameter typing; final validation results
are reported separately and the original failure is not erased.
Seven new cases use synthetic transport and authorization callbacks, not real
homeserver encryption. They test metadata-only publication receipt, stale
revision, account stop, uncertain delivery, concurrent preparation, forged
parent and authenticated-parent comment policy. The encrypted-room test name
describes the intended SDK carrier, not measured ciphertext on a homeserver.

Fresh live revision and exact joined membership are required before SDK send
and checked again after it. A post-send policy failure cannot retract delivery;
original transaction, content and any returned event ID remain unknown.
Comments require an authenticated decrypted parent with matching owner,
protocol, audience and revision, not a caller-supplied receipt alone.

Remaining product work: actual approved bounded audience authority and scopes,
UI wiring, room/audience lifecycle, durable protected draft and exact-retry
recovery, metadata-only backend index, encrypted attachment integration,
read/render policy, Native mature bridge, real independent-device HS tests,
membership/key-sharing race proof and public/installed acceptance. A final
authorization check cannot itself make concurrent relationship changes atomic
with an external homeserver send; no revocation atomicity claim is made.
Public Square and old plaintext content remain unchanged and explicitly
outside this new encrypted namespace. No deployment or Wallet sensitive action.
