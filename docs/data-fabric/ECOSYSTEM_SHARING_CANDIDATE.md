# Ecosystem Sharing Events — Candidate

Status: `CANDIDATE`; this contract is unactivated and is outside the active
Schema Registry. It defines a common future event shape for Video, Music,
Social, Creator Studio, Calendar, Shop, and Cloud without changing their
ownership, consent, access-control, or runtime behavior.

Artifacts:

- `schemas/data-fabric/ecosystem-sharing-events-v1.candidate.schema.json`
- `schemas/data-fabric/ecosystem-sharing-events-v1.candidate.vectors.json`

The candidate covers the Fable5 media, creator-revenue, and calendar event
names. It records only opaque product references, SHA-256 content digests,
permission summaries, product-scoped owner pseudonyms, version, provenance and
audit information. Raw media, music, mail, social content, recipient lists,
keys, tokens, addresses, and cross-product public identifiers are prohibited.

An optional `chainCommitmentId` is a read-only external Chain Core reference.
It does not cause Data Fabric to compute a commitment, write Chain Core state,
or make authorization decisions.

Integration must accept one canonical version and each product owner must
provide consent, positive, negative, migration, and rollback evidence before a
producer can register it in the active Schema Registry.
