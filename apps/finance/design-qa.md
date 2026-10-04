# Finance public introduction design QA

final result: passed

Scope: local source interface and entry interactions only. No public deployment,
installed wallet approval or personal financial operation is proved.

Source visual: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-012bbb40-962b-47a8-b3f7-971458805826.png`
(2354×1690 pixels, includes browser/video chrome; not a Finance pixel-clone).
Implementation: `/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-finance-introduction-xF1PEI/intro-1440-en.png`
and `intro-390-zh-CN.png` in the same directory. CSS viewport 1440/390×1000,
density 1; full-page images 1440×2045 and 390×2596. Reference and both captures
were opened together in the same comparison input. Compare content composition,
not reference browser/video chrome or unequal full-page crops.

Findings: no actionable P0/P1/P2 on the introduction. Intentionally adapted
Finance copy and real 1440×1000 guest screenshot replace Social phone artwork.
The screenshot contains no private records and clearly unavailable catalog;
caption identifies local Testnet/Sandbox state. No fake trading values or icons.

Required surfaces:

- Typography: Arial/Helvetica system fallback, 44px desktop and 34px mobile hero,
  16px body/18px desktop lead, readable Chinese wrapping; nav/footer secondary.
- Spacing: 1280px max content, 32px desktop/20px mobile margins, two-column hero
  becomes stacked on phones, no intersecting controls or horizontal clipping.
- Colors: original Klein-blue `#002fa7`, white header and pale blue hero; dark
  primary copy, muted secondary copy, solid CTA and clear focus outline.
- Images: original YNX PNG at contained aspect ratio, screenshot not stretched,
  no fabricated Social illustration or generated financial data. Product details
  are intentionally smaller in overview image; live app CTA provides full view.
- Copy: records/planning/research boundaries, no custody or promised yield;
  platform catalog is linked without claiming unpublished native installers.

Focused inspection: header logo, CTA, hero text wrapping and mobile feature cards
are readable in captures. No additional crop needed for these simple regions.
Keyboard focus, all three widths 320/390/1440, en/zh-CN, same-tab app CTA/return/
reload, query return, guest private-route gate and Japanese preference preservation
are covered by `tests/introduction-browser.mjs`; pageerror zero, one tab,
non-GET zero, introduction no SDK/API/SSO load. Controlled unavailable API is
explicitly a local fixture, not evidence that live services work.

History: initial capture test used nonexistent `#view-markets` selector and
failed timeout. Corrected to existing `#markets.active-view`; no product UI was
changed to satisfy that selector. First visual comparison found no P0/P1/P2.
Asset verifier separately found inherited stale Wallet/EVM hashes, missing
favicon and obsolete logo count; corrected exact references/inventory, not SDK.

Remaining delivery gates: complete immutable runtime package, A source-bound
public publication/readback, public UI, native install/runtime, real approved
provider and private-service/business lifecycle. This report does not promote them.
