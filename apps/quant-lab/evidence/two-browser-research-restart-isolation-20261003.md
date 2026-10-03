# Quant two independent browser profiles and real service restart

Parent source checkpoint: 002a515616c7d3a3e02026bea2adc60df5e286ec.
Owned change: extend the actual Go/Chrome research-recovery integration test.
No product authority, tenant policy, persistence schema or runtime code changed.

Two independent real Chrome contexts open the same local Go app through normal
pages. Each browser creates its own existing local-preview binding through the
shipped app; no preseeded account, tenant header, strategy or experiment is
injected. First browser saves research and loses its response. Second browser
saves a different name/cost through the real form and engine. After actual
SIGTERM/service restart both profiles reload their own persisted records. First
browser's exact-key retry recovers only its original experiment; neither rendered
table exposes the other's research. Both processes stop normally and both
contexts have one page and no pageerrors.

Initial new test FAILED: it wrongly assumed per-workspace sequence IDs were
globally unique. Both correctly isolated stores used experiment-000001. The
test, not engine or identity policy, was corrected: bind independently generated
browser capability IDs, distinct request keys, exact complete persisted content
and no cross-visible rows. This initial failure is not erased or called a product
isolation defect.

Corrected actual integration: 1/1 PASS, 4639.230167ms test / 4806.518125ms total;
independentBrowserContexts=2; cleanSIGTERMStops=2. Syntax and diff checks PASS.
Retained local QA directory:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-research-recovery-86DYPY`.
Local binary: 11466914B SHA256
`de7d339c3cdbc349e194c3ef0b12c6bfc9e87959072ff0cdc1bccc6328df2363`.

Scope limits: loopback controlled tape, existing local-preview workspace
capabilities and filesystem persistence; not authenticated independent Wallet
users, production PostgreSQL, public trading, installed product or Product
Session evidence. Those requirements remain unverified. Previous publication
input manifests are immutable historical source checkpoints; this new test
delta must be included separately by the unique release owner, without waiving
source hash/pin mismatches. No Host, account request, signature, order or
transaction action occurred. Ordinary rollback is this isolated test delta.
