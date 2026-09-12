# AI private Wallet SDK update

This update supersedes the 9840 private browser bundle and registry only.
It does not reidentify the immutable 170f8e1e deployment archive.

- SDK source: a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9
- SDK tree: acf17fed8866d00a3c0876ec51af020da0c9e506
- product-session-browser.mjs SHA256: 16b0d677ec21e84b5ce425138f175c37e1ac6d319db7fe5a85926b276dccd336
- product-session-registry.json SHA256: e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08
- Standard wallet bundle remains unchanged.

AI continues to import the browser client and Gateway fetch adapter from the
same private bundle. Its requested scopes and explicit Wallet approval boundary
are unchanged. Registry additions for other products do not authorize AI or
prove those products' write operations are enabled.

The SDK owner reports pending cold-restore nonce/state/expiry preservation,
fetch receiver correction, and proof input snapshots. Those reports are not
AI public runtime acceptance. AI already binds its supplied fetch function;
the shared receiver correction alone did not explain the AI public failure.

AI's separate CSP correction is source commit
6be39cf7bbd98b15f8fa50ca053800e0ea9b7cc9. It permits only the canonical Wallet
authority in addition to same-origin connections. Do not bypass authority time
validation or clear stored sessions to conceal a failed restore.

Deploy by rebuilding the AI client, which embeds these assets. Preserve the
18114 listener, active proxy mapping, state, keys, and model Gateway. A public
receipt must identify the actual new AI source and embedded asset hashes.
Repeat the real browser restore flow after deployment; successful authority
time transport is not successful login, callback, revocation, or generation.
Default provider recovery and BYOK generation require separate actual results.
