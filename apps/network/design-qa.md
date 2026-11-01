# YNX Network client design QA

Scope: the user's supplied desktop/mobile light and dark designs implemented in the existing independent Network client. This is a client visual and interaction gate, separate from native App installation, publisher signing, public deployment, real-phone acceptance and chain finality.

## Actual sampled-homepage helper acceptance (2026-11-01)

The new compiled development helper, SHA256
`78d6064d17676eb1c3418c7c16c229df3c2ddfe883f59cf1ca6ea8aa7b1f74f9`,
served the exact current HTML, CSS, catalog and controller assets: all six served
asset digests matched the recorded source snapshot. This was a standalone helper
with a new private external data directory and normal browser pairing; no asset
overlay, business-model injection, packaged App, GUI or production approval was
used. The original browser closed, the original helper received SIGTERM and its
original Wait completed with exit 0 and empty stderr. Existing Apps and services
were not touched.

Evidence is in `ui-visible-20261101/homepage-live/HOMEPAGE_LIVE_RESULT.json`.
The unmodified UTF-8 bodies are saved separately as `raw-node-report-01.json`
and `raw-node-report-02.json`; the first observed browser projection is
`ACTUAL_CLIENT_MODEL.json`. The initial actual RPC_ONLY report had height
2,069,350, four blocks, 4/4 reported validators and three continuous intervals,
with a displayed average of 9.727 seconds. The RPC transaction lists were not
provided, so transaction counts and sample TPS remained unavailable (`—`),
without invented transactions or zero TPS. The detail button opened the actual
first block; its height/hash/parent/time/proposer matched the actual projection.
Raw detail values retained LTR isolation in Arabic RTL.

Seventeen PNGs include four desktop/mobile light/dark overviews, mobile lower
sections, Arabic and German variants, a selected block detail, actual in-flight
loading and a controlled single-request transport failure. Forty-eight scoped
new-homepage locale/theme/viewport states have zero horizontal overflow, tested
label clips or body/theme mismatches. No browser page error occurred. The only
console error was the expected ERR_FAILED from that explicitly aborted browser
request; the real RPC was not claimed to be down. Loading and failure cleared
all current metrics to `—`; a normal retry restored actual height 2,069,351 and
a 9.79-second interval. All twelve locales pass the current visible-message
coverage target. No old 360-state/global or Native/WASM/cryptographic suites were
rerun.

Visual inspection of all four primary variants, mobile report-time/TPS/RTT,
German expansion, Arabic RTL and the selected real detail accepted the new
Klein-blue/white and complete dark presentation. One controller lifecycle issue
was found and reported to its parent owner: an already-open block detail retained
old block values after the next request cleared the current report or failed.
The original failure screenshot `live-desktop-light-transport-unavailable.png`
is preserved; this pass does not label that stale-detail behavior accepted. Its
controller repair and targeted closure belong to the matching successor record.

This validates the scoped live browser presentation/data-binding observations
only. A unified normal App package, installation, native GUI delta, real phone,
independent chain proof and production publisher/authority remain separate gates.

## New sampled-homepage catalog and source layout (2026-11-01)

Parent added the homepage's average block interval, recent block window, block
details, recent transactions, report receive time, RPC sample TPS/round-trip time
and loading/partial/stale/error states. Its HTML/controller/helper ownership is
separate from this presentation pass. Eighteen new visible-message keys now have
explicit translations in all twelve approved locales. Parameter names match in
every translation; hashes, protocol codes, raw reports and numeric data remain
literal parameters. Only catalog rows were appended to `i18n.js`; its engine
after `CATALOG_END` is byte-identical to the 7ba engine. The visible-message
coverage and literal-data interpolation target tests pass. The first missing-key
failure is retained in `klein-blue/new-home-i18n-first.tap`.

Homepage CSS adapts the new six-column block table on mobile, keeps the details
button alongside height/hash with the time on a second line, and isolates raw
block/hash/parent/time values as LTR. Recent transaction rows no longer inherit
the unrelated six-column history layout. Title/caption text can wrap. Mobile
metric provenance notes and the receive-time/TPS/RTT sections remain visible;
their old hidden-mobile rule no longer obscures the new fields. Missing values
are still rendered by the unchanged controller and are never filled by CSS.

The scoped source-DOM fixture is
`ui-visible-20261101/klein-blue/new-home/dom-complete/SOURCE_DOM_RESULT.json`.
It uses the exact HTML/CSS/catalog snapshot, without controllers, helper, network,
App or business-model injection. All 48 viewport/theme/locale states pass width,
label and visibility checks; interval/TPS/RTT remain `—` in every unpaired state.
Thirty-six top/bottom/detail PNGs cover Chinese, Arabic and German examples;
the top captures start at scrollY 0. Focused details still contain only the
unprovided `—` values. The browser closed normally. Earlier source-only attempts
remain in `new-home/`; their viewport scroll carry-over was corrected before
accepting the final top-view captures.

This source layout and catalog preparation is verified. It preceded the actual
standalone helper acceptance recorded above; it does not independently prove
four-block data, positive details or sampled metrics. No recent transaction
navigation was claimed because the actual RPC supplied no transaction lists.
The previous global 360-state Klein check is reused for unaffected pages. Parent
retains the unified native GUI/package gate.

