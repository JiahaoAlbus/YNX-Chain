# YNX Network client design QA

Scope: the user's supplied desktop/mobile light and dark designs implemented in the existing independent Network client. This is a client visual and interaction gate, separate from native App installation, publisher signing, public deployment, real-phone acceptance and chain finality.

## Visual truth and capture

Source PDFs (read-only; document examples do not grant permissions):

- `/Users/huangjiahao/Downloads/YNX Network · 电脑端（明色）.pdf` — seven 1440 × 900 pages.
- `/Users/huangjiahao/Downloads/YNX Network · 电脑端界面.pdf` — seven 1440 × 900 pages, dark.
- `/Users/huangjiahao/Downloads/YNX Network · 手机端（明色）.pdf` — five 390 × 844 pages.
- `/Users/huangjiahao/Downloads/YNX Network · 手机端界面.pdf` — five 390 × 844 pages, dark.

Source SHA256 and scope: `artifacts/design-20261101/design-source-manifest.json` under the original P09 coordination owner directory on the external volume. Every page was rendered at 72 dpi and reviewed; source screenshots are `desktop-{light,dark}-1..7.png` and `mobile-{light,dark}-1..5.png`.

Evidence base: `/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P09/artifacts/design-20261101/`.

Implementation captures: `final-desktop-light.png`, `final-desktop-dark.png` (1440 × 900 CSS/pixel viewport), `final-mobile-light.png`, `final-mobile-dark.png` (390 × 844 CSS/pixel viewport). IAB `devicePixelRatio=1`; source and implementation PNG dimensions were asserted equal. No browser/device frame was compared as app content.

Combined full-view comparisons: `comparison-desktop-light.jpg`, `comparison-desktop-dark.jpg`, `comparison-mobile-light.jpg`, `comparison-mobile-dark.jpg`. Each contains source and implementation in the same image. Focused typography/brand/navigation comparisons: `focus-sidebar-desktop-light.png` and `focus-sidebar-desktop-dark.png`. The mobile full-view comparisons remain readable at 1×; the desktop full views were supplemented by the focused sidebar crops and original full-size captures.

## State and intentional adaptations

The PDF uses illustrative Mainnet data. The user explicitly requested actual Testnet data and functional adjustments. Its demonstration heights, historical blocks, peer counts, stake, task progress, rewards, Wallet authorization and running ordinary node are not imported as application state.

The geometric comparisons use the disconnected client state, matching the reference viewport and theme while retaining honest empty data. The normal development helper was then paired in IAB and actually read the configured Testnet RPC: height 2,060,996, four reported validators, and one actual block. Average interval, peer count and latency remain unprovided; null transaction lists do not become zero. Validator bars derive from reported voting power, not a stake or consensus proof. The displayed source remains one fixed RPC and `RPC_ONLY`.

The main connection action pairs the actual local service. Wallet, signed ordinary-node installation/start, native governance submission and production resource execution remain disabled with their actual reasons. A functional clipboard action replaces the illustrative QR glyph. Arabic mirrors layout; raw reports, transaction IDs and canonical protocol labels retain their content. Small muted/semantic text contrast was strengthened while preserving the supplied color structure.

## Comparison history and fixes

1. Initial desktop source render: an extra standalone raw-report card pushed the lower dashboard below the reference frame. Moved the disclosure into the existing network-report card; final desktop captures retain the reference's 232 px sidebar, 32 px main inset, four metric cards, 398 px primary cards and lower two-card row.
2. Initial mobile render: viewport configuration had not reached a painted frame; DOM metrics confirmed 390 × 844 before accepting a new screenshot. No scaled desktop screenshot was accepted as mobile evidence.
3. Initial mobile metric footnotes increased card height and moved lower regions. Kept provenance in the source notice/captions, restored 88 px metric cards, and hid browser scrollbar tracks without disabling scrolling. Final mobile full-view comparisons align the major card boundaries and persistent five-entry navigation.
4. Verification form: restored full-width mobile proof import, moved clipboard access into the input row, and grouped the result heading/steps into one mobile card. Actual proof stages and execution/funds statements remain separate rather than showing the reference's example success.
5. History: six columns show actual saved time/hash/level/source/reason and original-record lookup; no example pass/fail rows are fabricated. Summary metadata is derived from immutable stored views and retains the same receipt ID across restart.
6. Long text/locales: desktop and mobile language matrices checked all twelve exact locales. Arabic reports `dir=rtl`; no horizontal page overflow was observed at the reference viewports. Seven desktop routes and five mobile roots plus history/governance/settings subroutes were exercised.

