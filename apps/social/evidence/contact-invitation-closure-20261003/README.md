# Social contact and original invitation source closure

Parent: 4396dc41ee16c51cc1dd277b8959b692d6ae2fb3.
Scope: Social-owned product and evidence paths only. A-owned release configuration is untouched.

This is source/software QA, not public, installed, real Matrix federation,
real encryption or release acceptance. Shared authority remains the original
approved authority; no extra grant, deployment, account authorization, signature
or transaction is requested. Go validation uses the admitted shared288 overlay,
not a final integrated runtime. Normal esbuild bundles are not release artifacts.

Included functionality: accepted stable contacts into the existing mature Matrix
consumer, current relationship rechecks, review/cancel controls, personal QR,
privacy settings, owner invitation readback/create/revoke, original request nonce
across tabs and retries, original invitation hash rehydration after integrity
verification and restart, and exact public discovery URL scan classification.
Public landing/guest preview and installed return integration remain pending;
private preview and explicit confirmation are not a public preview implementation.

Failure provenance is retained, not rewritten as success:
- Earlier patch rejection and absent tests directory were tooling failures.
- Earlier VM consumer fetch context required explicit original fetch injection.
- Earlier Go compile failed for missing net/url import.
- Restart regression returned HTTP409 because original invitation runtime hashes
  were omitted from JSON clone/load. Fix restores hashes from the exact original
  canonical record without changing persisted format or replacing capabilities.
- Browser fixture records one expected negative HTTP409 console message;
  consoleZero is false. Actual camera scanning remains NOT_RUN.
- web-source-tests.log preserves the first closure attempt: camera fixtures used
  noncanonical synthetic-social-qr and failed after strict discovery enforcement.
  Corrected tests use canonical synthetic locators and add explicit rejection.

Historical failure descriptions are inherited trace notes, not reconstructed raw
logs. Preserved earlier logs and browser JSON are explicitly software fixtures.
No user records, keys, requests or protected databases are deleted or reset.

Unverified external gates: actual HS/RP/original MXID, two nodes, 6423 root,
ABC devices, dot, source-bound public deployment, installation and invite return.
A remains sole integration/release executor; Central NO_GO/single-use lease apply.
