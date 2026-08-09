# Security, Privacy, and AI Governance

Version: 0.1.0-candidate  
Last reviewed: 2026-07-22  
Source commit: `719e1018267ed5a53e6fae5211c5fd8a1503c35c`

## AI authority

AI may draft, explain, translate, summarize, research, preview, simulate, propose patches, and recommend actions. It may not autonomously sign, pay, trade, swap, withdraw, open cards/accounts, send messages, publish content, delete data, change permissions or risk labels, alter issuance/treasury policy, upgrade consensus, or bypass human approval.

For every tool-capable request, collect context-specific consent; show provider/model availability and cost class; minimize inputs; create a preview containing exact effects and authoritative source state; require approve or reject; revalidate policy, mandate, nonce, expiry, and state at execution; and create a bounded audit event. Approval for one action cannot authorize another. Sensitive actions require explicit per-action approval and fail closed when evidence is stale, provider output is malformed, audit persistence fails, or authorization is ambiguous.

## Source classification

Outputs classify facts as YNX authoritative state, third-party data, estimate/simulation, AI inference, cache, or user input. Records include `source`, `asOf`, `version`, failure state, and confidence/coverage where appropriate. AI text is never authoritative evidence of identity, balance, permission, transaction, settlement, receipt, Trust case, reserve, price, or legal status.

## Privacy

Collect only data necessary for the declared purpose. Separate public-chain data from account/contact/device/support/provider data. Define purpose, lawful basis, recipients/processors, jurisdiction/transfers, retention, security, access/correction/deletion/export, and appeal before production collection. Prompts and tool payloads must exclude secrets and unnecessary personal data. Provider training, retention, subprocessors, deletion, incident rights, and opt-out controls require review.

Do not place private keys, seed phrases, API secrets, full identity documents, private communications, or unnecessary personal data in chain state, prompts, logs, metrics, traces, or repository evidence. Public-chain deletion cannot be promised; off-chain minimization and unlinking must be explained.

## Model and provider controls

The provider register is authoritative for approved scope. Each adapter has model/version, authentication, rate/size limits, terms/license, data rights, retention, jurisdiction, health, timeout, cost, fallback, and outage behavior. Fallback must preserve consent and risk class; it must not silently send data to a different provider. Provider success is not product-action success.

Evaluate prompt injection, data exfiltration, unsafe tool selection, hallucination, bias, multilingual semantic drift, jailbreaks, denial of wallet, and cost amplification. Maintain red-team cases and regression results by model/config version. High-risk decisions remain rule- and human-governed.

## User controls and incidents

Users can reject, revoke sessions/mandates, inspect material audit history, and report harmful outputs. Safety or privacy incidents follow the incident plan, preserve redacted evidence, contain provider/tool access, notify affected parties where required, and support correction/appeal. Operators must not expose internal prompts, stack traces, credentials, or sensitive provider responses in UI.

## Current evidence boundary

Local AI permission/action records and explicit approval behavior exist in the chain/gateway test surface. Provider-backed public generation is not proven healthy in this package, central product migration is incomplete, and production privacy/legal approval is absent. AI readiness therefore remains partial.

## Change log

- 0.1.0-candidate: unified authority, consent, privacy, provider, audit and failure requirements.
