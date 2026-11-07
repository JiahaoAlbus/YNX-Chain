# IDE finite GET receiver original DATA entry

Private fixed entry: `native/original-ide-finite-get-receiver-originals.mjs`.
It is copied byte-for-byte from Auth principal-factory frozen-principal-90fBid (1627 bytes, SHA256 7ba0d7b78e61f2eaf5e6aa480af90e2987c65d889b42f4392ed4398c0c41f3cf). No public export, configurable path/provider or new decoder is introduced.

Build-time: `node scripts/ide-finite-get-receiver-closure.mjs` from the installed normal SDK package generates actual whole-package inventory and actual static graph with this specific entry. Its `manifest.files` supplies SDKFiles; the entry must be present. Generate after final packaging/installation; do not reuse source-tree counts for the installed tree. Node interpreter pin is independently supplied by the normal protected receiver configuration, never inferred from this manifest.

The Auth normal caller is OriginalSourceVerifierOwner.inspectOriginalFiniteGETV4 → invokePinnedOriginalDATA fixed entry, with input canonical JSON exact `{header,operation:'ide-finite-get-v4-originals-data/v1'}`. Output is canonical JSON + LF with exact `{version,unsignedOriginal,memberOriginal,dataOnly,authorized}`. Original script caps input/output262144, unsigned16384, Member98304. This only extracts originals; synthetic serialization controls are not registered N1 verification. Auth then calls original Core InspectProductSessionHTTPMember with independently registered DEVICE expected pair; Source/current/principal/TLS/target/nonce/Root gates remain its responsibility. No Go service source or decoder is installed by this change.

The static closure is DATA provenance, not release qualification. Missing reviewed Root/registered receiver/session/TLS and installed business flow remain NOT_SUPPLIED. No App, Native image, live server, key or account is changed. Source/package validation is not deployment.

Normal CI: `node scripts/ci/ide-finite-get-receiver-normal.mjs`, then existing canonical-common-source-package producer. The finite workflow branch is codex/wallet-auth49-ide-finite-get-receiver-20261107. Only these new controls run; no old V4/math/Native suites are rerun.
