# PQ action transport DATA helper

The independent SDK332 source candidate adds two explicit subpaths:

* `@ynx-chain/wallet-auth/pq-action-transport` is Node-free. Call
  `encodePQActionTransportData({member, originals})` or
  `decodePQActionTransportData(raw)`. Both operate on ordinary `Uint8Array`.
* `@ynx-chain/wallet-auth/pq-action-transport-node` exposes
  `preparePQNativeActionTransportData(snapshot, {member, originals})`, reusing
  the original Member/Action codecs, policy planner and registered dual-pair
  verifier against an SDK-branded snapshot. The snapshot still needs genuine
  independently acquired Source/current trust from its original owner.

The portable leaf validates only exact outer JSON/encodings/sizes and copies
opaque bytes. It deliberately cannot decide an Action kind or approve a Member.
The semantic Node adapter permits originals only for `stake_delegate`,
`stake_unbond`, and `stake_withdraw`. It checks the full E, current network,
native chain, owner, nonce, pair, revision, height and original dual signatures.
It preserves N/index; it does not relax a local signer's N1/index0 contract.
Contract deployment needs its separate compiler-material contract and refuses
this three/four-field helper.

Outer fields retain the Go struct order `version,type,wireHex,originals`.
Empty originals emit the original three fields. Explicit empty/null originals,
unknown/duplicate fields, extra whitespace, noncanonical hex/base64 and field
reordering refuse during decoding. Limits are the original 128 KiB Member,
16 KiB per classic original and 24 MiB encoded envelope. Outputs detach input
bytes; repeated access returns fresh copies.
Impossible classic witnesses below 128 bytes also refuse before per-item
allocation: even the shortest Go canonical staking struct is larger. This
conservative floor prevents tiny fake originals from amplifying object memory;
it does not claim classic transaction semantic validation.

Classic originals remain exact raw bytes, including full-width JSON numbers,
public key, signature, payload and their original spelling. The portable leaf
and Node adapter do not certify their canonical transaction semantics, ECDSA
signatures, successful historical fee events, ordering or complete delegation
history. That is the original Native/Go executor's responsibility. Nonempty
originals retain `classicWitnessValidationRequired:true`. Do not parse and
re-encode these transactions through JavaScript Number.

Main exclusively retains user review, private custody, pre/post current checks,
journal, result queries and actual transport sending. No helper opens a socket,
supplies a signer, creates a nonce, obtains approval or retries UNKNOWN writes.
Decoded DTOs and Node adapter results carry `dataOnly:true`,
`nativeAdmission:false`; the encoder returns only bytes.

The fixed public fixture is derived from Protocol source
`fd8b8dcf7dda9823a439db04b1e33e2375014568`, CI `39165250907`, source JSON
3,022,392 bytes / SHA256
`6243aaecb56f4c0c78efeaf7b5ba1143ca4b9d60417ba7694dff5c179e300aea`.
It preserves the actual 57,979-byte Member (N2/index1) and 116,764-byte transport.
Its execution was synthetic real ABCI with an application-backed HTTP mock.
It proves no actual Comet node, independent finality, Native grant or deployment.
The source pure modules passed; the whole Protocol CI was canceled at its time
limit. This fixture is not a claim that the whole run passed.

SDK331 and SDK330 are sealed and unchanged. This independent candidate needs
matching consumer integration, packaging and normal release gates before use.
