# YNX Developer public introduction QA — 2026-10-04

Source visual truth: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-012bbb40-962b-47a8-b3f7-971458805826.png`.
The explicit product brief is `ECOSYSTEM_MICROSITES_20261004.md` in the original coordination directory. It requests the same introduction-page composition adapted to IDE content, with actual screenshots and no automatic Wallet connection. It does not request Social copy, phone artwork, fake community content, or a production-ready claim.

Implementation: actual compiled frontend at `http://127.0.0.1:4198/`, opened and tested through the Codex in-app browser. Evidence folder: `apps/developer/.ynx-developer-candidates/public-site-evidence-20261004`.

## Visual evidence and normalization

Reference original: 2354 × 1690 pixels; original CSS viewport/density unknown. Final English desktop capture: 1857 × 2690 pixels, explicit CSS viewport 1872 × 960, with the 15-pixel native scrollbar excluded by screenshot capture. Final Chinese desktop capture is retained separately. Mobile captures use CSS viewports 390 × 844 and 320 × 800; captured page widths are 375 and 305 pixels respectively, again excluding the native scrollbar. Both languages are captured at both mobile widths.

`full-comparison.jpg` places reference and actual implementation in the same comparison image, each constrained to 936 pixels wide. `hero-comparison.jpg` places the reference header/hero and implementation header/hero together, excluding reference browser chrome. The actual workbench picture is a supplied, unedited screenshot, not a CSS drawing. Both combined images were opened and inspected; mobile320-zh was also opened as a full-page capture.

State: public introduction, without an account. No customer content, identities, usage numbers or invented testimonials. Social's vertical phone artwork is deliberately replaced by the real IDE's landscape workbench, and the hero height is adjusted to that landscape asset. The blue/white header, brand placement, paired actions, left text/right picture and lower informational sections preserve the selected structure. This is a product adaptation, not a claim of pixel-identical Social cloning.

## Findings and surfaces

- Typography: system sans-serif, 46px desktop display text, 18px lead, 15–16px body, 13px contextual notes; mobile display 36px. Title wraps to two lines. Clear weight/line-height hierarchy, no truncated main copy. Source family is not reliably identifiable from the screenshot; the existing platform sans-serif fallback is used, with no external font request.
- Spacing/layout: centered 1240px content frame, two-column desktop hero, one-column mobile; cards change from four to two to one column. Header, cards, footer, menus and both primary actions remain inside 320/390 CSS widths. DOM readback proves scroll width ≤ viewport width. The 320px actions stack and header typography adjusts. Reference video/browser chrome is not copied into the product.
- Color/tokens: white surfaces, pale blue hero, dark text, muted secondary copy and blue/white actions. Focus outlines remain visible. No invented image assets or decorative CSS artwork.
- Images: original proportional YNX logo is 798 × 420, displayed with object-fit containment. Actual local test workbench screenshot is 1280 × 720, unedited; sharpness is appropriate for the hero and the full image can be opened separately. Caption explicitly identifies the local test project.
- Content: IDE coding, actual terminal/Git/JS debugging, Testnet tools and reviewed AI context; provider and public availability are qualified. Native candidates are not linked as formal installers. Existing official catalog/help/ecosystem paths are used. Identity/signing/context privacy steps are described in Help.

## Comparison history and fixes

1. Initial source asset included a later test notification. Replaced it with the original actual paused-debug screenshot before the built-preview captures. The source image remains unedited.
2. Potential 320px Chinese header crowding was resolved with the narrow breakpoint's smaller brand/control typography and stacked hero actions. Both language captures and measured widths prove the result fits.
3. [P2 resolved] CTA entered the real existing projects component, but the preview's absent backend returned an empty body and showed a raw JSON parse error. `readWorkspaceResponse` now gives a clear unavailable-connection message, preserves HTTP status (including 401 retirement), and never invents a successful catalog. `projects-first-failure.jpg/.txt` and `projects-fixed.jpg` preserve before/after evidence. This is a source/UI repair, not evidence of a live backend connection.
4. The dev preview briefly recorded an existing HMR createRoot warning after a source edit. Final QA uses the compiled preview, which records no JavaScript console errors. Final screenshots are not attributed to the earlier dev state.

## Primary interactions checked

Desktop and mobile Chinese/English; language URL and document-language update; mobile menu opens/closes; Help anchor survives reload; FAQ expands; top anchor survives reload; keyboard Tab gives visible focus; explicit CTA enters `/projects?lang=zh`; application About link returns to introduction; browser back/forward and reload retain expected app/introduction state and language. Source tests cover historical projects/guest/native-tools/SSO/Wallet-callback/API/download/unknown-root inputs, and Native presentation bypass, separately from browser acceptance.

Final network readback: nine local document/script/style/image/favicon requests, no Fetch/XHR and no off-origin request while browsing the public introduction. Existing Wallet/AI application modules are lazy and not downloaded by this public route. Final in-app-browser console error readback is empty.

## Remaining scope

Formal Host publication, public readback, actual canonical projects/Wallet/Chain/AI journeys, Native installation and Windows/macOS OS acceptance remain separate. No runtime, credential, callback or Host permission is granted by a presentation marker. Desktop native behavior has source/entry-test evidence here; no device launch was performed. No external catalog installer was downloaded. Earlier Native packages retain their own source and do not contain this new web introduction.

## Implementation checklist

- Preserve existing app and Native entry selection.
- Pass source build and the six route/response tests.
- Preserve real browser interaction, screenshot, network and before/after failure evidence.
- Hand the exact source/build snapshot to the original Root/A publication channel.

P3 follow-up: optional tighter workbench caption spacing after product acceptance. No actionable P0/P1/P2 findings remain for this introduction-page build.

final result: passed
