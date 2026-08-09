# YNX Shop and Seller Console UI design audit

Audit date: 2026-07-18

Source commit: `38e2f68deb91d5f26e5aeec2318e260cd0742115`

## Outcome

The buyer surface now leads with product imagery, title, price, variant choice, and availability. The oversized blue marketing hero was removed. The Seller Console retains the existing sidebar and operational vocabulary, but replaces the KPI card wall with one restrained queue line, a catalog table, inventory controls, an order inspector/timeline, and role-aware actions. Both surfaces use the established YNX blue only for focus and primary actions; neutral surfaces carry the information hierarchy.

The audit was grounded in the repository's prior screens and existing system-font/YNX-blue visual language. The before/after comparison images are:

- `apps/shop/evidence/shop-before-after-desktop.jpg`
- `apps/seller-console/evidence/seller-before-after-desktop.jpg`

## Verified viewports and modes

| Surface | Evidence | Result |
| --- | --- | --- |
| Shop desktop light | `apps/shop/evidence/shop-desktop-light-1440x900.jpg` | 1440×900; product grid and generated fixture asset render without horizontal overflow |
| Shop desktop dark | `apps/shop/evidence/shop-desktop-dark-1440x900.jpg` | 1440×900; contrast and semantic hierarchy retained |
| Shop Arabic RTL mobile | `apps/shop/evidence/shop-mobile-arabic-rtl-390x844.jpg` | 390×844; `scrollWidth == clientWidth == 390`; core buyer chrome translated and mirrored |
| Seller desktop light | `apps/seller-console/evidence/seller-desktop-light-1440x900.jpg` | 1440×900; sidebar, queue, language controls, and toolbar fit without overflow |
| Seller Arabic RTL mobile | `apps/seller-console/evidence/seller-mobile-arabic-rtl-390x844.jpg` | 390×844; core console chrome translated and mirrored without overflow |

The deployed buyer staging surface was also opened in the in-app browser and saved as `apps/shop/evidence/shop-staging-desktop-720x450.jpg`. It showed the real empty catalog and truthful `Pay unavailable · Tax unavailable · Logistics unavailable · AI unavailable` state with no horizontal overflow. It is supplemental remote evidence; the exact-size 1440×900 acceptance image above remains the authoritative desktop layout capture.

The final desktop Seller capture used an exact 1440×900 browser emulation. Browser screenshot scaling was normalized through the tab's development protocol before saving; no page content was changed. Temporary viewport emulation was not retained as product behavior.

## Accessibility and state review

- Semantic landmarks, explicit search role, labels, status/live regions, dialog headings, focus-visible rings, and a skip link are present.
- Reduced-motion and increased-contrast media queries are implemented. Light/dark color schemes use system preference.
- Controls retain a minimum 42 px target in the Seller Console and mobile navigation remains reachable without horizontal page overflow.
- Arabic uses `dir=rtl`; all 12 audited locales are available independently from the AI output-language preference.
- Empty, loading, unavailable, payment-pending, manual-unverified shipment, refund-pending, and Trust-link states use text rather than fabricated metrics or decorative status colors.
- Product images include required alternative text. Missing media prevents publication instead of rendering a placeholder box.

## Product-specific findings closed

1. Removed the Shop's giant blue hero and replaced it with a compact product/truth header.
2. Added real raster product media, image-first catalog rows, variant/price/availability selection, and a detail dialog.
3. Removed Seller KPI cards and excessive bordered containers; the queue is now a single scannable line.
4. Added immutable product revision visibility, edit/unpublish controls, manual fulfillment labeling, and order timelines.
5. Fixed RTL/mobile header overflow and the off-screen skip-link overflow defect.
6. Kept tax, carrier, Pay, Wallet, Trust, and AI availability truthful; no fake sales, reviews, inventory, logistics, or merchants are displayed.

## Generated assets

Built-in ImageGen was used because no canonical raster assets existed:

- App icon prompt: a restrained deep Klein-blue square with a white abstract interlocking shopping-bag/chain mark, no text, no external logo, no gradient. Outputs: `apps/shop/icon-1024.png`, `icon-512.png`, and `icon-192.png`.
- Product fixture prompt: a realistic neutral-background field repair kit product photograph sized for an ecommerce catalog slot, with a compact black utility bag, metal bottle, flashlight, multitool, and cord. Output: `apps/shop/evidence/visual-fixture-field-kit.png`.

The fixture is explicitly identified in `apps/shop/evidence/visual-state.json` as visual-acceptance data, not a live merchant or sales claim.

## Remaining external visual acceptance

Authenticated seller tables and buyer checkout/order sheets cannot be captured against staging until the central Wallet product registrations are deployed. Their functional states are covered by HTTP integration tests and local API fixtures; this audit does not relabel those tests as live merchant acceptance.
