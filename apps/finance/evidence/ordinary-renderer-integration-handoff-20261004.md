# Finance ordinary renderer integration into the current release graph

This is an exact ordinary-page integration handoff, not a deployment or a replacement Wallet/Auth/authority graph.

Fresh GET of https://finance.ynxweb4.com/version returned HTTP 200 and source 17d2d6dd0f9e30c7639bb5ccdf919c4896280e6c, release root3-lifecycle-17d2d6dd0. Source fixes come from immutable owner e8bd1dca1c8276e6c15fa818a102e9a8bcb69311. The retained capsule has every exact before/after byte, individual SHA-256 and byte length. Generated canonical JSON is 8405 bytes, SHA-256 8590963e650fad6fb64c5f01de4ceab4544ff9ea0802bbe1604017b7b7ac72e1.

Only three ordinary ranges change:

1. Receipt renderer with its product HTTPS navigation validator: malformed status/items/rows cannot crash the page or become misleading empty records; unsafe dispute destinations are absent, not clickable.
2. Planning renderer with its record guard: missing sources are unavailable rather than empty; readable neighboring records remain; selected valid budget category survives refresh; null progress is safe; reminder frequency uses existing twelve-language labels.
3. Support renderer: malformed or unsafe source URLs produce unavailable cards instead of executable links.

No shared protocol, SSO restoration, Wallet picker, provider, Product Session, permission, endpoint authority, service or release configuration is replaced. Budget calculation helpers, localization file and dependencies already exist in the current release graph and remain unchanged.

Read-only compatibility proof against the unique release owner's current apps/finance/web/app.js in central-finite-go-family-20261002/YNX Chain: input SHA-256 6038c02a3e20d144f8f887d9f8cff9d4c91ae6541342496f9a8e0e0a0925e390, compatible true. Result is 96184 bytes, SHA-256 522f619ee76d1108a726612d582d7660b9813e92f96d1d7e6d94f7e72e2ca825. Zero writes to that worktree. A future unrelated release-owner change remains preserved; a change within a frozen ordinary range rejects before transformation rather than fuzzy-overwriting it.

Local commands, to be run from the fetched owner checkout:

```sh
node --test apps/finance/tests/ordinary-renderer-integration.test.mjs
node apps/finance/scripts/ordinary-renderer-integration.mjs --manifest
node apps/finance/scripts/ordinary-renderer-integration.mjs --target /absolute/release-owner/apps/finance/web/app.js
```

The last command is read-only and emits the validated candidate to stdout. The release owner should integrate these exact ordinary hunks into its own compatible graph, update its final app content pin through its normal build, and perform its existing release/rollback workflow. Do not replace the whole owner app.js or cherry-pick older mixed authority commits. Do not use this handoff as a Host lease.

Executed integration tests: exact source patches/every unrelated byte preserved; newer unrelated owner prefix preserved; missing/changed/duplicated ranges, helper collisions, second application and tampered capsule rejected; merged full app parses; actual installed Chrome renders the merged ordinary functions using malformed and valid sources, confirms safe links absent and valid category selection retained, zero network requests, zero page errors, one tab and URL unchanged. Initial integration suite 3/3 PASS (4425.849541 ms). This is controlled local integration evidence, not public private-account access, Wallet approval or installed-native acceptance.

Rollback before release is discard only the generated integration candidate. Runtime rollback remains the unique release owner's exact existing release and protected state contract. No SSH, production mutation, account request, signature or financial operation occurred here. Public release of the three ordinary repairs remains pending until the unique release owner actually integrates/builds/releases and the exact new public bytes are read back.
