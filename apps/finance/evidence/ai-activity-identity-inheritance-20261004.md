# Finance original AI activity identity inheritance

Owner predecessor: `c096adf64c2b07e17c9e8ed42f3a04c320f34680`, branch `codex/exchange-sso-cookie-binding-20261002`.

Input authority: `/Users/huangjiahao/Desktop/YNX Project Audit 2026-09-06/coordination-01a094cc/recovery-20261004/finance-ai-identity-product-input-handoff-20261004/EXACT_PRODUCT_INPUT.json`, immutable original capsule `finance-original-ai-context-asset-source-20261004`. Only the three explicitly returned Finance product leaves are inherited; no shared Auth, SDK, grant, Host, or other product source is changed. The previous ai.go content matched the capsule before SHA `28f9e678cc8b116acf4f0035a3251238ef25905fa05a65ad01db728a72b71eca`; its only modified hunk replaces silent map overwrite/selection with the identity validator.

| Path | Bytes | Git blob | SHA-256 |
| --- | ---: | --- | --- |
| internal/finance/ai.go | 17589 | 2677efd78465901affd8d84fd94a3f53d9b8310c | 8da2445d2f280ce0b78eb33a142ffcbc7f8207aadc72ee98e5a669e3974c289c |
| internal/finance/ai_activity_identity.go | 1216 | 116862443bc1446147b0428d51d855ba68c11647 | 86f95fa268d9e8e82dd8679531516b74e873b1546656abf3086c9c519bc2b5f8 |
| internal/finance/ai_activity_identity_test.go | 2106 | e57f393f922d908b2ddaa7d9b95845f7d4c4e271 | eaee908cf70a04796744d74a856230a1d4fa0a4bb41542d204626cbbadd5b104 |

All three output hashes equal the supplied exact product inputs. Existing latest Finance UI, Exchange sender-attribution fix and Quant work are preserved, not replaced by the original whole capsule.

Empty, padded or duplicate observed activity IDs, repeated selections and foreign record IDs fail before AI provider status/estimate, journal creation or asynchronous work. Original IDs, values and requested ordering are preserved; no synthetic identity, silent sum or duplicate overwrite. Explicit empty context remains compatible. The tests use isolated local state and a nil provider to prove rejected identity never reaches it, and assert no AI job/audit addition.

Executed source tests:

- `go test ./internal/finance/... -count=1`: Finance PASS 10.744s; brokerage PASS 0.422s.
- `go test -race ./internal/finance -run 'TestOriginalAIActivity' -count=3`: PASS 1.524s.
- Exact source hashes/blob/bytes and `git diff --check`: PASS.

Truth: source inheritance and local tests only. This does not prove public current-source deployment, real AI provider completion, Wallet approval, private Product Session, installation, user acceptance or full product completion. No remote service, account, signing or transaction action was performed. Shared runtime composition and formal publication remain separate from this ordinary product fix.
