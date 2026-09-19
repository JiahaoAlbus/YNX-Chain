# Wallet Web Vercel output evidence — 2026-09-19

Source checkpoint: `8ae417282bdeccbb546923c1ac1b46dbedf3dc8d`.

The gate exported the committed `apps/wallet-web` subtree without Git metadata and ran Vercel CLI 54.6.1 `vercel build` for the `wallet-web` Preview target. The root deployment contract selected `npm run build` and `dist/pwa`, producing the complete Wallet PWA under `.vercel/output/static`.

Verified results:

- Build Output API config version: 3
- static files: exact expected set of 25
- `build-identity.json`: present and bound to the source checkpoint
- integrity entries: 24, including the root alias
- authority archive SHA-256: `4a7eed2da6b1626cce94713a0d4420c56ebedef0d71ee39b7e2cd9bc6762ead7`
- Wallet address authority SHA-256: `df4bade31952f98602f51fbc9cbcb731bffe772da3d685b5be7ce895cb0e409f`
- no-store output routes: 4
- missing required module rejected: true
- Git metadata copied: false
- public static `vercel.json`: absent
- Preview deployment executed by this checkpoint: false
- production domain changed: false

Reproduce from the exact source checkpoint:

```sh
git checkout 8ae417282bdeccbb546923c1ac1b46dbedf3dc8d
cd apps/wallet-web
npm run test:vercel-output
```

The host-local raw log is `/tmp/ynx-wallet-vercel-output-final/vercel-output-gate.log`.
