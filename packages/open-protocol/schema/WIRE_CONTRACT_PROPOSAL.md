# OPEN WIRE minimum contract proposal — not frozen

OPEN-02 is partly implemented at the generic E framing layer. No domain-aware
`encodeOpenEnvelope` is exported until the owners freeze the following mapping.
The framing code cannot grant Source, account, Agent or asset authority.

The reused primitive is `E(x1,...,xk) = U32BE(k) || F(x1) || ... || F(xk)`,
`F(x)=U32BE(byteLength(x)) || x`. Empty list is four zero bytes. Control frames
are at most 1 MiB and 1024 fields. Equal field values are not duplicate named
fields; a fixed enclosing schema must reject repeated or out-of-order *names*.

## Required owner decisions

| Contract item | Packet requirement | Proposed disposition requiring Auth/Root confirmation |
|---|---|---|
| Identity outer sequence | `domainByRole,realm,networkBinding,action,audience,eventBytes,challenge32,notAfter,expectedEpoch,nextEpoch` | Preserve this exact ten-field sequence (domain plus nine fields). No extra generic wrapper or JSON bytes. |
| Domain labels | Controller, old key, new-key PoP and recovery proofs must be distinct | Auth must provide the exact UTF-8 labels and verifier role for each action/branch; no labels assigned in code. |
| Realm | New IDs are 16 bytes; `Id` is only a logical TS string | Confirm whether realm is 16 raw bytes or separately tagged stable realm text. Hex display is not wire bytes. |
| Network binding | Explicit `offchain` when no chain; do not use zero genesis | Confirm exact union encoding: tag, field count and chain genesis/nativeChainId/networkId32 order; plain string `offchain` is a proposal, not a deployed mapping. |
| Integers | Fixed integers, canonical decimal business values, epochs strictly advance | Freeze U64 width/endian for `notAfter/expectedEpoch/nextEpoch`; reject overflow. New wire encoding is not inferred from old wallet E5. |
| Action and audience | Independent action/schema and authenticated audience | Freeze enum labels, ID width and maximum bytes for each; URLs remain display data. |
| Optional/empty | Missing and empty must differ | Prefer fixed presence tag plus value, but exact tag bytes and allowed empty values require schema-owner confirmation. No omission by JSON semantics. |
| Grant/Invoke/Receipt | Different operation, issuer/holder/audience and actual input binding | Auth supplies exact ordered records, domain tags and verification rules. Reuse old signer, not new generic signing API. |
| Task handoff | `YNX-OPEN/TASK-HANDOFF/1` and current generation/revision | Label is specified; complete ordered fields, limits and optional values remain unfrozen. AI owns task persistence. |
| Disclosure | `YNX-OPEN/DISCLOSE/1`, all origins, byte length and both SHA-512 variants | Label is specified; freeze sourceSet sorting/key order, exactSink encoding and nested bounds before signing. |
| Vectors | Real shared Go/TS golden vectors | Existing YNX-BATCH Context frame vector proves E byte interoperability only. New OPEN vectors must be independently accepted by both frozen implementations before claiming protocol interoperability. |

No control/old-key/PoP/recovery role can substitute for another role. No task
reference is a session or payment authority. Formal OPEN envelope mapping,
signature validation, replay tables and effect admission are not yet supplied.
