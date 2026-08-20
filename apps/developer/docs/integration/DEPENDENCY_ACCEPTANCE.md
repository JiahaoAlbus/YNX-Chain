# Developer dependency acceptance

| Dependency | Exact accepted input | Current Developer state | Promotion boundary |
| --- | --- | --- | --- |
| Wallet/Auth Product Session v2 | source `203be5e108be468350591615a64d5d36ab87a8f1`; origin `https://wallet-auth.ynxweb4.com` | Root factory integrated; public mount probe passed | Native lifecycle evidence before `migratedV2=true` |
| DApp Connect SDK | accepted base `315897e75c0ffe3e63435fe73cfec42244b851cc`; PR #130 source candidate | Candidate is independently recorded but not consumed | Integration accepts an exact source checkpoint; no public/installed promotion from a draft |
| Chain Core | `ynx_6423-1`, EVM 6423 | Protected candidate Chain tools passed | Wallet-approved deployment receipt/Explorer verification |
| Website | `developer.ynxweb4.com` | Host TLS and health candidate passed | Independent browser visibility/version proof |
| Desktop signing | Developer ID / Authenticode | No signing input accepted | Immutable hosted current artifacts plus signing/cold-start evidence |

No npm-public claim is made for Wallet/Auth. No Dependency may be replaced with
a Developer-owned compatibility implementation.
