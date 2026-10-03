# Dormant Matrix V2 opaque transport format and recovery rules

Base source: 982f580c70782c798a0b8da7edaf50f34a99a754.
Official Matrix event-size and send semantics:
https://spec.matrix.org/v1.16/client-server-api/#size-limits
https://spec.matrix.org/v1.16/client-server-api/#transaction-identifiers
Actual pinned Android SDK26.09.28 API inspected: Room.sendRaw(content,eventType)
returns an event ID, but exposes no caller transaction argument in that method.
No caller transaction is invented or substituted for SDK transaction identity.

New public-only format uses com.ynx.social.veil.encrypted.v2 with a small mxc
media descriptor, exact suite/version, Signal cipher type2/3, claimed sender
message ID and ciphertext SHA/size. Cipher bodies are never put in a large
inline room event. Full event/federation signatures still require server tests.
Outer IDs, digest and metadata are NOT authenticated context. Native engine
must independently authenticate the inner envelope, verify downloaded bytes,
check protected recipients/context/revocation, and compare the inner ID.

Pure mapping preserves local operation, sender message, SDK transaction and
Matrix event identities separately. Unknown send is readback-only. Observed
transport event is NOT delivery/read/private-operation proof. No actual durable
journal, upload, SDK send/sync/receiver bridge or authority producer is installed
by this change. Formats/rules are inactive consumer prerequisites, not runtime.

Legacy Matrix Olm/Megolm and legacy XChaCha algorithm dispatch preserve original
JSON byte-for-byte for read-only readers. This does not itself decrypt history
or migrate it. No legacy sending API or downgrade is added. Existing native
legacy paths are unchanged; protocol activation is still false.

Project full tsc --noEmit exit0 after fixing test import suffix. Strict emitted
Node16 compilation exit0 and eight emitted tests PASS. First runner path failure,
initial TS5097, standalone TS5112 and Node10 deprecation diagnostics retained.
The standalone compiler selects Node16 explicitly; full project configuration
was not modified. Original TS-stripped test output is initial, not final source.
This is controlled format/recovery evidence, NOT real Matrix node/device proof.

Next integration: native protected journal+opaque upload+real SDK send/restore,
unknown readback with authenticated native receive, CryptoEngine/LegacyReader
routing, full group/fanout, attachments/backups and UI/platform user journeys.
A/Native independent device/anchor/provenance inputs remain required; no JS,
Matrix account/room or SSO metadata can mint those authorities. No Host deploy,
wallet account/sign/tx or MONSTER acceptance occurred.
