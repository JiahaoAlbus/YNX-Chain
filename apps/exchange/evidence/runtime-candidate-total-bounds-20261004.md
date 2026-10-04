# Updated Exchange candidate: all owned credit boundaries

Source 79df602c5f9288dd903d12e59168b732dca83411; tree 464109cd9e341ab3cdd876259387fc0d10ab249e.

Archive `/tmp/ynx-exchange-total-bounds-79df602c5-linux-amd64.tar.gz`: 4481310 bytes, SHA256 fd6b70b94f7325c4e0a5cbcb50116b402f3b953a35fe897c52811e5fc5fcea98.
Binary 9617592 bytes, SHA256 3c0ba21d13b86d5c9044cdf78070fe9da6c70e64ccfda3162751a2aa2b079c58.

Focused race tests including sixteen concurrent exact replays, invalid ledger and valid exact-total boundary repeated three times PASS (1.932s). Earlier focused deposit/withdrawal tests race repeated three times PASS (2.177s). Full service/server tests PASS (9.301s/0.448s).

Actual new archive independent verifier PASS: 17 entries, source/tree/manifest/SHA256SUMS/modes, Linux amd64 binary and commit, fourteen exact Git Web files. Actual packaged Chrome at 390/1280 PASS: fourteen assets, Logo, English, official two-wallet no-provider fallback, stable URL/single tab, reload, unsent draft, zero page errors/non-GET requests.

This supersedes 8ef51d9f for next engineering publication; both include website UI but only this source includes additional test quote/withdrawal total bounds. No public deployment, user installation, Wallet grant/signature, live trading or broadcast is claimed. Existing publicly disabled execution gates unchanged.
