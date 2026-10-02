# Confidential backend key loading

`LoadBackendEd25519PrivateKey(path string) (ed25519.PrivateKey, error)` loads a
dedicated server-only PKCS8 PEM key. It does not choose a client, register it,
mint identity, or authorize a product action. The action verifier
`VerifySocialAudienceProof` uses the original session's public device key and
does not require this private key.

The product daemon owns its paired configuration references. For Social use
`YNX_SOCIAL_REVALIDATION_KEY_ID` and
`YNX_SOCIAL_REVALIDATION_PRIVATE_KEY_FILE`: both empty keeps revalidation off;
only one present, or an invalid file, rejects startup and configuration checks.
Never log a private key, raw filesystem/parser error, or a configuration body.
Do not put a key into source, browser assets, cookies or the workspace.

The loader requires an absolute clean path. Each ancestor is opened via a bound
directory descriptor with no symlink following and must be owned by root or the
process UID, with no group/other write permission. The leaf must be a regular
0600 file owned by the process UID with one link and 1–8192 bytes. Bound descriptor
and leaf identity/size/mode/owner are checked again after a bounded read. Only one
PKCS8 `PRIVATE KEY` PEM block, without headers, prefix junk or trailing material,
and an Ed25519 private key is accepted. Failure exposes only the fixed typed
`INVALID_BACKEND_KEY_CONFIG` code/status 500. Temporary input buffers are cleared.

For the admitted Social web reader, load the key and call
`NewRevalidator(existingSocialWebClient, keyID, key)`, then inject that reader into
`social.Config.MatrixAudienceSessionRevalidator`. Do not use the Finance-only
`centralbrowserfamily.NewClient`. The existing Social product adapter must still
verify the actual device action proof and atomically consume its nonce with live
actor, audience and transaction checks. Revalidation neither renews the private
grant nor replaces the separate Central generation check before/after await.

The deployment owner creates the dedicated key only through a reviewed protected
Host closure. Register only its public key and exact key ID for
`ynx-social-v1-sso-v1` in the existing Central backend config, preserving the
Finance registration and original family seal. The Social process receives its
private file under its own UID; WalletAuth receives only public material under
its own UID. None of these registrations are claimed installed by source tests.
Real HS/RP/existing-MXID provenance and initial callback query-log protection
remain separate gates; do not enable examples or derive replacement identities.
