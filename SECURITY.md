# Security Policy

## Reporting a Vulnerability

If you believe you have found a security vulnerability, report it privately.

- Preferred: open a GitHub Security Advisory
  (`Security -> Advisories -> Report a vulnerability`)
- Current fallback if GitHub Advisories are unavailable: open a private contact
  request through the official website and ask for a security-reporting channel

Please include:

- A clear description of the issue and impact
- Steps to reproduce (PoC)
- Affected versions/commit hash
- Any proposed mitigation

Do not open a public issue for an unpatched vulnerability affecting:

- `chain/`
- `infra/bridge-service`
- `infra/ai-gateway`
- `infra/web4-hub`
- public operator scripts or deployment paths

## Response Commitments

- Initial acknowledgement target: within 3 business days
- Triage target for materially reproducible issues: within 7 business days
- Critical issues affecting public infrastructure: best-effort emergency response

Current reality:

- YNX is still a live public-testnet project, not a finalized production network
- the public disclosure channel is functioning, but the security process is still
  being formalized into a broader company-grade operating model

That means researchers should expect honest coordination, but should not infer
that a 24/7 staffed SOC, institutional bug-bounty program, or dedicated
company-managed security inbox already exists.

## Scope And Boundaries

In-scope targets include:

- public testnet chain node and chain-facing scripts
- public bridge, AI gateway, Web4 hub, faucet, indexer, and explorer services
- SDK and contract logic that affects authorization, settlement, or asset flow
- deployment scripts and documented operator paths

Out-of-scope by default:

- feature requests
- unsupported forks or modified self-hosted deployments
- third-party infrastructure outside YNX control
- social engineering requests not tied to a verifiable product vulnerability

## Coordinated Disclosure

Please allow a reasonable remediation window before public disclosure. When a
fix is ready, YNX will prefer to:

1. patch the issue;
2. add or extend a regression test where practical;
3. update affected runbooks or public docs if operator behavior must change.

## Process Reference

For the fuller operating policy, incident workflow, and current maturity
limitations, see:

- `docs/en/SECURITY_RESPONSE_POLICY_2026_06_13.md`
- `docs/zh/安全响应策略_2026_06_13.md`
