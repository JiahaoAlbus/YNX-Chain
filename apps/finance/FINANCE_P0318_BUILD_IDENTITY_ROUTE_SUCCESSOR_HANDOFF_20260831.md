# Finance P0-318 build-identity route successor handoff

Finance only. This package does not authorize SSH, cleanup, deployment, service or Caddy mutation, account approval, signing, or transactions.

P0-318 failed closed at `CANDIDATE_VERIFY` and automatically restored the old runtime. The candidate archive already contained `web/build-identity.json`, but the Finance HTTP server did not register `/build-identity.json` in either its mux or web-file map. The signed gate required that URL to return the exact 219-byte identity, so the old candidate could never pass even when health, version and all seven preserved Standard Wallet frontend files were correct.

Commit `7d145955a05212921dc006abc2479dfc63bbcfa0` adds only the missing exact route plus a byte-exact Go HTTP test. The deterministic successor archive is frozen at `a7a0031a62478ddc6de7338fdea09bd801f1ace7`: 3,938,617 bytes, SHA-256 `f60f35037d1e8710b2b98979e42bcc0119a74b8cca1eea847310c9ac32412ef2`. A direct local cold start from the extracted archive returned all seven preserved Wallet assets unchanged, `/build-identity.json` as 200/219/SHA `e53ab41a...`, and `/wallet-connect.js` as the required 404/19 legacy absence.

The successor uses a new carrier namespace `finance-combined-7d145955a052-20260831t060048z` and a distinct deployment stage namespace ending in `-deploy`. It cannot reuse P0-314 or P0-318. Central must separately decide cleanup ordering for P0-318's retained executor and signed lease; this request grants them no cleanup or overwrite authority.

The next executable step is only a wholly-new Finance carrier-preparation lease after independent review and fresh zero-write production reads. A later Phase3 lease may be considered only after a direct terminal receipt binds the new carrier's archive and derived environment tuples. Final acceptance must include loopback and public health/version, all seven Wallet resources, the exact build identity, and the legacy WalletConnect 404 before success.
