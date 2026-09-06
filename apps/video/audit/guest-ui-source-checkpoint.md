# Video guest UI audit checkpoint — capture unavailable, source reproductions only

Owner /root/creator_wallet_closure. Source checked: b41d037871a95116646186e635bcffff4a456f30; its actual served runtime remains b6af671d04a4230bb7a4052cee1ff21d2f5c9c51. This checkpoint does not change app.js, i18n.js, styles, manifests or any deployed/archive bytes.

## Browser boundary and audit limits

Read product-design audit, index, critical overrides, user-context and audit framework. user-context preflight via /usr/bin/python3 found no saved context. Default framework Python exited 137; OS Python completed normally.

CUA createBrowserTab("iab", "https://video.ynxweb4.com/", {visible:false}) returned exactly "Browser is not available: iab". CUA listBrowsers returned only Chrome profile 佳豪. Root explicitly prohibited Chrome/native/Android and confirmed that only root has the in-app browser capability. No other surface was used; no page screenshot, rendered DOM, playback completion or visual accessibility evidence was obtained in this slice. Root will capture the actual UI later.

The audit skill says: "If none of those can capture valid screenshots or control the flow, stop and report the blocker." Accordingly this is a source checkpoint, not a completed visual audit. Skill: /Users/huangjiahao/.codex/plugins/cache/openai-curated-remote/product-design/0.1.53/skills/audit/SKILL.md.

## Reproduced source/controller defects (unfixed at parent-requested checkpoint)

1. Deep-link close leaves the catalog uninitialized. app.js startup at linkedVideo opens the detail only; loadVideos occurs only for no video parameter or failure. Actual controller fixture opens the video, calls registered Close handler and observes player closed, media paused, but content aria-busy remains true and no catalog request occurs. Root visual route: https://video.ynxweb4.com/?video=vid_037cc8f97abd9a6dff7a4e74&lang=en → Close. Expected screenshot: catalog or useful return view, never indefinite skeleton.
2. Explicit URL language prevents subsequent language changes. i18n.js prefers query lang over storage, while select.onchange only writes storage and reloads the unchanged URL. Actual module fixtures start with lang=zh-CN and try each of 12 choices. Original zh-CN passes; the other 11 choices retain zh-CN. Root route: https://video.ynxweb4.com/?lang=zh-CN → choose ar → observe page language and URL; then choose en. Preserve video query/hash when this is repaired.
3. Late translation can replace a channel title with Discover. showChannel sets the channel name but leaves page-title data-i18n=discover. Actual controller fixture proves stale translation marker remains; i18n.apply iterates all data-i18n nodes. This affects the late-catalog response ordering; actual visible timing remains unverified. Root route: homepage → video → View channel; inspect heading, and if an observed slow translation request completes afterwards confirm channel heading remains the channel name. Do not simulate UI success from this source condition.

Known remaining translation coverage is broader: current catalog has 22 keys in 12 languages, while public HTML/controller still contain English Sign in/Open Wallet/Close/View channel/library and other labels. No claim of 12-language product completion or accessibility compliance is made.

## Retained reproducible fixtures

apps/video/audit/probes/guest-navigation.test.mjs executes shipped controller code with explicit DOM/network fixtures. apps/video/audit/probes/i18n-navigation.test.mjs executes shipped localization module with an explicit page/location fixture. Before-fix run: 14 tests, 1 pass, 13 expected defect failures (2 navigation/heading plus 11 language changes). No production network, Wallet requests, storage secrets or actual browser is used. These reproductions are deliberately not registered in npm check until the fixes are implemented. Logs: video-guest-navigation-source-repro.log beside this checkpoint and apps/video/audit/guest-navigation-before.log.

Run from the Video worktree:

```sh
node --test apps/video/audit/probes/guest-navigation.test.mjs apps/video/audit/probes/i18n-navigation.test.mjs
```

## Exact root capture queue

Use a separate in-app browser tab at 1365×900, then 390×844; no private account required.

1. English homepage: https://video.ynxweb4.com/?lang=en. Capture stable catalog and language/search/navigation controls; record actual b6af runtime identity separately.
2. Search by the visible self-owned test-video title, then submit an unmatched term; capture result and empty-state recovery, finally restore the matching result.
3. Open vid_037cc8f97abd9a6dff7a4e74 from its card. Capture player and controls. Click Play through real UI; capture observed media time progressing/ended and error state. Old 48fe ended evidence does not establish b6af playback.
4. View channel from player. Capture resulting channel heading/cards/focus. Reopen video and Close; record catalog return/focus without hidden modal or ongoing audio.
5. Repeat direct video URL then Close to confirm defect 1 visually.
6. At 390×844, repeat homepage/search/player/channel/Close in zh-CN, ar and en, recording horizontal overflow, overlapping or clipped controls, dialog reachability and keyboard focus. Arabic requires actual RTL rendering checks.
7. Starting with explicit lang=zh-CN, switch the locale selector to Arabic and English to confirm defect 2. Later verify the repaired candidate locally; do not redeploy without coordinator execution.

Each step requires a current screenshot or an explicit capture blocker. Root owns subsequent actual screenshots; this slice adds no screenshots. Whole 12-language, all-platform and full-product UI requirements remain open.

Parent requested immediate checkpoint and reassignment to Developer native Edit-menu integration before any Video runtime fixes. No new Video/Creator runtime has been written or deployed.
