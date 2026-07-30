# Testnet KPI Framework

Metrics are decision evidence, not growth theatre. No fake users, balances,
volume, leaderboard, urgency, or social proof is permitted.

| KPI | Definition | Initial decision use |
|---|---|---|
| Activation | unique consumer obtains `/version` then validates one safe `/prices` response within 24h | diagnose integration friction |
| 7/30-day retention | activated consumers with a validated read in day 7/30 windows | assess recurring utility |
| Task completion | safe reads accepted / explicit read attempts | separate data unavailability from UI failure |
| Crash-free session | Web sessions without uncaught error or worker failure | reliability guardrail |
| Support load | actionable tickets per 1,000 activated consumers and median resolution time | staffing/cost input |
| Abuse rate | blocked malformed/replay/rate-limit events per 10,000 requests | safety/ingress input |
| Provider cost | invoiced provider cost per million accepted reads | unit-economics input |
| Gross-margin candidate | service revenue minus all direct service costs | scale/kill input; never omit subsidies |
| Public Testnet usage | validated reads and distinct approved consumer IDs, excluding health bots | adoption evidence |
| Conversion | free-to-paid only after a real paid plan exists and explicit consent is recorded | no current target |

Scale requires 30 days of safe-source and SLO evidence, positive margin
candidate, manageable support, and no open severity-1 safety incident. Pause or
kill criteria are defined in `UNIT_ECONOMICS.md`. Analytics must minimize data,
publish retention, honor deletion where compatible with audit integrity, and
never treat wallet or chain identity as third-party analytics authority.
