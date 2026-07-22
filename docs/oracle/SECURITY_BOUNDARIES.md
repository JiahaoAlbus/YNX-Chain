# Security boundaries

| Component | May do | Must never do |
|---|---|---|
| Provider adapter | Normalize an authorized provider response and submit a signed observation | Assert YNX chain state, Wallet identity, user balance, settlement, or permissions |
| Reporter | Sign observations for its registered provider, markets, types, and nonce domain | Sign for another provider, bypass sequence/freshness, hold user keys, or broaden Wallet scopes |
| Oracle service | Authenticate observations, retain lineage, aggregate, expose quality, fail closed | Trade, sign user transactions, move assets, approve Wallet actions, or silently replace stale data |
| Registry governance | Version provider keys, weights, status, licenses, storage rights, and removal | Hide source changes, use wildcard identities, or remove a provider without notice/audit/appeal process |
| Correction operator | Append a reasoned, audited, effective correction through approved operator auth | Delete/overwrite original history or rewrite an already published aggregate silently |
| Consumer | Read a typed value after validating every quality invariant | Ignore stale/breaker/source/version/confidence/coverage or treat an HTTP 200 as sufficient authority |
| Chain module | Commit a validated aggregate digest/value under Chain governance | Fetch arbitrary web data inside consensus or accept a single unsigned venue price |
| AI layer | Explain quality, summarize incidents, and draft registry/policy changes | Sign observations, approve providers, change weights, pause/resume, trade, or execute governance |

The current local service implements Provider, Reporter, Oracle service, persistence, and Go consumer boundaries. Canonical Wallet/App Gateway operator authorization and the Chain module are integration deliverables, not locally claimed controls.
