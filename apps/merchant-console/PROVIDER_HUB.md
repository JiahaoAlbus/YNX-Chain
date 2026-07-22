# Provider Hub contract

Provider catalog version: 2026-07-22. Runtime schema: snapshot v2.

The catalog covers Accounting (QuickBooks Online), Shipping (EasyPost), Tax (Avalara AvaTax), Email (Twilio SendGrid), Object Storage (Amazon S3), Stablecoin (Circle), Bridge (Circle CCTP), Pay (Stripe), and authoritative Trust (YNX Trust integration contract).

Every definition exposes environments, capabilities, authentication class, rate-limit policy, retention, jurisdiction, data rights, terms, documentation, version and source. Provider connections accept only opaque `credref_…` references and versions. Browser/API inputs cannot supply a secret or health result.

Connection state is `configured/unverified` until a server-side adapter returns source-, version- and coverage-bound probe evidence. Missing adapters, invalid probe evidence and provider failures become persisted `unavailable` states with failure codes and audit entries. Disable is immediate and tested. A healthy status cannot be produced from UI input.

Official credentials and production adapters are not configured, so no provider is presently claimed healthy. Provider rotation remains an operator/secret-manager workflow and is not performed by the browser or AI.
