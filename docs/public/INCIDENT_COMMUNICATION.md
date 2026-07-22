# Incident Communication Plan

Version: 1.0.0-candidate  
Status: template; public status service and contacts not evidenced

## Initial notice

State: incident start time in UTC; affected YNX product/network; observed user impact; whether writes, reads, signing or provider-backed functions are restricted; immediate safe user action; and next update time. Do not speculate about cause, expose secrets, publish attacker indicators prematurely, or say funds/data are safe without evidence.

## Updates

Use one incident ID. Separate confirmed facts, investigation, mitigation and remaining uncertainty. Report changes in scope and truthful unavailable states. If chain settlement is uncertain, say “outcome unknown—do not retry” until idempotency and canonical state are reconciled. Translate material safety instructions with professional review.

## Resolution

State service restoration time, capabilities restored, remaining limitations, user reconciliation/support steps, and whether a post-incident review will follow. “Resolved” requires health plus authoritative workflow evidence, not process restart alone.

## Post-incident review

Record timeline, impact, root and contributing causes, detection, response, recovery, RTO/RPO observation, evidence, what went well/poorly, corrective actions, owners and due dates. Publish a privacy/security-reviewed summary for material incidents. Preserve complete evidence in controlled storage.
