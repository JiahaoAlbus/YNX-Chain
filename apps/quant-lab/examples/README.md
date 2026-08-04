# Strategy template and adapter examples

`strategy-template.json` is a research starting point for the only currently
supported built-in runtime. It is deliberately ineligible for execution. A
worker accepts only a separately built package whose exact source/artifact
hashes, scan evidence, dependency allowlist and Ed25519 signature verify.

`execution-intent.shadow.json` demonstrates the venue-neutral
`ynx.quant.execution.v1` intent consumed by both Paper and Shadow adapters. It
contains no venue credential, Wallet key, provider secret, withdrawal, owner or
risk-change authority. The timestamp is documentary; callers must generate a
fresh request ID, sequence and timestamp from their authorized orchestration
context.

Shadow returns `observed_no_submit`, zero fill and no order ID. Paper may return
only an explicitly simulated fill. Exchange and DEX examples are withheld until
canonical subaccount and Strategy Vault adapters exist; publishing invented
success receipts would violate the product evidence boundary.
