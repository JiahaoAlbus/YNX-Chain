# YNX Trust Center UI Design Audit

## Audit identity

- Product: `15 | YNX Trust Center`
- Source commit: `4d40557229b4232119026cb8c012db3bef2f1be9`
- Branch: `codex/final-trust-center`
- Audit date: `2026-07-29`
- Browser evidence: local Chromium through Playwright
- Public deployment evidence: absent

This audit covers the product-local Web UI. It does not claim a public `ynxweb4.com` deployment, manual assistive-technology certification, native mobile accessibility certification or a complete WCAG conformance assessment.

## Verified commands

```text
cd apps/trust-center
node --check tests/product.spec.js
npm run test:ui

cd ../..
go test ./apps/trust-center
./apps/trust-center/check.sh
```

Results:

- Playwright: `5 passed`
- Go UI/i18n contract package: pass
- Real local product smoke: `trust-center-check: ok`
- GitHub Actions workflow `trust-center`: run `30418987619`, success

## Responsive evidence

| View | Viewport | Result | Evidence | SHA-256 |
|---|---:|---|---|---|
| Desktop | 1440×1000 | pass; no document-level horizontal overflow | `docs/handoffs/evidence/trust-center-desktop.png` | `27f4af8040a22712c23b132a2a3cc2fe9afcc3709f011712666248e1b5373ea3` |
| Mobile | 390×844 | pass; no document-level horizontal overflow | `docs/handoffs/evidence/trust-center-mobile.png` | `6ab17c41b1b3637aadd7c797d761b8b5c5b2f3f728a21af9dc2896451d78838e` |

The fresh screenshots were byte-identical to the retained evidence, so the test run did not create a screenshot diff.

## Accessibility contracts

### Landmarks and status communication

- One visible `main` landmark is present.
- Product navigation exposes the accessible name `Trust Center sections`.
- The native-asset boundary is exposed as a `note`.
- Page loading and product messages use polite live status regions.
- The AI result is now a named polite status region: `role="status"`, `aria-live="polite"`, accessible name `AI explanation result`.

### Keyboard and focus

The browser-level focus sequence was verified at desktop and 390px mobile widths:

1. skip link;
2. locale selector;
3. AI-output-language selector;
4. Wallet sign-in button.

The locale selector receives a visible solid focus outline under keyboard navigation. The skip link becomes visible when focused.

### Accessible names

A browser-side scan covered links, buttons, non-hidden inputs, selects, textareas, summaries and non-negative `tabindex` elements. No unnamed interactive control was found.

This is a bounded semantic scan, not a replacement for a maintained accessibility engine or manual screen-reader review.

### Reduced motion

Playwright emulated `prefers-reduced-motion: reduce` and verified:

- the browser media query matches;
- the stylesheet contains the reduced-motion media rule;
- transitions and animations resolve to `0s` for the tested navigation control.

## Internationalization and RTL

The current browser suite iterated all 12 product locales:

- English
- 简体中文
- 繁體中文
- 日本語
- 한국어
- Español
- Français
- Deutsch
- Português
- Русский
- العربية
- Bahasa Indonesia

For every locale, the due-process/native-asset boundary remained non-empty and the document `lang` attribute matched the selected locale. Arabic set `dir="rtl"`; all other locales set `dir="ltr"`. Locale persistence remained correct after reload.

## User-state coverage

The UI suite verified:

- honest empty state with no synthetic cases;
- bounded evidence submission;
- submitted state;
- AI context selection and privacy preview;
- named AI result status region;
- provider-unavailable failure with no substituted answer;
- desktop and mobile responsive rendering.

## Findings closed in this slice

### UI-A11Y-001 — AI result had no accessible status identity

Before this slice, `#ai-result` was focusable but did not expose a role, live-region behavior or accessible name. It now exposes a named polite status region and the Playwright suite verifies the contract.

### UI-A11Y-002 — Accessibility test coverage was too shallow

The prior suite checked only the initial skip-link focus. The current suite adds full early focus order, visible focus styling, unnamed-control detection, reduced-motion behavior, `lang`/`dir` consistency and the AI live-region semantics.

## Remaining UI evidence gaps

- Manual VoiceOver, NVDA or equivalent screen-reader session.
- Maintained automated WCAG scanner such as axe-core.
- Measured color-contrast report.
- Native Android TalkBack and iOS VoiceOver execution.
- Public-route Web Vitals, real-device network behavior and production CSP evidence.
- Independent accessibility review.

These gaps prevent a claim of full accessibility certification but do not invalidate the verified local contracts above.
