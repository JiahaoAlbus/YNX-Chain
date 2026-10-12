# Developer observability status

The public candidate exposes a bounded health/version response at `/healthz`.
Protected deployment evidence records source status, image identity, health,
runtime gates, Chain tools, Wallet readiness, package persistence and restart
recovery under the root-owned transaction directory.

Runtime workspaces maintain owner-scoped audit and request identifiers; UI text
does not reveal host paths, stack traces or credentials. Current evidence is a
release gate, not a claim of an independently operated status page, alerting
service, off-host backup or full SLO dashboard. Those remain external
integration requirements.
