# Multi-asset model integrity boundary

Status: PROGRESS; neither classifier admission nor a release candidate.
Baseline e3e77991fae0455377ca202af4ec385ec8a8aef3.
Owner branch codex/social-wallet-chooser-20261001.

New localModelBundle.ts supports the existing single complementary pipeline:
XS gore/sexual graph, 256 SigLIP2 Q4 encoder, violence graph and its external
weights. Existing single-file artifact API and other owners are unchanged.
A caller must provide independently trusted bundle identity/version, exact raw
manifest SHA256 and signer public key. No default signer or first-use trust.
Strict Ed25519 verifies raw bounded manifest bytes before JSON interpretation.
Four exact ordered roles/filenames, immutable HTTPS source revision paths,
graph/data source pairing, per-file and aggregate bounds, each actual digest,
calibration digest and notices digest are required. Copies isolate verified
bytes from caller/returned-buffer mutation; immutable metadata is retained.

Integrity is explicitly separate from model accuracy, scientific calibration,
license approval, executable graph/runtime validation and filter activation.
The module neither downloads nor loads a graph and does not collect secret keys.
Copy/hash validation is background work, not a product UI-thread operation.

## Actual checks

Nine focused signature/schema/tamper/copy/bounds tests PASS; no skipped cases.
Scoped typecheck of only the new module and its tests PASS under original Social
compiler settings. Initial temporary configuration could not resolve node types
(TS2688); explicit original owner @types path resolved that environment issue.
No compiler strictness, existing test or product configuration was changed.

Actual four pinned public model assets totaling 77378704 bytes were revalidated
against independently fixed byte/SHA values and passed the new integrity API
using an ephemeral generated software-fixture signer. Check took 292.491ms.
The fixture secret was not persisted. NOT an official signer, signed download
manifest, release attestation or license/calibration approval. Calibration and
notice payloads are explicitly QA placeholders; filterActivation remains false.
The original cached models were not changed or committed.

Full current owner tests: 296 total, 295 PASS, 1 FAIL, 0 skipped/cancelled.
The only failed test remains the previously reported uncommitted worker factory
synchronous-abort teardown defect. Full project typecheck still exits 2 for the
same sixteen strict-index diagnostics in that new worker test fixture.
These files/logs stay intact; they are not included in this focused commit.
No full-green claim, full build claim, Worker mount, public deploy or installed
source identity is made. Failure repair choice remains pending, and automatic
continuation does not authorize that specific correction.

## Remaining full Social gates

Formal reviewed model signer/manifest/calibration/notices, Worker defect repair
and bounded actual browser/native execution, product display/settings mounting,
independent contextual calibration, real identity/Matrix/runtime, official
source-bound installed/public package and real user/dot acceptance are incomplete.
MONSTER NOT_RUN. No Wallet account authorization, signing, transaction,
production deployment or existing private-data/key modification occurred.
Only coordinator: 接续测试网生态审计工作.
