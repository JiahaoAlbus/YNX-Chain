# Finance / Exchange / Quant compact brand and adjustable text

Predecessor: `fb627797245e0bb7374ad527b5cda0a096b8ff8c`, branch
`codex/exchange-sso-cookie-binding-20261002`. Owner ordinary product UI only.
This is a tested local source delivery, **not** an official public/native release.

Original 798×420 YNX graphic remains unchanged, contained at 22px image height
with automatic ratio-derived width. The actual rendered blue graphic was inspected
in the local Chrome screenshots, not inferred only from CSS. Product brand remains
visible; clickable home links retain at least 44px height. No launcher, Dock,
installation icon, favicon, Wallet/MetaMask identity or authorization was changed.
Default body is 15px at a standard 16px browser base, product brand about 17.14px,
page/Finance welcome headings about 23.57px. Compact/Standard/Larger preferences
persist independently per product. Relative units respect browser default text
size and zoom; no text-scale disablement, clipping or browser font override exists.
Preference labels support the existing 12 languages; storage failure cannot
disable display controls or grant any account permission.

Actual headless local Chrome: 1440/390/320px; guest plus unauthenticated business
views; larger setting survives reload; Chinese/RTL at 200% text size; 22px logo,
44px setting controls, no document overflow or new tabs. 36 fresh screenshots
are retained here. APIs are deliberately unavailable: no successful account,
balances, transaction, Wallet approval or product-session outcome is fabricated.
Finance's old large welcome heading was caught by visual inspection and reduced.
Exchange's overflow came from absolute screen-reader text escaping the table
scroll container; its containing block and wrapping header were corrected without
disabling enlarged text or hiding the table. Earlier failures remain diagnostic
history, not passing evidence.

Executed gates:

- Brand sizing + actual Exchange owned-controls + Quant browser: 22/22 PASS,
  46.979s. After the final Finance welcome-heading reduction, the full three-product
  sizing matrix reran 3/3 PASS, 5.479s.
- Finance 12-locales + real Exchange locale/browser controls: 20/20 PASS, 19.294s.
- Full existing Go race suites: quantlab PASS 2.916s, exchangeproduct PASS 10.259s,
  finance PASS 15.071s (before UI-only changes; no service source changed).
- All three preference scripts pass Node syntax; diff whitespace gate passes.

## Required A release integration

Include the new `/ui-preferences.js` in **each** product's final served/native
asset inventory and final compatible graph. Include Exchange `/locale.js` and
`/ynx-logo.png`; its inherited fixed candidate list misses them. Existing source
cache-verifier runs currently fail Exchange and Quant at styles.css content hash
mismatch. A exclusively owns coherent final bundle/cache/package binding: refresh
all HTML/import pins and verifier inventories together after merging exact owner
source. Do not bypass the gate or ship an incomplete legacy fixed-file archive.
Rebuild applicable real native packages through A; Web QA is not native install QA.
After official source-bound release, owner must personally repeat public/native
business, real account and recovery flows. No such release has been supplied yet.

Public-current-source/install/real Wallet/PS/ComputerControl/business acceptance
remain false. Issues and results go only to `接续测试网生态审计工作`
`01a094cc-0ba3-7901-bcd5-56fce8330c0d`.
