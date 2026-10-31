# Original Core invoice native action SDK intake

This extends the existing pq-native-action codec/type map, not a new signer or
financial product. Only pq-native-action.js/.d.ts source changes. The original
16 kind definitions are byte-identical; policy/transport/signing, all other
227 source files, and package exports/version are unchanged. Parent alone owns
Main, public prefix, CI and release integration. Existing dependencies are reused
via a validation-only node_modules symlink; no dependency/lock was installed or
changed and that symlink is not part of the source append archive.

Exact authoritative inputs:

- Core internal/ynxauth/invoice_action.go, 5432 bytes, SHA256
  bcd011e971ee69d844c989c70ca20fedad804f7bdf28595e35bb982f73af23f8.
- Core internal/ynxauth/testdata/invoice-action-v1.json, 8108 bytes, SHA256
  d5895426311ef8f4eea003d1ec548834d92ea9100052a5eed2d3d0616dbbff9a.

Both are from original /Volumes/西部数据/YNX-large-work/protocol/pq-storage-f8-20261031.
Pins matched before implementation and at final scope capture; original files
were never edited. Testdata copy retains original fixture bytes. Golden-byte
comparison consumes Core-owned public vectors; no fresh Go math or fund test is
claimed.

Existing exports normalize/encode/decodePQNativeAction and payload variants now
accept invoice_terms/invoice_settle/invoice_refund. Types extend the existing
PQNativeActionPayloadMap; no new public subpath is needed. Each payload prefixes
its original Core invoice domain and U32BE version1. Field framing and numeric
pairs remain original E(count/length), two separately framed U32BE hi/lo per U64:

- invoice_terms: E19 [YNX-INVOICE-TERMS/v1,1,invoiceID,sessionID,recipient,payer,
  assetID,unitVersion,feeRule,keyEpoch pair,revision pair,amount pair,maxFee pair,
  expiresAt pair]. Payer is explicitly empty or canonical address; fixed YNXT,
  unitVersion='1', feeRule='native-transfer-fee-one/v1'.
- invoice_settle: E7 [YNX-INVOICE-SETTLE/v1,1,merchant,invoiceID,termsHash raw32,
  amount pair]. SDK JSON field termsHashHex is the original Core fixture's
  strict nonzero lower hex64 projection; it becomes raw32, never UTF8 hex text.
- invoice_refund: E8 [YNX-INVOICE-REFUND/v1,1,invoiceID,refundID,termsHash raw32,
  settlementHash raw32,amount pair]. JSON hash names match Core fixture
  termsHashHex/settlementHashHex. Recipient is absent; original execution derives
  original payer from committed settlement, not a new caller field.

IDs are exact [a-z0-9][a-z0-9._:-]{0,63}; addresses retain original canonical
0x lower hex40. Every payload numeric field is 1..MaxInt64, expressed as decimal
string/bigint without JS Number loss. expiresAt is execution HEIGHT, not wall
clock/RFC3339. Amounts are original ledger units1, never scaled as EVM18. Hashes
are exact nonzero32 bytes, no placeholder zero or uppercase/width aliases.
KeyEpoch/revision/hash are signed DATA claims; only original current account/
ledger execution checks prove their authority or correspondence.

Outer Action remains original E12 YNX-NATIVE-ACTION/v1; original fee must be1
for these three kinds, owner/nativeChainID/nonce rules remain original (nonce
positive through MaxUint64). No action prefix/purpose/member builder changes:
existing TX-BATCH and N=1 signing path is untouched. This task creates no Member,
certificate, private key, signature, transfer or broadcast.

Existing planPQNativeAction already normalizes via this codec and selects fee1
for these three kinds. No policy source/type rewrite was necessary. New tests
call the actual plan using an explicitly PUBLIC policy DATA snapshot (zero-byte
public-key placeholders only, no generated key or admitted account). Arbitrary
unbranded snapshot, wrong owner/nonce and disabled account fail. A successful
plan is still DATA: original Source/keyAccess/visible approval/current checks
and original chain feature schedule are required. Invoice schedule remains
DEFAULT OFF; this codec does not add an enable flag or activate that schedule.

Seven focused Node tests compare all four Core payload+E12 vectors, ledger-unit
and numeric limits, original exact schema/domain/field count/trailing/hash
bounds, actual existing plan consumption and hostile capture inputs. One
necessary legacy stake SHA/length prefix smoke passes; no old16 group reran.
Strict TS NodeNext consumer (without skipLibCheck) covers the three kinds and
the actual typed plan, and rejects Number amounts, EVM18 unit, refund recipient,
and implied authority. Baseline SDK's three INVALID rejections are retained in
evidence/BASELINE_INVOICE_REJECTIONS.json; not presented as a live Main test.

No Main/Native/SourceQueryNative/shared workflow/lock/Core/financial service or
original SDK worktree was written. No real funds, keygen, signing, network or
release occurs. Core-first/old-website freeze, original owner/no-fast and
accounts/data/UNKNOWN preservation apply to actual /root/open02_codec. Parent
owns review and original CI/normal-prefix install; real wallet business and
invoice activation gates remain separate.
