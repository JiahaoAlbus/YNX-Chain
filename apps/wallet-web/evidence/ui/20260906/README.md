# Wallet Web UI — 2026-09-06

Scope: the existing Wallet Companion UI in `apps/wallet-web`, based on `f0512a73d3891dc75beabbf66d1ed7e9c9522ea0`. The canonical provider module, Wallet/Auth package, desktop clients and key custody are unchanged.

Implemented:

- White surfaces, Klein blue actions, quiet borders, system typography, explicit focus rings, logical spacing for RTL, enlarged text and dark theme support.
- Wallet choices are distinct. The detected installed wallet becomes the primary action; the download route remains available. Platform and package metadata are collapsed. The connection screen does not expose disconnected transaction controls.
- Connected transfer entry uses a plain decimal YNXT amount. Hex wei is an explicit opt-in; calldata and message signing remain available in separate disclosures.
- “Review request” validates without submitting. The review displays the exact sending account, wallet identity, recipient, network and decimal amount. A separate button requests confirmation in the wallet. Fees remain unknown here and are explicitly delegated to the wallet; no zero fee or finality is invented.
- Prepared requests are bound to provider object, wallet identity, account, chain and render epoch. Changed session state invalidates a prepared review. Late connection results cannot reinstate a changed session.
- PWA builds now embed the verified asset-set digest in the worker entry so UI asset changes produce a new worker entry. CUA first observed stale module bytes with an unchanged worker entry; after this fix, a reload loaded the new discovery marker and text. This is local update evidence, not an installed/public PWA release claim.

Validation:

- `npm ci`, `npm test`: 125 passed, 0 failed. New behavioral tests cover one wei, values beyond IEEE-754 precision, 18 decimal places, malformed/ambiguous decimals, uint256 limits, canonical hex, calldata and exact review/session matching.
- `npm run build`: PWA and unsigned Chromium/Firefox directories built.
- `build-integrity.json`: all 20 shell assets match their declared hashes; the added transaction module exists identically in all three variants; worker entry includes its asset-set digest. This record covers the pre-commit build; the frozen build receipt is generated in `dist/ui-freeze-receipt.json` after commit.
- CUA Chrome, actual local built PWA at `http://127.0.0.1:4194/`: 390 / 768 / 1280 × English / Simplified Chinese / Arabic. All nine captures were taken after `data-wallet-discovery=ready`; no horizontal overflow. `responsive.json` has exact measurements.
- The browser detected the user's installed MetaMask. No account approval was requested. No signing or transaction was attempted. Screenshots show discovered, disconnected state, not a proven connected E2E flow.
- Tab navigation reaches visible 3 px focus rings. Enter collapses and reopens the chooser while retaining trigger focus. Expanded Android package metadata remains within the viewport. `keyboard.json` records these checks.
- Arabic dark mode at 390 px and 125% text preserves layout and a visible light-blue focus ring. Browser viewport override was reset after QA.

Limits still open for the dedicated Wallet task: real connected form/review in an installed provider, approval/rejection through that provider, signed transaction and finality, OS-native install flows, screen-reader testing, and public installed-PWA update verification. These screenshots and tests do not close those gates.

Screenshots:

- `en-390.png`, `en-768.png`, `en-1280.png`
- `zh-CN-390.png`, `zh-CN-768.png`, `zh-CN-1280.png`
- `ar-390.png`, `ar-768.png`, `ar-1280.png`
- `zh-CN-390-keyboard-focus.png`, `ar-390-dark-large-focus.png`
- `zh-CN-390-installation-details.png`
