# Wallet Web gitless build evidence — 2026-09-19

Source checkpoint: `b4ef73b876cfea2120129dad20e257046bdf8934`.

The release gate exported the committed `apps/wallet-web` subtree with `git archive`, verified that the deployment input contained no `.git`, ran `npm ci --no-audit --no-fund` and `npm run build`, and checked the emitted PWA build identity. It then changed one byte in each immutable build input independently and verified that both builds failed closed.

Reproduce from the exact source checkpoint:

```sh
git checkout b4ef73b876cfea2120129dad20e257046bdf8934
cd apps/wallet-web
npm run test:gitless-build
```

Verified boundaries:

- Vercel-style build without Git metadata: passed
- source commit binding: passed
- historical authority archive binding: passed, 14 records
- vendored address authority source/tree/blob binding: passed
- tampered authority archive rejected: passed
- tampered address authority rejected: passed
- Preview deployment executed: false
- production domain changed: false
- production signing or store publication: false

The raw command logs remain host-local under `/tmp/ynx-wallet-gitless-b4ef73b87`; this directory contains the compact durable result and exact build identity only.
