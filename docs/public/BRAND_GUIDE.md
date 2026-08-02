# YNX Chain Brand Guide

| Metadata | Value |
| --- | --- |
| Version | 1.0.0-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Public design and naming handoff; asset/legal review pending |

## Brand architecture

YNX Chain names the Layer-1 ecosystem. YNX Web4 names the application ecosystem.
YNXT names only the native Testnet asset. Individual products retain independent
identities and workflows; they are not features inside a super-app.

Use `YNX Chain` on first reference. `YNX` may be used afterward when unambiguous.
Use `YNX Web4`, with a space, in prose. `YNXWeb4` is an alternate compact search
and account identifier, not the preferred editorial form.

## Visual system

| Role | Value |
| --- | --- |
| Brand primary | Klein Blue `#002FA7` |
| Light background | White `#FFFFFF` |
| Dark background | Neutral near-black selected for accessible contrast |
| Body text | Neutral black/gray with WCAG-compliant contrast |
| Status colors | Semantic and restrained; never substitute color for text/icon |

Klein Blue is an accent and identity anchor, not a full-screen default. Layouts
favor clear hierarchy, spacing, precision and platform-appropriate interaction.
“Apple-grade” means disciplined usability and accessibility; it does not permit
copying Apple artwork, icons, layouts, wording or trade dress.

Avoid colorful tile walls, KPI-card walls, decorative gradients that obscure
content, and one repeated template across unrelated products.

## Logo and icon rules

The canonical source asset is `assets/brand/ynx-logo.png` in the source package.
Before public release, export reviewed light/dark and icon-size variants with
immutable digests. Preserve clear space, aspect ratio and legibility. Do not
stretch, recolor arbitrarily, place over low-contrast imagery or combine with
another organization’s mark to imply affiliation.

Product icons may use the common visual language but must communicate product
function independently. The chain logo must not make every application
indistinguishable.

## Voice

YNX writing is direct, precise, calm and evidence-linked. Lead with what a
component is, its current status and what evidence supports it. State failure,
unavailability and limits in the same visual hierarchy as successful states.

Prefer:

- “local Testnet candidate” over “revolutionary live network”;
- “records a non-executing intent” over “supports minting”;
- “operator-observed” over “verified” when independent proof is absent;
- “no represented monetary value” over vague investment language; and
- “requires review” over an implied partnership or approval.

## Product states

Every user-facing product needs genuine empty, loading, success, failure,
offline, permission-denied, expired and recovery states. Financial or chain
operations additionally require review, pending, committed, failed and unknown-
outcome states.

Never use a static success message, present a disabled control as active, or
invent balances, users, transactions, prices, revenue, returns, liquidity or
health state.

## Accessibility

- Keyboard operation and visible focus.
- Screen-reader names, roles, states and error relationships.
- Text and non-text contrast.
- Dynamic text without clipping.
- Reduced Motion and non-motion alternatives.
- Light and dark themes.
- 390px viewport without horizontal overflow.
- Dates, amounts and legal/risk language localized beyond navigation.
- Arabic uses true right-to-left layout, logical spacing and mirrored directional
  UI where semantically appropriate.

## Language set

English, 简体中文, 繁體中文, 日本語, 한국어, Español, Français, Deutsch,
Português, Русский, العربية and Bahasa Indonesia.

Translations must preserve `YNX Chain`, `YNX Web4`, `YNXWeb4`, `YNXT`, chain IDs,
evidence IDs and legal meaning. Human/professional review is required for legal,
financial, regulatory and safety-critical copy.

## Photography and illustration

Use original, licensed or clearly attributable assets. Do not use another
product’s protected UI as a hero image. Diagrams should identify candidate versus
active components and authoritative versus third-party data. Illustrations must
not imply a partnership, validator location, reserve, liquidity, user count or
market adoption that lacks evidence.

## Naming examples

Correct:

- YNX Chain Technical Whitepaper
- YNX Testnet Guide
- YNXT Tokenomics
- YNX Wallet
- YNX Explorer

Incorrect:

- YNXT Chain
- YNX Mainnet, unless a separately approved Mainnet release exists
- Lynx Chain
- Official USDC on YNX, without direct issuer evidence
- Guaranteed YNXT yield

## Asset release gate

Every public image or downloadable asset requires source/rights, version, SHA-256,
byte count, dimensions, color profile, intended use, accessibility alternative,
reviewer and release record. Screenshots must show actual release state and must
not expose personal data, secrets, internal endpoints or unverified success.

## Change log

- 1.0.0-candidate (2026-07-22): Established brand architecture, color and layout,
  logo/icon, voice, state, accessibility, localization, imagery, naming and asset
  release rules.
