# Security Baseline

YNX Chain should be treated as financial infrastructure.

## Secrets

- Do not commit private keys.
- Do not commit PEM files.
- Do not commit RPC tokens.
- Do not commit server passwords.
- Keep `.env.example` as a template only.
- Confirm server host and role from local SSH config, environment, historical deployment scripts, or user-provided evidence before deployment.

## API Boundaries

- Public health/status APIs can expose network and block status.
- Admin APIs must be isolated before production deployment.
- Production RPC requires rate limits, CORS control, logging, and monitoring.
- AI actions that move value require explicit user confirmation, amount limits, target limits, time limits, revocation, and audit logs.

## Trust Tracing

Trust tracing defaults to trace, label, explain, and export evidence. It must not silently freeze funds. Freezing, rejection, or restrictions require explicit rules from contracts, merchants, institutions, courts, or governance.

## Claims

Any public claim must be supported by at least one of:

- live endpoint
- explorer data
- test command
- deployment log
- commit hash

