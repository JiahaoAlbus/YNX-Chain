# Bridge Status and Support

Status date: 2026-07-23.

`GET /bridge/status` is a public, credential-free machine status contract. It is served by the local coordinator package but is not evidence of a public deployment or an independent hosted status page.

The contract reports local coordinator state separately from external Bridge state. A healthy local process may report `coordinatorState=available-local-coordinator` while `externalBridgeState=unavailable`. Current provider connection is `not-connected`; external submission, user asset movement, official stablecoin route availability, and public deployment are false.

Reconciliation state is derived only from recorded operator references. It reports no observation, operator-observed balance, or operator-observed imbalance, and always keeps independent verification false. An imbalance is degraded evidence and is never converted into healthy provider status.

Current capability truth:

- Read-only evidence: enabled locally.
- Dispute recording: enabled locally.
- Quote execution, source submission, destination mint/release, refund execution, and emergency-exit execution: disabled.
- Support, privacy, security, and public status URLs: null and unconfigured.

Public deployment requires separately hosted Support, Privacy, Security, and Status URLs; incident ownership and escalation; provider outage communication; refund eligibility and SLA; Trust dispute/appeal routing; emergency-exit implementation where the route design permits it; remote monitoring; and source-bound public evidence. Until then, consumers must show unavailable rather than linking to an invented support or status destination.
