# Accepted Wallet-owner server consumer

Source `a7dad7ec1bc7c06577978bdd5fea8dc9c7a248a9`, tree `acf17fed8866d00a3c0876ec51af020da0c9e506`.
Unchanged owner-delivered `product-session-server.mjs`: 131919 bytes, SHA256 `d456d7baff7a27eec840f4e8f4d853c4268b79027fa4451704823259d13bcc19`.
Unchanged registry: 7590 bytes, SHA256 `e74e1668e631dd623a4364cc9580951a9fe96fcef0c66c5910d84c774f4fdc08`.
The original manifest retains all 34 source inputs and hashes; no external runtime imports. Original bundle attribution/comments are retained. Card has not modified cryptography or Wallet protocol. Local files `registry.mjs` and declarations only load data and describe the consumed API subset.

`sharedWalletAuth.ts` consumes `ProductSessionServerAuthorizer` against the fixed canonical Gateway and fixed Card registry identity. `walletApproval.ts` consumes the distinct business-approval verifier from this same artifact. Session authentication alone never approves a Card application or credits a ledger. Platform metadata chooses only a preconfigured authorizer; the shared implementation checks the complete proof/session tuple and exact server route scopes.

This is exact source consumption, not evidence of a live session, installed Wallet approval, public backend acceptance or funding.
