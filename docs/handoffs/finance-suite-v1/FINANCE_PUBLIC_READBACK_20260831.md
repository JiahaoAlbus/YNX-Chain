# Finance public readback — 2026-08-31

## Method

One bounded read-only HTTPS inspection was run against the public Finance
domain. No Wallet click, account request, SSH, deployment, service mutation,
or secret access occurred.

## Observations

| Endpoint | Header result | Body result | Interpretation |
| --- | --- | --- | --- |
| `https://finance.ynxweb4.com/` | HTTP 200, `text/html; charset=utf-8`, 11,427 bytes | body TLS read timed out after the bounded request | The shell is reachable; no source identity is proven. |
| `https://finance.ynxweb4.com/health` | HTTP 200, `application/json; charset=utf-8`, 485 bytes | SHA-256 `d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1` | A health response exists, but it is not evidence that the current Finance source is deployed. |
| `https://finance.ynxweb4.com/version` | HTTP 200, `application/json; charset=utf-8`, 130 bytes | body TLS read timed out after the bounded request | The version envelope could not be read and bound to source. |

## Truth boundary

These observations do not establish `sourceBoundPublicRuntime`, public Wallet
approval, Product Session, account data, a signed action, a Testnet trade, or
an installed release. The historical health evidence from 2026-08-15 must not
be promoted to current deployment proof.

The next valid public gate is a Central-authorized Finance deployment or
read-only runtime verifier that can bind a complete version response, artifact
hash and source commit without reusing a consumed lease.
