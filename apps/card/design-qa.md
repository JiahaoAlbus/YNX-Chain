# Card introduction QA

Source: /var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-012bbb40-962b-47a8-b3f7-971458805826.png
Implementation: apps/card/evidence/20261003-testnet-operations/introduction-4990de347-desktop-en.png, apps/card/evidence/20261003-testnet-operations/introduction-4990de347-desktop-1440-en.png, apps/card/evidence/20261003-testnet-operations/introduction-4990de347-mobile-390-en.png, apps/card/evidence/20261003-testnet-operations/introduction-4990de347-mobile-320-en.png
Source reference is a Social directional screenshot, not an exact Card mock. Its original 2354x1690 image was displayed at 1872x1344; Card initial desktop 1280 CSS px capture was compared together with it in the same tool input. Subsequent desktop 1440x1000 and mobile 390x844/320x800 layouts were opened and inspected. Full-page output excludes scrollbar width; no pixel-perfect claim is made.

## Findings
- P2: Chinese mode retains English navigation and boundary accessibility labels. Translate those labels before handoff. Visible body content switched correctly.
- P2: Intro-to-app and browser Back work, but a dedicated app-to-intro control remains absent. Add an owned public return entry without touching callbacks or API routes.
- P3: Heading weight is heavier and artwork wider than the Social reference. Original TEST card imagery intentionally replaces the unrelated phone illustration. Typography can be refined after entry flow is complete.

## Required surfaces
- Typography: Avenir Next / Helvetica Neue fallbacks, strong display hierarchy, readable body and focus outlines; heavier display weight noted above.
- Rhythm: white header, two-column pale hero, features and numbered journey. Mobile stacks sections with no observed horizontal overflow.
- Color: owned Klein Blue, white and neutral gray; semantic Testnet boundary is visible. Automated comprehensive contrast audit not performed.
- Assets: original proportional YNX PNG and original Card SVG, loaded successfully. Card art is explicitly illustrative; no issued-card claim.
- Copy: English default; explicit Chinese toggle and refresh persistence tested. Two ARIA labels still need localization. No funding/activation proof claimed.

Focused region: initial desktop screenshot showed header/hero/card at readable scale; layout and art were compared with reference in one image input. Mobile full-page capture was reviewed for stacking; fine text QA uses DOM and original-size screenshots rather than resized overview.

Interaction evidence: CTA same tab to existing root app, visible six-nav/registration entry, Back to introduction, explicit language change, reload and keyboard focus. Error console empty for recorded introduction/app sequence. No account/sign/send action.

Comparison history: first candidate only; no post-QA visual fix in this checkpoint.

## Follow-up comparison: 1089b32c6

- Earlier P2 localized-label gap: fixed all three named introduction labels (brand, navigation, Testnet boundary). Chinese DOM readback shows 产品介绍 / 介绍页导航 / 测试网边界; reload retained Chinese. English switching restores their original labels.
- Earlier P2 return-entry gap: existing App now renders an explicit localized same-tab /about/ link on Web. Actual mobile browser opened the app in Chinese and clicked 了解 YNX Card back to the introduction; no account/sign/send action. Native renderer tests confirm no marketing replacement or Web link.
- Source reference was opened together with revised complete desktop screenshot `evidence/20261003-testnet-operations/introduction-return-1089b32c6-intro-1440-en-full.png` in one comparison input. Original 2354x1690 reference is directional Social UI, not a pixel-identical Card spec. Revised image is 1425x2632, covering 1440 CSS width minus scrollbar. Body/fonts/spacing/colors/TEST artwork/content keep the previously reviewed direction. Card-specific content and wider original artwork are intentional. No actionable P0/P1/P2 visual difference found in this scoped introduction comparison; P3 heading-weight preference remains.
- Focused mobile return region: `evidence/20261003-testnet-operations/introduction-return-1089b32c6-app-390-zh.png`, 390x844, opened at readable scale. Link and existing Guest/navigation remain visible. Chinese introduction mobile screenshot retained separately. English desktop screenshot captured with fullPage=false was cropped by the IAB side panel; it is retained as an invalid capture and NOT used as desktop-layout evidence. The complete replacement above is authoritative.
- Browser sequence: explicit Chinese toggle → existing app/root source1089b32c6 → localized return link → /about/ → reload → Chinese retained → English restored. Introduction/app console errors0; actual desktop innerWidth1440 and document scrollWidth1425 (no horizontal overflow). Viewport override reset. Previous 320px layout remains unchanged; this follow-up did not repeat a 320px capture.
- Unit gates5/5, front/server types, exact Web build and envelope21/static parity18 passed. This is local UI QA, not formal Host, private Card business or Testnet funding acceptance.

final result: passed
