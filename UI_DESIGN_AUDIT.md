# Oracle Web/PWA Design Audit

## Product surface

`apps/oracle` is an independent anonymous, read-only Web/PWA with canonical
route `/oracle`. It probes only `NEXT_PUBLIC_ORACLE_API_BASE_URL`. With no
configured API it states that directly, disables live queries, and displays no
sample price, user, balance, liquidity, or success state.

## Interaction and accessibility checks

- Semantic header, main, sections, form, aside, footer, live error role, and a
  keyboard-visible skip link.
- Native labeled inputs/selects, visible focus, 42px controls, no pointer-only
  interaction, and disabled actions when no real endpoint exists.
- English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch,
  Português, Русский, العربية, and Bahasa Indonesia cover runtime status,
  errors, quality, consumer safety, and risk language. Arabic sets `dir=rtl`.
- Light, dark, and system themes; `prefers-reduced-motion`; system fonts; no
  external font or image tracking.
- Mobile rules collapse the grid and forms by 800px, then tighten controls at
  480px. The 390px target has no fixed-width content or required horizontal
  scroll.
- Install metadata and a network-first same-origin service worker provide the
  shell without caching cross-origin Oracle API values as authoritative data.

## Information and trust design

The first viewport leads with the claim boundary, endpoint state, last check,
version, and latency. A market value appears only after an explicit live query.
Source count, confidence, staleness, and breaker state remain adjacent to the
value. The consumer contract says that HTTP success is insufficient, and the
risk disclosure requires fail-closed behavior.

## Automated evidence

`npm --prefix apps/oracle run lint` and `npm --prefix apps/oracle test` pass.
The production server-render test asserts `/oracle`, metadata, manifest,
unconfigured state, no sample price, and absence of internal-public terms.

## Remaining external audit

Screen-reader passes (VoiceOver/NVDA), browser matrix, 200%/400% zoom,
color-contrast tooling, installed-PWA cold start, and real-endpoint error states
must be captured on the deployed URL. Until then, accessibility implementation
is local-tested, not independently certified.
