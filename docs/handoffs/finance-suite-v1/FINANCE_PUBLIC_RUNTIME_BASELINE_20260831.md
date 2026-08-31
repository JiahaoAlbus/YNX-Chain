# Finance public runtime baseline — 2026-08-31

This is a zero-write public HTTP read. It establishes the current release for
a future rollback-first lease; it is not an approval to deploy.

## Public readback

At 2026-08-31T14:09Z the public Finance endpoints returned:

```text
GET https://finance.ynxweb4.com/health
HTTP 200, application/json, 485 B
SHA-256 d1e97a4314acd1ecccf94629d15bd598cb58ff78136b3622ac26d583a82e45c1

GET https://finance.ynxweb4.com/version
HTTP 200, application/json, 130 B
SHA-256 39789776da47e60b7a7df845789e02ebba16707ad8951eb6f27c84c1b40bb226
```

The version response identifies the active runtime as:

```json
{
  "commit": "3b2383f5c18ab3eb5ce7f7f6a267d2cfe7c7e6a4",
  "release": "ynx-finance-3b2383f5c18a",
  "buildTime": "2026-08-15T05:27:32.177Z"
}
```

The health response truthfully reports
`multiInstanceState=false` and `stateStore=file-cas-single-host`. It is not
the current Finance candidate and does not prove PostgreSQL injection, a
public wallet lifecycle, approval, Product Session, signing, or any trade.

Some earlier HTTP/2 header reads had transient TLS handshake timeouts. The
hashes above were independently reread with successful HTTP/1.1 body requests.
