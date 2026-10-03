# Exchange business request ambiguity

Owner predecessor e2e4498fdf8c1286b493cbab805bd8348d86f649/tree 0d4fc1ae0e96e8c3752152bf037e4881ae1ee632. Existing Exchange business HTTP decoder only; no SDK, shared authority/proof, scope, funds, execution or Host changes. Persisted state parsing is unchanged.

Pre-fix tests proved duplicate message fields, case aliases, escaped keys and nested duplicates were accepted. Actual isolated HTTP support request returned201 and persisted an unreviewed last-value message. The decoder now reads within the existing64KiB boundary, checks decoded keys for duplicates/Unicode case-fold aliases independently per object (including arrays), limits nesting to128, then runs the existing typed unknown-field rejection and single-value EOF gate. Rejected bodies are never decoded into business inputs. Errors remain generic invalid_json without echoing names/values; no request payload logging added.

Focused race test PASS1.582s; final full `go test -race ./internal/exchangeproduct -count=1` PASS13.959s including depth-bound fixture. Actual HTTP test uses isolated legacy test authorization (not current Web v2 write approval): two ambiguous intents400, no support records; subsequent unambiguous same-key request201 with one record. Existing optional PostgreSQL tests are not claimed executed by this suite without their explicit isolated DB environment. New HTTP tests do not permit Web read proofs to write.

## Independent public GET readback (no account/proof/sign/write)

Finance15:03:43Z `/version` and `/health`: both502, empty body SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855. Central remains responsible for its formal recovery.

Do not confuse Exchange/Quant root aliases with their correct API metadata routes: Exchange root `/version`,`/health` return SPA HTML15995B SHA e19bfb7281f35515b5d5648f893803af94ea3a0c64ed46d766f3495a8e7b63ab; Quant root aliases404. Correct routes are healthy:

- Exchange `/api/version`,15:09:28.077Z:200 JSON107B SHA b4c022607d648d184914ec7e9041fc4e7c5c2ce5fcc13392f18350bfc2a6d8a8, source91c1a40587d28ad4c931d4a4d601766bd467ea20.
- Exchange `/api/health`,15:09:28.215Z:200 JSON307B SHA9d16623ea43cc49bd257b1043c14bd1f1cd1d68a8df4b8e754a1ff2c5dbdc7de, same source.
- Quant `/api/version`,15:09:30.818Z:200 JSON274B SHA f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df, source664b80b00ac576317524f25b49fc01d1c0db7196.
- Quant `/api/health`,15:09:30.956Z:200 JSON462B SHA9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb, same source.

These are observed metadata/body hashes only, not proof that latest owner source is deployed or that provider/private account/business operations pass. No real account, Wallet approval, signature, transaction or remote mutation was requested. The designated coherent release owner must integrate ordinary hunks and deliver source-bound public/native evidence separately.
