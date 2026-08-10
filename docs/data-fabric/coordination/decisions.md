# Decisions — YNX Data Fabric

## 2026-07-27

1. **Repository evidence outranks archived chat summaries.** The untracked recovery summaries describe older SHAs and release states and will be archived, not used as current truth.
2. **Envelope v2 is the current canonical producer contract.** Envelope v1 remains accepted only as an explicit migration compatibility version.
3. **Runtime and Schema must move together.** A reflection-backed test now fails when `EventEnvelope` JSON fields and the committed v2 Schema diverge.
4. **Engineering Source Commit is separate from evidence-only commits.** Release metadata binds to the latest commit touching Data Fabric runtime, schemas, integration ownership, packaging or deployment code; evidence-only updates cannot silently redefine the product source.
5. **Local install evidence is not public release evidence.** Successful Linux CI package install and cold start set `installedLocal=true`; public, hosted and production-signed states remain false.
6. **Pay is local integration, not central acceptance.** Pay BFT ingestion and Ledger reconciliation are tested locally, while `integratedCentral=false` remains authoritative.
7. **No network exactly-once claim.** The supported guarantee is idempotent effect inside controlled state transitions with transactional Inbox records.
8. **Corrections are append-only.** Financial history is never silently overwritten.
9. **Headless platform rationale.** Server, CLI, SDK, systemd package and responsive web operator console are applicable; native mobile and desktop store binaries are not product runtimes.
10. **Phase remains `INTEGRATE`.** Local Testnet packaging and fixture promotion do not permit a jump over central acceptance to TESTNET or PUBLIC.
