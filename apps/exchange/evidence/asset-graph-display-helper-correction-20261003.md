# Exchange asset inventory correction: preserve display preferences

Release owner independently identified the original `/ui-preferences.js` script at index.html line 84; the previous request incorrectly declared three page assets and its nine-file inventory omitted this existing helper. This correction supersedes that incomplete inventory, without changing formal pins, code, display behavior or the deployed runtime.

Fresh actual file readback: `apps/exchange/web/ui-preferences.js`, Git blob `bc9afab56074071d45d1d3f225364b37254b6c61`, 2241 bytes, SHA256 `5557ed0d8c0ea3bbf36c5aae73b4f17453ce346ee3910788d50af19997f15d45`. The request's retained reviewed Exchange source remains d1eae2232ba56e17bfe30e15f9be485d2808347b; subsequent Quant commits have not altered these Exchange assets.

Correct complete page set: styles.css, wallet-connect.js, app.js, ui-preferences.js. Complete module set: market-data.js, order-preview.js, private-session.js, locale.js. A must preserve the original helper and bind actual final bytes across PAGE4/MODULE4; not waive unknown assets or merely refresh three hashes. The machine inventory now contains ten source files.

Verification here is JSON parsing, 10/10 file byte/SHA equality, helper Git blob identity and diff checks only. No unchanged browser greens were rerun. No public version, formal release graph, Wallet approval, installation or transaction completion is inferred. The original incomplete request and report remain in Git history. Reported only to the designated continuation audit thread.