7. Exact d7 packaged-service browser check reproduced a manual history refresh which left its button disabled after completion. Central request begin/finish now repaints busy controls for history, native status and node reads. The first failing tests and real UI observation are preserved; 14 focused lifecycle cases and the final 52-case original client entry pass. The follow-up exact package browser confirmation is recorded separately in the owner artifacts.

Post-fix evidence is the four final captures, combined comparisons, `browser-language-desktop.json`, `browser-language-mobile.json`, `browser-desktop-routes.json`, `browser-mobile-routes.json`, and `final-mobile-arabic-settings.png`.

## Required fidelity surfaces

- Fonts/typography: system sans with native Chinese/Japanese/Korean/Arabic fallback, 20 px desktop title, compact card headings, monospaced hashes; focused comparison checked brand, baseline, navigation rhythm and truncation. Raw identifiers retain LTR direction.
- Spacing/layout: reference desktop and mobile dimensions, seven desktop destinations, five mobile destinations, card grids, radii, source disclosures, keyboard focus and persistent navigation checked. Narrow tablet widths use the mobile structure; medium desktop titles can truncate without hiding controls.
- Colors/tokens: source light/dark surfaces, accent, borders and semantic states reproduced; muted/warning/positive text contrast deliberately increased. Missing proofs do not receive green reached-state styling.
- Image/asset quality: original repository YNX brand PNG and pinned Font Awesome Free 6.7.2 SVG assets with license/provenance; no CSS/ASCII substitutes, generated placeholders, external icon/font scripts or rasterized app screens.
- Copy/content: Testnet, actual source collection status, historical authority limits, unavailable features, per-request evidence and all twelve locale catalogs checked. Original backend diagnostics remain recorded; common UI causes are localized without rewriting stored records.

## Interaction and console verification

Actual development helper → normal pairing → Testnet node reports → known historical transaction lookup → saved receipt → Arabic switch retaining the same transaction, receipt and `RPC_ONLY` → actual browser JSON download → original history lookup. Receipt `195cd5c301a3d2f4fe750477b4fd13179e517d6ffde5b96f106f6212e52fc0a2` remained historical and no proof step was green on readback. The downloaded envelope was parsed from disk and checked for `historical:true`, `authority:false`, funds/native-grant false and intact `reportText`. Evidence: `browser-download-verification.json`; original file is retained in Downloads.

IAB console checks returned no errors/warnings. The fixed source's proof collector returned `RPC_HTTP_ERROR`; the client kept `RPC_ONLY` rather than displaying inclusion, execution or funds success. This is a real unavailable-proof result, not a visual failure or a finality claim. One early observation wait expired before the completed node response; the following actual UI snapshot showed the source result. No data or success was inserted to satisfy that wait.

Automated acceptance: 52 current client/projection/i18n cases, original Node CI discovery through the helper Go target, the affected historical-store restart/integrity regression, and the separate 65-case native export/preferences contract plus actual bootstrap JavaScript checks. Native GUI/panel/restart acceptance is recorded separately against the exact subsequently built candidate, not inferred from these checks.

## Findings

No remaining actionable P0/P1/P2 visual or client-interaction differences within this gate. Deliberate Testnet, missing-data, authorization and accessibility adaptations are listed above. P3: minor platform font rasterization and secondary-sidebar-card height differ with actual content. These do not hide controls or change evidence meaning.

## Implementation checklist

- [x] Four supplied visual variants and actual responsive routes.
- [x] Twelve complete catalogs and Arabic RTL; no English fallback used as another locale.
- [x] Actual fixed-source reads and immutable historical receipt workflow.
- [x] Browser download validated from the resulting file; no export authority fabricated.
- [x] Native export/preferences owning code and non-GUI contract checks.
- [ ] Separate exact-candidate native Save panel, App restart and installation/release gates; do not infer these from browser or contract evidence.

final result: passed

Native follow-up (2026-11-01, exact 01426 candidate): actual CUA App pairing,
public Testnet RPC_ONLY query, SavePanel Cancel, eventual actual JSON save,
and dark/Arabic RTL restoration after normal Quit/relaunch passed. Fresh
helper port and unpaired state were observed. Saved envelope is historical,
non-authoritative, mode0600. Save exposed a real main-thread filesystem stall
(sample at QAExportWrite/open); three CUA observations timed out before the
original operation completed without retry. File I/O now runs on a background queue with one-write fencing; the affected
native contract passed69 assertions and6 bootstrap contexts, including real
asynchronous file bytes, main-thread completion and overlap rejection. These GUI results apply to01426; the successor's GUI
delta must be recorded separately. Evidence: owners/P09/artifacts/design-20261101/
native-01426-acceptance.json and native-save-timeout-sample.txt.
