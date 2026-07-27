# YNX Search Current Plan

Phase: `FREEZE` → `INTEGRATE`  
Protected runtime commit: `66bc18ea697be99a990143ab0b843652c49931b7`

1. Keep Source Registry v4, Search result v3, data-policy v1.0.0, canonical
   entities, explainable ranking, and public feed schemas frozen and fail-closed.
2. Implement a versioned v4 backup bundle with manifest, SHA-256 integrity,
   separate-path restore, rollback boundary, and deterministic reindex drill.
3. Add retention expiry/export-delete verification, structured request metrics,
   trace/error IDs, Monitor handoff, and reproducible capacity measurements.
4. Build the provider-neutral external Search adapter with unavailable, rate-limit,
   retention, health, and source-separation semantics before requesting credentials.
5. Complete Wallet, AI, Trust, Browser, Data Fabric, Website, Integration, and
   Security owner acceptance; do not replace missing owners with local substitutes.
6. Deploy the current source commit to staging only after recovery and release
   gates pass, then verify exact health SHA, migration, restart, and empty/approved
   corpus behavior.
7. Advance to public release only after immutable artifacts, Website `/search`,
   public hashes, current-source deployment, and direct evidence pass.
