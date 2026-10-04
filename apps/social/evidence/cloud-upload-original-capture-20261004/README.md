# Preserve original ciphertext across multipart upload awaits

Base source: e198368223518f384edaee1f202a67f6b5b1571e.
Base tree: cce09c3941b4749af4710e4dad1f036c8b795f70.
Controller: 01a094cc-0ba3-7901-bcd5-56fce8330c0d.

## Actual consumer path

Social App.tsx imports SocialCloudAttachments and constructs it in its attachment
flow. resumeAttachment registers and persists the object record, resumes upload,
persists the signed request, queues it and then transmits. An earlier limited
search only under src TSX did not find this root entry; that observation must not
be interpreted as no product consumer. The root entry was read for the actual
call sites; this change does not modify App.tsx or its existing storage behavior.

## Original failure and repair

New controlled probes invoke the original actual upload implementation. The
original run exits 1; original-red.txt retains its failures:

- Changing the caller ciphertext during the upload.create capability await sent
  different part bytes than the original record's signed ciphertext digest.
- Changing caller record identities and binding metadata during that await
  disrupted the original operation instead of continuing with its original record.
- A progress callback changing the caller buffer changed a later multipart part.

upload now validates the existing size limit, captures a detached frozen record
and copies ciphertext into its own Uint8Array before the first capability await.
All requests, digest comparisons, part bytes, progress totals and completion checks
refer to those originals. The caller objects remain mutable and are not frozen or
rewritten. Existing capability operation/identity checks, HTTPS origin restrictions,
credential omission, redirect rejection, 25 MiB limit and 1 MiB parts remain.
No new grants, permissions, key handling, crypto format or Cloud endpoint is added.

The new tests use controlled capabilities and a controlled transport, not real
Product Session authorization or a Cloud server. They transmit only synthetic
ciphertext in process. Existing Legacy attachment roundtrip/retry tests remain
Legacy fixtures; they do not certify the dormant new native core or its activation.

## Validation

Cloud attachment/capture, message outbox/recipient and durable outbox related tests:
15 PASS, 0 FAIL. Full owner Social tsc --noEmit: exit 0. Isolated current-source
web build with the two changed files: exit 0. Original interrupted multipart test
still skips the accepted original first part and recovers the exact Legacy fixture.

The web build is compatibility evidence, not a claim that its standalone guest UI
executes this native attachment flow. No actual private-session/upload UI, original
server capability, production ciphertext, Matrix SDK event, installed file decoder
or MONSTER ordinary-user check was performed. Those remain NOT_VERIFIED and must
use the original admitted runtime and source-matching installed product through
the existing controller/native owners, never fixture authorization.

No public deployment, SDK/core activation, account request, signing, transaction,
key collection or inherited queue/cache/APK cleanup occurred. No Cloud-owned or
shared source was modified. Previous release carrier bytes were not rewritten to
claim this later source. Full Social/crypto649 remains NOT_COMPLETE.