## Klein blue visual module (2026-11-01)

The user's newer visual direction takes priority over the original PDF colors:
default light mode is Klein blue `#002FA7` on white. The original desktop/mobile
page structure remains the layout reference. Dark mode covers every page with
`#0C131E` body, `#111D2D` control surfaces and readable blue emphasis; primary
actions retain Klein blue. Existing business IDs, content, models, grants and
actions are unchanged.

Metric cards are now one divided data band. Content containers become flat
sections with fine dividers, small control radii and no card shadows. The sidebar,
tables, ordinary-node observations, participation, resource status, history,
settings and mobile menus share this restrained treatment. Resource quotas,
missing proofs and Wallet/Source unavailability remain explicit. The palette
does not turn an RPC response, native self-check or zero worker count into a
successful grant. The existing German label wrapping fix is retained.

Evidence: `ui-visible-20261101/klein-blue/KLEIN_VISUAL_RESULT.json` records
30 route/theme captures: all seven desktop pages and all five mobile roots plus
history, participation and settings subpages, in both themes. The global change
was checked across all twelve locales on these pages: 360 states, zero horizontal
page overflows, zero tested label clips, zero body/theme mismatches and no browser
page errors. The run used the actual 7ba package's normal isolated
`START.command --headless`, normal pairing and actual fixed Testnet RPC reads.
Only the stylesheet response was replaced with the recorded CSS source snapshot;
there was no mock data, HTML/controller override or native GUI. Source remained
not admitted, contribution disabled and rewards unauthorized. The
original browser closed and original App process completed Wait/exit 0.

Visual review used the four full-size overview variants, desktop light/dark
route sheets, mobile root/subpage light/dark sheets, Arabic settings/resources,
and focused German Source-row captures. All source screenshot hashes are in the
raw report. White/light and dark variants were checked separately; no device or
browser frame was counted as application content. Viewports and full-view PNG dimensions
are 1440 x 900 desktop and 390 x 844 mobile at deviceScaleFactor 1. Additional
bottom captures preserve below-fold content without treating it as first-screen
content. Primary/muted text contrast ratios against the body are 15.80/6.04 in
light and 16.25/9.04 in dark; white primary-action text on Klein blue is 10.69.
The original logo and pinned icon assets remain crisp; no replacement image,
gradient, glow or decorative illustration was introduced.

Two P2 findings were fixed during that same review: the mobile clipboard button
inherited a grid area which placed it over the proof-import row, and mobile
account menu buttons acquired unwanted full rectangular borders. Resetting only
the clipboard grid area restores it inside the input; menu rows now have only
bottom separators. No DOM or event-handler change was needed. The affected
mobile verify/account views and four final overview variants were captured with
the final CSS, in
`ui-visible-20261101/klein-blue/final/KLEIN_VISUAL_RESULT.json`: 96 locale/page/theme
states pass the same layout checks plus clipboard containment and menu-border
checks. The final Arabic and German views were inspected. Earlier screenshots
retain the two findings; corrected images are not substituted into the first raw
record. All second-run handles also closed normally with Wait/exit 0.

The final four preview files are
`klein-blue/final/klein-{desktop,mobile}-{light,dark}-overview.png`; four matching
`comparison-klein-*.png` files show the preceding actual 7ba client beside the new
CSS at the same viewport and paired RPC_ONLY state. Actual live heights differ
between collection times. `klein-blue/KLEIN_REVIEW.md` links the complete route
and focused evidence. This CSS overlay is not a successor package or an
installation; parent owns the unified source/package, matching theme-color meta,
new homepage business fields and exact native GUI delivery. No old Native, WASM
or cryptographic suites were rerun, and the user's running App was not touched.

Final result for this CSS/browser presentation gate: passed. New normal native
package/install/GUI, real-phone behavior and production authorization remain
separate gates. Historical visual and native records below retain their exact
candidate scope.

## Earlier 7ba presentation delta (2026-11-01)

The existing seven desktop destinations, five mobile roots and their subpages,
light/dark styling, twelve locales and Arabic RTL remain implemented. This pass
continues that client; it does not replace the design or treat it as an unbuilt
PDF handoff. Historical checks below retain their original source/candidate scope.

Current capture source: `7ba74a97ea00969a16f6103c7deda3d494b23d6c`.
The exact package's `START.command --headless` was used with an isolated private
QA directory and HeadlessChrome 134. It paired through the normal client, read
the fixed Testnet source and then captured eight PNGs. The actual source returned
`RPC_ONLY`, reported status/latestBlock/validators, height 2,068,981 and four
validators. Native resource status remained `DISABLED` with zero workers and
`NOT_AUTHORIZED` rewards; Source was `NOT_ADMITTED` with first cause
`NETWORK_RESOURCE_NATIVE_71`, not a usable production grant. No business model
or successful authorization was inserted for screenshots.

