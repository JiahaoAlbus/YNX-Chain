# YNX Pay Testnet release notes

## Unreleased

Recovered the canonical-Wallet Pay, Merchant Console and sandbox Card work into the dedicated Pay delivery branch. Local settlement verification binds Wallet-signed intent data to the invoice and authoritative central Pay response. Merchant sessions are short-lived and product/device scoped. Refund requests, disputes and signed webhook retries remain human/operator workflows and cannot create paid state.

Added an optional HTTPS paymaster adapter. It is disabled unless an operator supplies an approved endpoint, server credential, sponsor identity and positive budgets. Quotes bind the Wallet account, product device, smart account, merchant, invoice and call-data hash. First-payment eligibility and global/user/merchant daily budgets fail closed. A provider-backed committed UserOperation receipt is persisted with sponsor attribution but cannot mark the invoice paid.

This is not a public release. Central Gateway integration, current device installation proof, fresh Testnet payment/refund/sponsorship evidence, hosted downloads, production signing and store release are not complete.
