# Exchange public introduction QA

final result: passed

Scope: local owned Web source and responsive public-entry composition only. Not public deployment, installed app or real wallet/account/business acceptance.

Source visual truth: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-012bbb40-962b-47a8-b3f7-971458805826.png` (2354×1690 including browser/video chrome). The user-selected layout is adapted to the real Exchange, not copied Social content, fake avatars, phone art or Connect-wallet marketing action.

Implementation: screenshots in `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-exchange-introduction-6R0KdR`, intro-1440-en.png, intro-1440-zh-Hans.png and 320/390 equivalents. Browser CSS viewport 1440/390/320×1000, density1, full-page captures. Source and implementation were opened together in one visual comparison; browser chrome/full-page height differ, so no pixel-exact reproduction claim. Compare proportional hero/nav/copy/image layout, not browser chrome. Mobile adaptation has no separate source mobile mock.

Typography: inherited ordinary Arial/Helvetica system typography, readable16px body,44px desktop headline and34px mobile; clear hierarchy and bilingual wrapping. Spacing: centered1280px container, generous hero whitespace, left copy/right actual interface, stacked narrow layout. Blue/white tokens preserve original #002FA7 branding and restrained pale background. No fake image, gradient art or inlineSVG. Logo is original PNG at natural aspect ratio; screenshot is actual local guest UI with absent market data, clearly captioned, not invented trade activity. Fine screenshot text is intentionally illustrative; the Open-web-app action opens the readable full workspace. Copy accurately says Testnet/not production, no promised return, no ZIP installer claim and private/standard access separate.

Interaction pass: real Chrome 320/390/1440 × English/Simplified Chinese; navigation/CTA/app/return/reload/language persistence/keyboard focus; no document overflow or console errors; intro makes no API or Wallet-SDK request; zero non-GETs/extra tabs. Existing Japanese app preference remains preserved when introduction defaults to English. Go route test covers explicit app, index.html, query and wallet callbacks without redirecting them to introduction.

Iteration history: first real browser run exposed same-document old-hash navigation not re-running the introduction redirect; hashchange handler fixed and rerun passed. Actual app view restore was absent despite retained #assets URL; allowlisted hash restore fixed, actual assets panel visibility now asserted. Async locale assertion was tightened to wait for real application locale initialization, not just wallet bundle presence. No visual P0/P1/P2 remained after desktop/mobile/bilingual inspection. P3: screenshot detail is small in the hero by design; full product remains available at explicit CTA.

Release boundary: runtime inventory now includes intro HTML/CSS/JS and original screenshot; graph hashes checked before packaging and on independent verification. Publisher A must deploy and verify actual public routes/headers/bytes. Mac ComputerControl remains unproved; this is authorized isolated Chrome QA.