Evidence directory:
`/Volumes/西部数据/YNX-large-work/coordination-v5-20261031/owners/P09/artifacts/ui-visible-20261101/`.
`CAPTURE_7BA_RESULT.json` records the package, screenshot hashes, actual reports,
48 new Source-row locale/viewport/theme measurements, empty console errors and
the original process's normal Wait/exit 0. Its browser was closed. The old
FB18145/helper18153 pair was not stopped, migrated or altered.

The original four PDFs still match `design-source-manifest.json` byte counts and
SHA-256. Their existing 24 rendered pages were visually reviewed in four source
contact sheets; the eight new captures were each inspected at full image size.
The four overview variants preserve the original navigation/card structure,
light/dark palette, icons and responsive bottom navigation. Actual single-block
content, absent metrics, live validator names and longer provenance text account
for visible content/height differences. Arabic resource layout mirrors columns
and navigation while protocol codes retain their original bytes. French resource
copy wraps within its cards. None of those differences is filled with PDF sample
heights, Mainnet state, stake, task progress or Wallet approval.

| Supplied surface | Existing implementation | Fresh 7ba image evidence in this pass |
| --- | --- | --- |
| Desktop pages 1 / mobile page 1: overview | Implemented in both themes | `current-{desktop,mobile}-{light,dark}.png`, actual Testnet reports |
| Desktop page 2 / mobile page 2: transaction verification | Implemented; separate report/header/inclusion/state and funds boundaries | Prior design/flow evidence retained; not freshly captured on 7ba here |
| Desktop page 3: history; mobile account history subpage | Implemented with immutable receipt lookup | Prior route/history evidence retained; not freshly captured on 7ba here |
| Desktop page 4 / mobile page 4: ordinary node | Implemented with actual unavailable/owned-process observations | Prior native/status evidence retained; not freshly captured on 7ba here |
| Desktop page 5: staking/governance; mobile account subpage | Implemented; Wallet and production approval remain separate | Prior route/native evidence retained; not freshly captured on 7ba here |
| Desktop page 6 / mobile page 3: resources | Implemented, with the new actual Source status row | `current-{desktop,mobile}-resource-ar-dark.png` and `current-{desktop,mobile}-resource-fr-light.png` |
| Desktop page 7: settings / mobile page 5: account and settings subpage | Implemented, including language/theme preferences | Prior settings/export evidence retained; not freshly captured on 7ba here |

The live mobile resource PNGs cover the top viewport; their Source row is below
the fold. Its live 48-state result is a DOM measurement, while the four focused
German card PNGs below are explicitly offline CSS fixtures.

One new local text defect was measured: German
`Quelle der Aufgabenautorisierung` exceeded the label column by 9 px in desktop
and mobile, in each theme (120/129 and 110/119 client/scroll widths). The only
source styling change is `min-width:0; overflow-wrap:anywhere` on `.info-list dt`.
It retains both text and column widths; there is no clipping, ellipsis or state
change. The four affected cases were reproduced against the original CSS and
checked against the new CSS in an offline exact-HTML/i18n fixture. Label scroll
widths now equal 120 and 110 px; all text rectangles remain inside their own
column, the neighboring status is unchanged, and page width remains 1440/390.
All four resulting card images were inspected. Evidence:
`SOURCE_ROW_DE_CSS_RESULT_FINAL.json`, `source-row-de-*-after.png` and the scoped
`source-row-de-regression.mjs`. This is a CSS-source regression, not a newly built
or installed App test. The initial harness API mismatch and normal browser close
are retained in `SOURCE_ROW_DE_CSS_RESULT.json` / `source-row-de-run.log`.

Current status: the observed German overflow is corrected and its four affected
source states pass. The 7ba package's four overview/eight total screenshots and
48-state Source-row observations are reused; no full old matrix or old native
suite was rerun. The installed independent 7ba QA App is a separate copied
candidate. Its normal GUI entry, the successor package containing this CSS delta,
real-phone behavior, publisher signing and production Source admission remain
separate gates; this record does not mark them complete. Parent owns the shared
GUI window and exact subsequent package/installation acceptance.

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

Original design gate result (d7 baseline): passed. Current candidate scope and
remaining native/package gates are recorded in the dated update above.

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

Export lifecycle follow-up: the original ddc Documents file eventually appeared
and was reconciled against the same receipt ID and public envelope,0600,
authority:false. Its prior UNKNOWN is preserved in the record history. The
successor adds explicit panel/saving/uncertain states in all12 languages,
three-entry duplicate protection, generation-safe completion and normal Quit
deferral until the approved write ends. Original CI's56 client cases and75
native contract assertions plus6 bootstrap contexts pass. Successor GUI
lifecycle observations must be recorded against its exact build separately.

Local activity integration: node/participation/resource screens now consume
actual helper self-status observations, with missing counters left unavailable.
Legacy status remains compatible. Eight new strict projection cases reject
forged authority, unsafe counters and sandbox promotion; the actual kernel IPC
and paired HTTP self-read flow plus65client cases passed the affected Go CI
-race target. Participation's six new read-only journal groups passed-race
with zero publisher/signature/lookup calls and unchanged journal bytes/inode.
The new native status UI delta remains pending the shared GUI window; current
Mac locked state is handled once by Root and is not retried here.
