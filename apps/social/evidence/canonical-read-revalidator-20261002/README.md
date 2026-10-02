# Canonical read and owned revalidator successor

Status: SOURCE REGRESSION ONLY. Deployment remains NO_GO.

Parent source: d0ed073cb57d04419fc09621656c6e7b7de1daa1.
Parent tree: 934897262f3f0601a0ecab53dcc514830228c928.
The enclosing commit binds this evidence to its exact owned source blobs.
SHA256SUMS binds evidence bytes; SOURCE_BLOBS.txt records Git blob identities.

## Owned changes

- Reject unknown semantic fields, comment relations on top-level moments, and incomplete encrypted attachment descriptors on reads.
- Validate canonical descriptor bytes with the existing locked matrix-encrypt-attachment SDK primitives. No new crypto implementation or dependency installation.
- Accept absent standard Matrix info on reads. Preserve the stricter original YNX uploader size/MIME contract on writes.
- Inject the approved shared revalidator into the owned daemon using its existing Social web client and paired server ENV configuration.
- Disabled revalidation returns a genuinely nil interface. Partial or invalid configuration fails before state creation, without logging key material or supplied paths.
- Use the approved shared protected loader, not a second loader. Isolated test PEM fixtures resolve physical temporary paths rather than weakening loader controls.

## Evidence provenance

Freshly executed in the owner tree before this commit:

- same-original-read-probe.json: original independent probe assertions retained; 11 cases.
- real-sdk-attachment-read.json: real SDK/WebCrypto descriptor and decryption checks; 10 cases, with and without optional info, malformed descriptors, and ciphertext hash tampering.
- consumers-test.log: normal owned test command, 111 cases.
- typecheck.log: normal TypeScript check.
- normal-entry-bundle.log: ordinary session UI browser bundle, not a release build or deployment artifact.
- current-approved-overlay-full-race.log: fresh uncached race tests for internal/social and cmd/ynx-sociald against the approved readonly 288 overlay. This includes paired configuration and actual subprocess startup/config-check tests. It remains overlay regression, not a complete combined candidate or deployed runtime.

Preserved earlier exact-work-in-progress regression logs, not rerun in this freeze step:

- approved-overlay-full-race.log and approved-overlay-startup.log: owned Social/daemon tests using readonly approved shared source 28845fb4a70f3484b6de3168cefefbdcf608c886, tree 31ddfbc74c13da4703225b2f300ea74f3f01a34b.
- approved-shared-source-blobs.txt: approved shared source identities used by that regression context.
- original-read-schema-fail.log: retain original independent failures, not rewritten as successes.
- original-protected-loader-fixture-fail.log: retain the rejected symlink-ancestor QA fixture failure; production loader policy was not relaxed.

## Unmet gates and boundaries

The ordinary owner shared baseline lacks the approved newer shared APIs. Readonly overlay regression does not prove an immutable combined integration tree, production key registration, Host configuration, or current deployed identity.

No real Matrix HS/RP/existing MXID authority loop, public source-bound business flow, installed lifecycle, Wallet account authorization, signature, transaction, or new real Matrix identity was exercised here. Synthetic test encryption keys are software QA only.

Actual encrypted attachment download consumption and full unknown/unindexed durable settlement remain incomplete. The full Social v2 objective stays active.

No shared source, vendor generation, Host configuration, or writer2-owned vercel.json is included. No deployment is permitted without a separate Central single-use lease. Coordination owner: 接续测试网生态审计工作.
