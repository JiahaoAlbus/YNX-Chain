# Documentation Candidate Operations

## Review order

1. Read `release/product-release.json` and treat every `false` as authoritative.
2. Use `docs/acceptance/EVIDENCE_INDEX.md` to locate evidence and gaps.
3. Review technical claims against code/tests and economic claims against approved policy evidence.
4. Route legal, privacy, regulatory, provider, security, and brand sections to their named external owners.
5. Run the final validation suite and record the final commit in all manifests before publication.

## Publication controls

Publish only documents whose status and limitations remain visible. Website copy must use `PUBLIC_BRAND_FACTS.md` and the marketing evidence matrix; it must not promote candidate mechanisms as live. Draft legal documents must remain marked draft until counsel approves jurisdiction, entity, contact, age, dispute, privacy, retention, and governing-law details.

If evidence becomes stale or contradictory, withdraw the affected claim, set its release boolean false, preserve the incident/change record, and update the evidence index. A documentation merge does not activate runtime behavior.
