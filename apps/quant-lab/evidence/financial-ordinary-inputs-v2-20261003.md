# Financial ordinary inputs v2

This checkpoint freezes integration inputs, not a deployment, installer or completed product.

Reviewed source: cc2a7b203b0cfd4345690dc3f14e8d60b0d92dd1, tree d9c6d7c4629bc05aac7e04b5602c1dfa5371b03e. Manifest: apps/quant-lab/integration/financial-ordinary-publication-inputs-v2-20261003.json.

Executed locally: `node --test apps/quant-lab/tests/financial-ordinary-inputs-v2.test.mjs` passed 14/14; exact-source verifier passed 11/11 objects; `git diff --check` passed. Negative tests exercise wrong tree/blob/bytes/hash, duplicate/omitted/foreign/traversal paths, unsafe numeric bytes, promoted/empty truth, incorrect integration mode and removed compatibility fences.

Integrate only the listed ordinary hunks into the release owner's current coherent graph. Do not copy this inherited checkout or overwrite Wallet/SDK/SSO/grants/pins/Host authority. Preserve the base Quant storage/lifecycle writer fences and all pending/durable/audit data. Historical manifests stay unchanged; a changed working tree must not be accepted by waiving an old hash.

Rollback scope: reverse accepted ordinary hunks only, never reset shared authority or downgrade to incompatible storage writers. The nine referenced product evidence files record their own controlled local/browser tests and limitations.

Remaining release dependency: wallet_release_owner must integrate ordinary inputs and rebuild the formal source-bound runtime. Public multi-user PostgreSQL readiness, actual Wallet approval/callback/restoration/disconnect, real orders and installers require separate direct evidence. All deployment/public/installed/product-complete flags remain false. This checkpoint performs no account request, signature, transaction or production mutation.
