# YNX Card Testnet Web/PWA public-release handoff

## Scope and immutable source

- Owner scope: `apps/card/**` only.
- Branch: `codex/p0-card-testnet-virtual-20260820-fix`.
- Web/PWA base commit: `17abbbc4` (`card: add deployable testnet web pwa`).
- Final Web cold-start and Web secure-storage commit: `8a403ba3` (`card: harden web pwa startup`).
- Vercel production deployment: `dpl_8NxK9gwDyirv7hQQwJkRZ68p7r5k`.
- Deployment inspect URL: `https://ynx-card-testnet-simulation-kozfb9wa3-jiahaoalbus-projects.vercel.app`.
- Stable fallback URL: `https://ynx-card-testnet-simulation.vercel.app/`.
- Canonical Card URL: `https://card.ynxweb4.com/`.
- Official entry: `https://www.ynxweb4.com/dapp/card`.

## Production deployment and HTTP evidence

All probes used HTTPS with TLS verification on 2026-08-21. `dpl_8NxK9gwDyirv7hQQwJkRZ68p7r5k` was `Ready` and its aliases include both the stable fallback URL and `card.ynxweb4.com`.

| Resource | HTTP | Bytes | SHA-256 | Content type |
| --- | ---: | ---: | --- | --- |
| Stable PWA `/` | 200 | 1505 | `721b2f2b3d6de647577c7b7e04605595cbe047b730ca47db97c4efa47de158aa` | `text/html` |
| Stable PWA manifest | 200 | 460 | `f3e634129abe79c5b81b7fc8dac3950e5cb21f1d1263b1938fcd06a58e2c686f` | `application/manifest+json` |
| Stable PWA Service Worker | 200 | 1107 | `549f30f4f7ee6cf3db9faacb94bf6149410491c6451ed28eaca3bdcec3d67c54` | `application/javascript` |
| Stable PWA registration script | 200 | 155 | `84ea008e2f39151047054362a9edfe52607716e38c36c46b847f441def81d8d2` | `application/javascript` |
| Official Card entry `/dapp/card` | 200 | 1018 | `b8106a7ff3c5396903dd506d09848a62361f43830af1a72405a1e6a20ad4218a` | `text/html` |
| Canonical Card URL after DNS cutover | 200 | 1505 | `721b2f2b3d6de647577c7b7e04605595cbe047b730ca47db97c4efa47de158aa` | `text/html` |

The official page's visible `Open` link targets `https://card.ynxweb4.com/`. A real browser click reached the canonical PWA and produced the Testnet guest preview with no browser log errors. No Website source was changed by this owner.

## DNS cutover and rollback

- The Vercel project already owned `card.ynxweb4.com`; the prior Vercel DNS record was `rec_2042d516b7718ac0458750e7`, `A card -> 43.153.202.237`.
- It was replaced under the same Vercel team with `rec_5d64288c64c995b528c3e511`, `A card -> 76.76.21.21`, the Vercel-required target.
- Vercel domain inspection no longer reports a DNS configuration warning, and HTTPS reads the new PWA bytes and hash above.
- This environment's `dig` resolver still reported `198.18.0.201` after the cutover. That resolver value is not used as successful cutover evidence; the TLS-verified canonical HTTPS response is the evidence.
- Rollback is not executed. If required, remove `rec_5d64288c64c995b528c3e511` and restore `A card -> 43.153.202.237`, then read back DNS, Vercel domain health, and canonical HTTPS bytes/hash. The fallback Vercel URL remains available during that operation.

## Reproducibility gates

Executed from `apps/card` after a clean dependency install:

```text
npm ci
npm test                 # 24 passed, 0 failed
npm run typecheck        # passed
npm run build:web        # passed, Expo Web export to dist-web
```

The deployed Web entry uses `SafeAreaProvider` for Web rendering. On Web, only locale and bounded simulation audit data may use browser storage; Card sessions and pending authorizations are not persisted in the browser. The PWA Service Worker caches only same-origin GET application-shell resources and excludes `/api/`.

## Browser-visible evidence

- Cold start at the stable URL: Testnet/Sandbox guest screen rendered, browser logs were empty.
- Guest preview: explicitly says no provider is configured and no spendable card exists. It displays no account, balance, PAN, CVV, PIN, or identity material.
- Wallet button: a real click without an installed EIP-1193 provider produced the visible alert `No EVM wallet detected`; it did not fabricate a connection.
- Desktop viewport `1440x900`: fresh guest preview rendered with empty browser logs.
- Mobile viewport `390x844`: fresh guest preview rendered with empty browser logs.
- Screenshot capture is **not available** in this browser runtime: the supported capture call returned `Unable to capture screenshot`. Accordingly, `desktopScreenshotCaptured=false` and `mobileScreenshotCaptured=false`; the viewport DOM and log evidence above must not be represented as captured images.

## Truth gates and remaining evidence

| Gate | Value | Evidence / reason |
| --- | --- | --- |
| Public HTTPS Web/PWA | true | Ready Vercel deployment and canonical HTTPS bytes/hash above. |
| Official visible entry reaches PWA | true | Official page `Open` link was clicked in a real browser and reached `https://card.ynxweb4.com/`. |
| Testnet simulation label | true | Guest UI and PWA metadata explicitly identify Testnet/Sandbox. |
| Standard EVM Wallet absent state | true | Browser click shows `No EVM wallet detected`. |
| Real browser wallet approve / reject / disconnect | false | No installed user wallet was available in this browser session. |
| Product Session v2 browser success | false | Web private Product Session remains optional/degraded; Card remains `migrated-v2=false`. |
| Installed/browser screenshot artifacts | false | Browser runtime cannot capture screenshots. |
| Live RPC / Card API connectivity | false | Guest preview deliberately does not create private Card API or RPC traffic. |
| Real YNXT Testnet top-up | false | No real Testnet transaction hash, confirmation evidence, or Card API acceptance exists. See `testnet-topup-chain-integration-blocker.md`. |
| Simulated authorization, capture, reversal, refund, idempotency, audit, recovery source behavior | true (source tests) | The 24-card test run covers these Testnet simulation flows; this is not a real payment claim. |
| Fiat funding, real PAN/CVV, banking/card-network clearing, real merchant settlement | false | Explicitly out of scope and not implemented. |
| Public release / central promotion | false | The official page remains `candidate incomplete`; no central control-plane state was modified. |

## Website-owner handoff

No Website source change is proposed while the official page already links to the canonical Card domain and that domain now resolves at HTTPS to the Ready PWA. If the Website Owner changes the entry in future, it must preserve the Testnet-only label and point only to `https://card.ynxweb4.com/` (canonical) or, during an incident, `https://ynx-card-testnet-simulation.vercel.app/` (stable fallback). It must not introduce claims of real cards, PAN/CVV, fiat, card-network clearing, or real merchant payments.
