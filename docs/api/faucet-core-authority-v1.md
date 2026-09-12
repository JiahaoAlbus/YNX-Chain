# Faucet service-to-Core authority v1

Candidate implementation. Core and Faucet must be configured together before
enabling the new service; a source commit is not evidence of public activation.

Core reads `YNX_FAUCET_CORE_AUTH_TOKEN_FILE` at startup. The private, regular,
non-symlink file must have permission 0600 and contain exactly 64 lowercase hex
characters (32 random bytes), optionally followed by one LF. Do not reuse a
wallet, replication, BFT signing, or Product Session key. Invalid files reject
startup without printing token contents. An absent file permits read-only chain
startup but disables public funding.

Faucet sends the exact token in `X-YNX-Faucet-Auth`; the old literal `configured`
is not a credential. On testnet/mainnet both `POST /faucet` and
`POST /faucet/requests` require this authority before parsing or mutating state.
Missing/invalid server configuration returns 503 `faucet_authority_unavailable`.
Absent/wrong/duplicate headers return 401 `faucet_authority_required`. Responses
do not echo tokens. Unconfigured local devnet retains synthetic fixture behavior;
when configured, devnet also requires the token.

Read-only `ynx_getFaucetModel` retains `ynx-faucet-request-v1` and adds:

```json
{"authority":{"version":"ynx-faucet-core-token-v1","header":"X-YNX-Faucet-Auth","required":true,"configured":true}}
```

Configured=false describes missing authority, not permission to use the legacy
route. Faucet must check this field before dispatching. The token is carried
only on the existing private loopback service-to-Core connection; remote
service links require authenticated TLS. Do not expose the token to browser
code, metadata, public release artifacts, diagnostics, or logs.

Token rotation does not change chain request-ID history. After rotation or a
cold restart the same admitted request must return the same transaction hash
and must not move additional funds. Preserve the admission database and latest
chain state independently of token installation/rotation.
