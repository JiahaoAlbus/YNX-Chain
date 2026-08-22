# Monitor unit economics

The current candidate has no deployed usage bill, notification-provider invoice,
approved retention volume, paid user baseline or accepted revenue. Numeric
per-user cost and margin claims are therefore unavailable.

Measure, per review period:

`cost per active operator = (compute + telemetry storage + egress + notifications + AI + support) / active operators`

Telemetry, notification and AI provider costs require accepted terms, rate
limits, retention, jurisdiction and invoices. Chain, product and incident data
must not be treated as Monitor revenue. Public status access must not imply a
paid service or production availability.

Scale only after two periods show alert timeliness within SLO, bounded false
positive/negative rates, sustainable storage/notification cost, tested recovery,
and no unresolved critical security or privacy issue. Pause or kill automation
on unauthorized action, approval bypass, data leakage, alert suppression,
unbounded cardinality/storage, or inability to restore the audit chain.
