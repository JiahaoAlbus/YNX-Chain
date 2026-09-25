# Wallet Web private Product Session v2 candidate checkpoint

Product source commit: `31f3ef16d3812870e0c3d23350565fd592482227` on `codex/wallet-web-private-v2-20260925`. The subsequent evidence-only commit records this checkpoint and browser receipts; it is not the ZIP build source. PR: `https://github.com/JiahaoAlbus/YNX-Chain/pull/211` (base PR 204 branch).

This is an unsigned local `0.1.3-testnet-preview.1` candidate. It is **not** the public download, installed extension, store release, production signature, live Wallet Gateway session, Finance/Card authorization, or provider response. No public URL, Vercel project, release tag or store listing was changed for this candidate.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `artifact-manifest.json` | see file | `e64fe77c0b4c28faaa33331e7e37896638696538a4d95f98d683bb2867f7f19a` |
| `ynx-wallet-web-pwa-0.1.3.zip` | 315715 | `478e155646f7e269e7b075666362b904b57ad949ae101c3d5319f48aca76d5eb` |
| `ynx-wallet-chrome-edge-0.1.3.zip` | 584777 | `5c6ff4c16805965aa86febdc6a9f7a812ea2d1e9c8fa556611dafeadfb2e707b` |
| `ynx-wallet-firefox-0.1.3.zip` | 584875 | `1e3d6403f98318745a44cc034439dedc1c6bf804f4afe8f552ae27bfc7485acf` |

Two complete `npm run package` runs from the exact product commit reproduced all four SHA-256 values byte-for-byte. Packaging ran all 380 source tests, rebuilt PWA/Chromium/Firefox and verified the three ZIPs. An independent `git archive` extraction to `/tmp/ynx-wallet-web-013-verify.zF2EyV`, fresh `npm ci`, and `npm run build` produced three output directories identical to clean ZIP extractions under `diff -qr`. The exact source passed `npm run test:gitless-build`; the built public download matrix passed in the clean extraction after including the repository's `apps/wallet/artifact-manifest.json`. `npm run test:public-artifacts` fetched all three currently public URLs and matched exact bytes and SHA-256.

Chrome for Testing and Microsoft Edge each loaded the **final candidate ZIP** in a disposable profile against an intercepted Card origin. Both fixture summaries under `apps/wallet-web/evidence/private-v2/candidate-31f3ef16d/` report `passed=true`, bilingual review, signed return, explicit rejection, replay refusal, stale-document cancellation, fresh retry, and account-replacement cancellation. Their `gatewayVerified=false` remains authoritative. Screenshots are local fixture evidence, not public product acceptance.

Public channel ledger deliberately remains mixed: PWA and Firefox `0.1.1` from `c93e16be81beddc957ef5f27b7bbcdfa89c28db3`; Chrome/Edge `0.1.2` from `40c2814d6e87e19ce2762737356c4f9d1128a69d`. The unchanged root `artifact-manifest.json` is a historical three-package `0.1.2` build receipt, not a claim that all three packages are public. Never copy this `0.1.3` candidate over a `0.1.2` name or mark Gateway/private business states as verified.

Recovery: retain this exact source commit, the four hashes above and the old public channel ledger. If the candidate is rejected, leave the public site/release untouched and revert only the candidate branch/PR; do not delete old public evidence or overwrite published downloads. Rebuild the candidate from product commit `31f3ef16d3812870e0c3d23350565fd592482227`, then compare all ZIP/manifest bytes before any later promotion. Store, website, shared Gateway and provider actions require separate owner authorization and direct evidence.
