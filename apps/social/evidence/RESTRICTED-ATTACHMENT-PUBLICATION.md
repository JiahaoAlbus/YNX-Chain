# Restricted attachment publication and original-intent repair

Baseline source: 2cc1ec6ee45e354e394254420bd9a5ae6f1badce.

The Matrix workspace composer now offers an optional encrypted attachment.
Review captures its original File object with caption and transaction. Publish
uses the existing official encrypted media preparation, then the original
RestrictedMoments consumer sends a standard m.file inside the encrypted room.
Caption is retained in the YNX moment semantic marker. Success requires sender
authentication, exact encrypted file descriptor/info and caption readback,
followed by the original authorized metadata index. Unknown readback retains
the original draft/file/transaction; explicit retry uses the known original
encrypted upload instead of uploading again. This is memory-only recovery.

## Independent failures repaired

Central's original 30ae component review exposed mutable caller-audience
substitution during an await and mutable binding fields bypassing an unknown
upload lookup. The helper now deep-clones/freezes its reviewed audience, checks
the original caller audience and account/user/device scalar values at each
preparation await boundary, and keys pending work by the original transaction
alone. An unknown operation cannot become a second operation through fresh
capture, changed device fields or rekeying. Retry additionally compares the
new requested audience to the retained snapshot. Preparation and publication
share the retained snapshot; the record is settled only after confirmed index.

The independent fixture was copied unchanged to
`src/independentRestrictedAttachments.test.ts`. All four cases passed, including
the actual unchanged policy-consumer test and original byte snapshot control.
Two new actual UI-handler/consumer/HTTP integration tests cover encrypted file
roundtrip plus caption and substituted ciphertext hash/readback retaining the
original transaction. Synthetic DOM/authority/Matrix client are clearly local
test drivers, not installed/public/homeserver evidence.

## Executed evidence

All 108 npm tests passed, no skips. Typecheck passed. The normal session-ui
browser entry bundled with esbuild (3.0 MiB). Logs are under
`attachment-publication/20261002/`.

Failures are retained: the original independent 30ae failure log; the first
success-only integration run (104 tests); and the repair attempt that ran
without the intended copied independent fixture due to a wrong cwd-relative
copy destination. That repair run failed the existing audience-substitution
test (103/104). A retained retry had ignored a newly supplied audience object;
the additional exact retained-audience check fixes it. The corrected fixture
copy and final 108-test run are separate evidence, not retrospective PASS.

No shared/Host code, actual database, keys, legacy content or existing chat
attachment behavior was changed. No deployment or real wallet/account/signing
transaction occurred. Production after-await ProductSession revocation, real
homeserver lifecycle, actual ordinary-user/browser/installed acceptance,
protected durable cold recovery and full Social v2 remain unproved. Keep the
component/source repair gate separate from public or product completion.
