# Next Social native candidate

This is an internal installable-candidate target, not a completed product release.
Keep application ID `com.ynx.social`, its existing Android signing chain, device
keys, message outbox, upload jobs and the deployed backend source `320873bd`.
Do not publish the previous debug-certificate APK as a finished login client.

## Candidate scope

- Official immutable SDK `6f332753` and its bundled registry control native
  identity, origin, requests, callback validation, recovery and revocation.
- Guest cold start creates no product key or approval request.
- Explicit Begin persists an SDK request; only a separate Open action launches
  Wallet. Unknown installation is not a successful connection.
- Pending cold restore retains exact request bytes and never opens Wallet.
- Identity grants only `account:read` and `profile:link`. A fresh live API proof
  is required; identity must not be converted into messaging authority.
- Existing legacy Social sessions require server profile readback before the
  private application UI is restored. Their protected records are not erased.
- Existing encrypted message/group/device/attachment code and durable queues
  remain intact; this alone does not establish installed functional success.

## Required before full client acceptance

- Social server consumes official live Product Session proof and maps an
  explicitly messaging-authorized identity to its verified Social/chat device.
- Explicit messaging grant, device registration, encrypted direct/group send,
  multi-device history and device removal are tested end to end.
- Cloud owner deploys its complete backend with the shared machine environment.
  The Social attachment contract is unchanged since Cloud `65c11414`.
- Ciphertext multipart upload, restore, download/decrypt, membership removal,
  cancel and delete pass against that actual deployed Cloud service.
- Independent Android installation/upgrade/cold launch, callback and revocation
  are directly checked. Wallet account approval/sign/transaction remains behind
  immediate user confirmation; a blank Wallet is not acceptance evidence.

Machine TLS, unauthenticated HTTP 401, mocked lifecycle tests, build success and
an identity-only SDK state are separate evidence categories, never full E2E.
