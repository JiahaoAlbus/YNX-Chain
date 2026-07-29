# Governance observability

Governance emits aggregate health and Prometheus metrics from authoritative in-memory state after integrity-checked restore. Metrics intentionally avoid high-cardinality or sensitive labels.

Current metrics are proposal total, active proposal count, executed proposal total, role total, active emergency count, discussion-entry total, appeal total, pending appeal count, and the constant external-execution-disabled gauge. API responses carry source, as-of time, API version, request ID, and—on failure—Error ID.

Structured logs are suitable for correlation by request ID. Evidence bodies, vote identities, session identifiers, device identifiers, HMAC material, filesystem paths, and internal stack traces must never be logged.

Public deployment, alert delivery, dashboard installation, trace export, and status-page integration remain false until direct remote evidence exists.
