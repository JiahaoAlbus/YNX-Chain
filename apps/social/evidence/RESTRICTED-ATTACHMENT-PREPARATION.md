# Restricted attachment preparation checkpoint

Baseline source: 0f4a9034446d207c457315ff3597e907397a57ef.

The new `web/matrix/restricted-attachments.mjs` component reuses the official
`matrix-encrypt-attachment` codec and the existing restricted-moment policy
consumer's `check` method. Original transaction, account/device operation,
reviewed audience, name/MIME and exact byte digest bind a preparation intent.
Files are limited to 25 MiB. Only ciphertext is uploaded with an opaque name;
decryption metadata remains in the standard Matrix `m.file` descriptor.

Audience authorization and existing device trust are checked before encryption,
before upload, and after upload. Policy changes before upload stop dispatch.
Known uploaded receipts are retained for an explicit same-intent retry without
reuploading. Unknown upload results block retries until settled. Account lock
after upload cannot return a prepared descriptor. No message send or metadata
index is performed by this component.

Six new local tests cover actual official codec encryption/decryption roundtrip,
pre-upload revocation, post-upload policy failure/receipt reuse, unknown result,
account locking, and file/audience substitution. The complete npm suite passed
100/100 without skips. Initial typecheck failed because the test directly
accessed a prohibited plaintext `url` field; the test now asserts absence with
`in`. The failed log is preserved alongside the successful typecheck log.

Evidence: `restricted-attachments/20261002/` in this evidence directory.

This is source/component progress, not mounted UI, real homeserver, installed,
public, full ProductSession-after-await or full Social v2 evidence. Pending
records are memory-only, not protected durable drafts or cold recovery. No
deployment or real wallet/account/signature/transaction was executed. Existing
chat attachments, legacy history, storage keys and server state are unchanged.
The next integration must publish this descriptor inside an encrypted restricted
moment, authenticate readback, and bind the original index transaction; it must
not treat preparation as delivery. Production authorization remains dependent
on shared owner A's approved live-session contract and real homeserver adapter.
