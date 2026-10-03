# Quant schedule stale-read boundary

Owner predecessor aa82393688f61243f2090501536a8067ac392805, tree 24f0f5c9a71a398b55f64cc6fb0327fe40bfae95. Ordinary Quant UI and tests only. No shared Wallet/Auth/SDK, authority, service, deployment or installer edits.

The existing schedule flow could start a new research schedule using a retained snapshot after workspace refresh failed. Start now requires available workspace read both before and after confirmation. Stale-read rendering disables start buttons, including after locale-driven rerenders. Confirmed stop remains available as a risk-reducing operation. Explicit successful refresh restores start availability; existing hash/assumption binding, uncertain-receipt fences and confirmation remain unchanged.

## Executed evidence

- Business/UI suites: 80/80 PASS, 1014.783625ms.
- Actual installed Chrome local controlled suite (`schedule|retains confirmed workspace`): 5/5 PASS, 8690.926667ms. New mobile case verifies fresh start available, failed read disables start but preserves stop through twelve locales, explicit stop confirmation yields exactly one controlled PUT with enabled=false, still-stale start remains disabled, explicit read recovery enables start, zero page errors and one tab. Retained cases cover pending rerenders, exact schedule receipts, impossible timestamps and uncertain-receipt recovery.
- App/browser/business Node syntax and git diff checks PASS.
- Initial focused test found the VM DOM harness did not model the newly used exact start-button selector. Added selector modeling from actual generated button attributes; focused cases then 2/2 PASS. Browser coverage independently verifies real DOM disabled state, not the VM model alone.

All snapshots and schedule PUT receipts above are controlled local fixtures. No real account request, signature, order or capital execution occurred. Public release, native installation, Wallet approval and Product Session lifecycle remain unproved; formal release is owned by the separate release owner. This checkpoint does not assert that all other stale workspace actions are already closed.
