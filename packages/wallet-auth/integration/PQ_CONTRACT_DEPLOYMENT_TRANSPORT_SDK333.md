# Contract deployment transport DATA

SDK333 adds `pq-contract-deployment-transport` (portable) and
`pq-contract-deployment-transport-node` (Node only). It preserves the original Go
ordered five-field envelope: `version`, `type`, `wireHex`, `source`, `material`.
Material holds exact raw `artifactFile` and `buildInfoFile` bytes encoded with
standard padded Base64. No compiler-file parsing, formatting or hash protocol
is implemented here.

Capture material before requesting keys. Source must already be the original
Go canonical transport text: nonempty UTF-8 up to 64 KiB, without Go whitespace
at its edges or lone UTF-16 surrogates. The SDK refuses rather than trims.
Raw Counter source has a trailing LF; its raw file alone is not the canonical
source string signed in a deploy envelope. Artifact transport cap is 128 KiB,
build-info cap 16 MiB, and envelope cap 24 MiB. Go HTML/U+2028/U+2029 escaping and
field ordering are preserved exactly.

The portable codec validates byte framing only. The Node adapter additionally
uses the original full Member/Action decoder, branded account snapshot and
registered dual-signature verifier; it requires `contract_deploy`. Every result
remains DATA with `nativeAdmission:false` and
`compilerMaterialValidationRequired:true`. The original Go compiler validator
must independently bind source/code/config/ABI to its fixed registry. These
functions do not acquire Source, request user approval, sign, send, or verify
finality.

The actual HTTP admission limit is separate: the current normal broadcast
profile requires `4 * ceil(envelopeBytes / 3) + 74 <= 792658`. A locally encodable
large build-info file does not imply HTTP acceptance. The original Main owns
that admission check and the sole POST; this codec adds no alternate transport.

New controlled tests cover the exact envelope, raw U64-containing file bytes,
Go whitespace/escaping, strict schemas/Base64, intrinsic byte copies, snapshot
and signature checks. Original public compiler files have independently pinned
bytes/hashes. Synthetic signed deploy tests do not certify those materials.
The actual Go signed deploy fixture is still pending; no cross-Go deployment,
Native grant, real broadcast, installation, publication or mainnet claim follows.
