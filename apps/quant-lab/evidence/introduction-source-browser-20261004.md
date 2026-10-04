# Quant introduction source and regression

Inherited base `43383013721db281f25d5ef7bf84f151cf7de872`. Owner-only
`apps/quant-lab/**`; no Quant Engine, shared Wallet/SSO or Host mutation.
Public root is SDK/API-free, English default + Chinese, explicit same-tab
`/app#research`. `/index.html` remains original application without FileServer
redirect to introduction; root query and registered callbacks/APIs retain paths.
App hashes select an existing nav view only and grant no authority. Old app
controls, strategy parameters, pending UNKNOWN records and SDK bytes untouched.

Original logo and real guest screenshot (1440×1000, local service unavailable):
`web/quant-workspace-preview.png` SHA256
eba03f62b9327201d2effb38fca81b005b92029c6e3989728be813b4f1b60e1a.
No backtest run, account authorization, strategy order, signature or transaction
was performed for this introduction. Screenshot is explicitly local, not public.

Executed regression:

- Go internal/quantlab 1.768s and server 0.228s PASS.
- 160 original business + exact app/intro asset positive/negative tests PASS.
- Actual installed Chrome controlled-source browser across 320/390/1440 en/zh-CN
  PASS: introduction→existing research/Paper→return/reload, hash/query, preference,
  focus/overflow, SDK/API absent on intro, pageerrors zero, non-GET zero, one tab.
- App six-dependency hash graph and new four-dependency intro graph PASS.
- JavaScript syntax and git diff checks PASS.

Failures preserved: bare global addEventListener VM ReferenceError fixed by
window API; old asset test loop treated every new inventory file as an app index
dependency, fixed to explicit app graph while new intro negatives stay separate.
No loosened hash verification, no SDK rebuild, no changed engine behavior.

Design skill guided selected reference comparison and actual responsive captures;
see `design-qa.md`. Public/installed/real business completion remains unverified.
