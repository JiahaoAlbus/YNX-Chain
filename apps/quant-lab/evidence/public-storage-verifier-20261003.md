# Quant public source/storage readback gate

Source predecessor: `9b125aaf1ca09308c46fc1ed8d093becdc30d91a`.
Scope: owned read-only QA command and tests. No publication pins, Host writes,
authority changes, tenant headers, credentials, accounts or transactions.

## Executable verification

```sh
node apps/quant-lab/scripts/verify-public-storage-runtime.mjs --expected-commit 9b125aaf1ca09308c46fc1ed8d093becdc30d91a
```

This exact command was executed against `https://quant.ynxweb4.com` on
2026-10-03. It exited 1, correctly rejecting the current old public runtime.
It issued only three GETs: `/api/version`, `/api/health`, `/api/ready`.
Redirects are refused, each request has a 15-second timeout, bodies are bounded
to 64 KiB and strict UTF-8 JSON with the JSON media type. Output includes only
receipt URL/status/bytes/SHA/media type and fixed validation failure classes,
not raw bodies, authentication headers or exception text.

| Response | HTTP | Bytes | SHA256 |
| --- | --- | --- | --- |
| `/api/version` | 200 | 274 | `f82629a1bd63e50f6721611cbf7866f86d7bffd51820b05a417590541c4653df` |
| `/api/health` | 200 | 462 | `9f20f70d5719359683c2f2e4a0dabacd7003072d01b16e1930520ea79b01b4cb` |
| `/api/ready` | 503 | 283 | `4592a6896439bfde9243868675ccb91625e3701a2389a895e2d693de36520655` |

All three responses were JSON. Failures: version/health durable storage not
ready and source identity mismatch; readiness HTTP status/storage/status
mismatch. Successful liveness is not deployable readiness.

## Local regression

`node --test apps/quant-lab/tests/public-storage-runtime.test.mjs`: 12 PASS,
0 failures, 0 skips. Controlled response fixtures test exact source and durable
storage, old source, filesystem backend, unfulfilled database requirement,
503 readiness, false health readiness, live-funds boundary, HTML fallback,
oversized/invalid UTF-8 body, redirect refusal and pre-fetch full SHA validation.
These controlled positives are not a real public positive or tenant-isolation
proof. `node --check` and `git diff --check`: PASS.

## Handoff and remaining acceptance

The release Owner can run this command after integrating the backend source
and configuring real PostgreSQL storage. Bind `--expected-commit` to the exact
formal build source, not this old owner predecessor or a moving branch.
Public positive readback remains missing. Even a future positive here proves
only source/storage response gates: it does not prove multiple independent
users, cross-instance consistency, restart recovery, Wallet approval, private
session grants, order/transaction execution or installation. Those require
separate direct evidence. All corresponding promotion flags remain false.
