# Finance locale traceability recovery

Inherited checkpoint: dfdc5b78f69c9ee6c432195895ed75225904a724 / tree 619bf592a09f946a469c2b1858e8965806750c9a. Scope is ordinary Finance UI and direct tests only; no shared Wallet/Auth, protected authority, endpoint, Host or release changes.

The initial overview passed Explorer status into renderActivity, but the actual finance:localechange listener omitted it. Switching language removed verified indexed-record links from both overview and activity views. A real Chrome regression failed waiting for #activity-body a (45978.869959 ms). The minimal correction forwards the same portfolio.explorerStatus; URL/hash/source validation remains unchanged and unavailable or unsafe sources are not promoted.

The regression uses the actual locale module, actual selector change events across all supported locales, and the actual application listener and rendering functions (unrelated broker/Wallet renderers are isolated stubs). Both activity views retain the exact configured HTTPS Explorer link and escaped full reference, the source snapshot remains unchanged, requests remain zero, tabs remain one, and page errors remain zero. These are controlled local source tests, not public Explorer or Wallet approval evidence.

Verification: node --check apps/finance/web/app.js; node --test apps/finance/tests/{overview-source-browser,owned-read-controller,owned-save-controller,owned-save-browser,owned-ai-controller,owned-ai-browser,product-response-recovery}.test.mjs: 55/55 PASS, zero skips/failures, 59728.066916 ms; git diff --check. Formal frozen release pins are untouched.

Rollback: revert this Finance-only checkpoint normally, preserving inherited history. Compatible backend/frontend public publication and installed/real-provider/Product Session evidence remain unverified and belong to the current release-owner handoff. Exchange production write-producer dependency remains unresolved. Both gaps were sent only to 接续测试网生态审计工作 (01a094cc-0ba3-7901-bcd5-56fce8330c0d); they do not stop ordinary owned development.
