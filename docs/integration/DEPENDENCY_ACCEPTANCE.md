# YNX Social Dependency Acceptance

Source commit: `6ff91db0b7ce7509d1967e3936c7a0a85d45ea12`

| Dependency | Required evidence | State |
| --- | --- | --- |
| Wallet/Auth | exact product, client, bundle, device, scope, expiry and revoke | local adapter tested; central acceptance pending |
| Chat/Square | cryptographic lifecycle, post authority and coordinated erasure | local contracts and erasure/restart behavior tested; deployed orchestration pending |
| Pay/Billing | signed tip execution, receipt, refund and creator-net ledger | pending |
| Trust | report, appeal, correction and review identifiers | local report/appeal only |
| Cloud/Search | attachment object and public-content indexing lifecycle | pending |
| Data Fabric | canonical ordered event registration and replay | pending |
| Monitor/Explorer | alerts and retained cross-product proof | pending |
| Security/Integration | custody, artifact and protocol acceptance | pending |

Social remains fail closed when identity, cryptographic, payment or canonical
event dependencies are unavailable.
