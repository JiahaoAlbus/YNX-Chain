# Strict context encoding successor to the 52e review

The independent 52e failures remain unchanged in controller-owned evidence.
String.getBytes(UTF8) replacement no longer participates in consumer guards or
fingerprint fields. VeilContextEncoding uses the standard encoder with malformed
and unmappable REPORT, rejecting unpaired surrogates without normalization.
Both send and receive check context/address fields before protected record reads.
Valid Unicode/emoji retain exact UTF8; composed/decomposed forms stay distinct.

## Earlier SDK boundary

pre-sdk-wrapper-attempt-1.txt preserves an actual failed companion check: the
official SDK constructor had already replaced an unpaired surrogate in its name
before getName/toString reached our consumer. Post-construction validation cannot
recover that raw name. Do not falsely claim it can.

The production-native constructors/send/receive methods now require
VeilSignalAddress.of(rawName, device). This validates strict raw UTF8 BEFORE SDK
construction, then exact-checks name/address readback without normalization.
The factory validates encoding only, never device authorization. The separately
protected signal-address and public-identity enrollment gates still apply.
Already-created SDK objects are used only by SDK callbacks and package-level QA
transaction helpers; their original malformed raw strings are unrecoverable.
The consumer exposes no production factory/Expo bridge and remains dormant.

## Original and companion evidence, not a washed result

original-probe.txt is a run of the unchanged KeylessOutboxProbe.java compiled
against this batch before the final raw-wrapper constructor change. It yields
5 PASS / 1 FAIL, exit 1. The former early protected-read failure now passes.
Its remaining diagnostic assumes BOTH malformed strings must return different
digests, so strict rejection instead produces InvocationTargetException. That
assertion requires minimal fixture adaptation to require both inputs reject;
it is NOT claimed byte-identical green or independent approval.

encoding-check.txt separately verifies rejection of six malformed conversation
forms for send/receive with zero protected reads, direct fingerprint rejection,
exact legitimate Unicode/emoji, no normalization, dotted Unicode addresses,
the SDK's observed lossy construction, pre-SDK wrapper rejection/preservation,
and the valid context's normal missing-admission boundary. Final compile and
companion check exit 0; class-load origins are retained.

final-outbox-regression.txt records the ten affected actual SDK send checks on
the final classes, exit 0, after shared encoding and raw wrapper changes. Final
inbox checks are recorded in the sibling directory. No unchanged old 24-keyless
or 15-checkpoint suites are rerun merely for totals. binding.txt pins final
source, class files, native port, and official JAR; original-probe.sha256 binds
the untouched independent input. No source admission is self-issued.

This adds no crypto algorithm, shared protocol/issuer, reset, migration,
enrollment, release, or activation. Real trust/anchor/device/product/public
acceptance and the full original objectives remain open.
