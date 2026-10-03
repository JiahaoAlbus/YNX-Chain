# Guest room appearance and explicit infrastructure failure

Base: d6c9b9fe697ff0b51338302d96e714ebef37c5ad. Social-owned presentation
source only; no crypto producer, protocol, trust provider, shared ownership,
deployment, or activation changes.

The native hook now derives a room slot even when account is null. A guest's
"this conversation" edit goes to that room's local preference, never the guest
global default. Account directories remain separately hashed. Room/account
identifiers are validated before hash/open; malformed/empty/oversized UTF16
inputs reject, not redirect to guest. Valid Unicode/emoji remain exact without
normalization. These slots are display preferences, NOT account/room authority.

The inherited 8c independent failure is preserved in inherited-independent-fail.txt
(6 PASS / 1 FAIL). Its newer valid record's hash-provider exception had been caught
as corrupt data, incorrectly returning an older valid preference. Candidate parsing
now catches only synchronous invalid JSON/shape. Hash infrastructure errors escape
unchanged; invalid hash output also rejects explicitly. Correct hash execution with
a mismatching digest still marks that side invalid. Pre-read/envelope/nested budgets,
original opposite-side recovery, zero writes for two invalid sides, original-slot
write binding, and persistence/readback errors remain intact.

## Actual evidence

tests.txt: eighteen focused tests pass, comprising six new binding tests and twelve
affected journal tests, including the original hash failure shape and persistence
failure. No unrelated full or crypto suites are repeated for totals.
typecheck.txt: full Social TypeScript exits 0.
bundle-build.txt: actual Expo Android/iOS Hermes JS exports exit 0.
candidate.json pins base+five source hashes, inherited failure, both HBC outputs,
metadata, and durable local-js-bundles.tar.gz bytes/SHA.

The original independent probe is NOT rerun or modified by this owner. These are
owner assertions, not independent admission. The real Expo filesystem and native
widget operations are NOT_RUN on this successor. Root retains sole UI/device
scheduling; no unlock bypass, emulator restart, data cleanup, signing, or account
request occurs. Archive is local JavaScript only, not APK/IPA or a formal release.

The 06d consumer and d6 cross-room crypto failure retain their separate HOLD and
coordination needs. No new algorithm or protocol is enabled. Full Social v2,
crypto32, actual users/nodes, installed/public source binding, and actual
dot/MONSTER remain incomplete. Existing accounts, messages, keys, preferences,
photos, and other owners' work remain preserved.
