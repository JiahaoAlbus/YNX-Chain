# Quant public introduction design QA

final result: passed

Scope: local public-entry design and original-workspace navigation, not public
deployment, installed-wallet approval or live trading. Selected source visual:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/codex-clipboard-012bbb40-962b-47a8-b3f7-971458805826.png`
2354×1690 pixels including browser/video chrome.

Implementation captures:
`/var/folders/nd/ks11whcs64b4nsy5xpjvj7540000gn/T/ynx-quant-introduction-gIxtA6/intro-1440-en.png`
and `intro-390-zh-CN.png` in the same directory. CSS viewports 1440/390×1000,
density 1, full-page pixels 1440×2043 and 390×2567. All three reference/desktop/
mobile images were opened in one comparison input. Unequal page crops and source
browser/video chrome are not treated as pixel-fidelity findings.

Findings: no remaining actionable P0/P1/P2 in the introduction.

- Typography: 44px desktop/34px mobile hero, Arial/Helvetica fallback, 16px body;
  English/Chinese wrapping and secondary captions remain readable.
- Layout: proportionate original logo, horizontal desktop nav, left value copy
  with explicit CTA, right actual product image, pale hero and spaced next section;
  stacked mobile keeps controls reachable with no horizontal clipping.
- Color: Klein-blue #002fa7, white header, pale-blue hero, dark copy and distinct
  focus outlines; no fake illustration or decorative financial graph.
- Images: original YNX logo unchanged; real 1440×1000 guest research capture
  identifies unavailable service and no strategy result. Not a synthetic profit
  chart. Small product overview intentionally links to full live workspace.
- Copy: market provenance, cost/benchmark/drawdown/Sharpe, saved workspace and
  Paper permissions, no live capital or promised returns. Finance/Exchange links
  explain the existing category without creating another service.

Focused checks covered header brand/CTA, hero wrapping and mobile feature text;
these simple elements were legible in captures, no extra crop required. Existing
native installer claims were not added; catalog remains official link.

Interaction checks: 320/390/1440 en/zh-CN, same-tab CTA, existing Paper view,
app→introduction return/reload, root legacy hash, query-bearing return, Japanese
preference preservation, keyboard focus, no introduction SDK/API, no pageerror,
one tab and zero non-GET. Original app viewport overflow is also checked.

History: first business-unit gate failed because new handler used a bare global
addEventListener in isolated VM. Changed to existing window event contract with
guarded optional hash; no engine change. Runtime-asset unit loop incorrectly
applied app-only verifier to new intro dependencies; explicit separate app and
intro graphs now retain all negative digest/missing/duplicate checks. All 160
business/asset tests pass. First visual comparison had no P0/P1/P2 finding.

Remaining gates: complete source-bound runtime archive, actual archive browser,
A formal publication/readback, native packaging/runtime and real private/provider
or financial lifecycle. This report does not promote any of those gates.
