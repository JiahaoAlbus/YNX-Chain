# YNX Finance 1.2.0 status matrix

| Capability | Implemented | Local verification | Central/public status |
|---|---:|---|---|
| Canonical Wallet request/callback/device proof | yes | shared package 21/21; gateway 2/2; mobile contract | registry/deploy/installed approval **not complete** |
| Scoped, revocable Finance bearer session | yes | exact introspection/revoke tests | production Gateway persistence not deployed |
| Real YNXT balance and owned activity | yes | Go source tests; remote Explorer health and public tx smoke | live source reachable; index lag 20,696 blocks at smoke time |
| Authorized Pay receipts and dispute URL | yes | filter/failure tests; remote Pay health | receipt request correctly 401 without operator key |
| Categories, private notes and classifications | yes | Go persistence/ownership tests | local candidate only |
| Budgets, progress and recurring reminders | yes | API/service tests; native flows | planning only; no payment execution |
| Statements, monthly review, CSV/JSON export/import | yes | amount/legal/coverage tests | not a bank/tax/legal statement |
| Privacy, account deletion, recovery and audit | yes | deletion/restart/audit tests | operator backup/restore runbook required at deployment |
| AI categorization, fee explanation, budget draft | yes | selected-record/consent/apply/reject tests | provider success not claimed; never auto-applies |
| 12 locales, Arabic RTL, amount/date/legal semantics | yes | 6 native tests including locale/RTL contracts | professional legal translation review remains a release gate |
| Android install and cold launch | yes | final release APK installed; cold 16,313 ms | local test signature only |
| iOS build/install/cold launch | target ready | Hermes bundle passed | CI Simulator pending; no device/IPA signature |
| Web feasibility | yes | desktop + 390 px Browser inspection | signed-out companion only; no Web Wallet client |
| Public/store release | no | n/a | `deployedPublic=false`, `storeReleased=false` |

Amounts are integer YNXT units returned by the current Testnet services; the product does not display invented fiat conversions, yields, custody balances, credit, cards or insurance.
