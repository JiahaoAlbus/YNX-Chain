# YNX Cloud security boundaries

This is the operator-facing companion to `THREAT_MODEL.md`.

| Boundary | Inbound authority/data | Outbound data | Credentials | Failure policy |
| --- | --- | --- | --- | --- |
| Public HTTP | Liveness and time-bounded share capability only | Bounded liveness or authorized object metadata/bytes | None | No internal health, paths, stack, provider ref, or secret |
| Product API | Canonical Wallet product session and strict bounded request | Authorized Cloud- or Docs-only response | Hashed short-lived session server-side | Missing/wrong/expired/revoked scope or product fails closed |
| Wallet verifier | Full signed authorization envelope and device challenge | Verified claims only | Operator service token | Unavailable/mutated/replayed assertion creates no session |
| Object store | Hash/size-bound put/get/delete/direct verification | Object bytes or short-lived PUT plan | Operator token; never client-visible | Mismatch/unscanned/unavailable response creates no authoritative object |
| Scanner | Name, MIME, bounded candidate bytes | Accept/reject only | Operator adapter credential when remote | Unavailable/reject prevents metadata commit |
| AI gateway | Explicitly consented unencrypted object versions and instruction | Advisory result/model/provider state | Operator AI token | No canned answer; source and permissions unchanged |
| Trust sink | Audit evidence without user secrets | Success/failure only | Operator Trust token | Asynchronous failure cannot make a product mutation succeed or alter authority |
| Recovery archive | Live state, telemetry, and provider-local bytes | Integrity manifest plus regular files | Operator filesystem authority | Symlink, path, size, digest, existing destination, or integrity failure rejects restore |
| User export | Product-owned immutable versions, grants, relevant audit | Verified ZIP and manifest | User product session | Any missing/mismatched source byte rejects export |
| Build/release | Locked source and recovered Testnet artifact | SBOM, hash manifest, verification provenance | Debug certificate only | No production/hosting/store claim without separate evidence |

Secrets are accepted only by the server process through documented operator environment variables. Web, native, SDK, logs, telemetry, traces, exports, and public metadata must not contain provider or service credentials. Loopback HTTP is allowed only for explicit local test adapters; remote integrations require HTTPS.
