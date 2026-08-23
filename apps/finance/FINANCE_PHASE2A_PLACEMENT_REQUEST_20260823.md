# Finance Phase 2A placement-only request

Prerequisite accepted: Central `f971effaea38b9346fa28c3977e1cb0a9a6bd6b7` / tree `98878d0c321d93c72abb288ff8487dc5d29faa7a`; record blob `ed3f17e1f346449225f2c9360aa77058df8b9d2f`, SHA-256 `6dcdcb66a856be54ae2d1a2883a47f6c75ba262f1eab2c9de49cd50fc6977db0`. P0-228 remains nonreusable.

This request is Phase 2A only. It binds all accepted settled Phase 1 tuples and empty carrier `/opt/ynx/stage/finance/p0228-finance-phase1-20260822T234100Z`. It may place only these literal lease-parent destinations after a new signed lease: `${LEASE_ID}.archive.tgz`, `${LEASE_ID}.generator.sh`, `${LEASE_ID}.phase2b.sh` under `/opt/ynx/leases/finance-preparation`; `LEASE_ID` must equal the accepted carrier basename.

Frozen bootstrap: 2,894 bytes, SHA-256 `9182ff20931153504e88e66f160701563c4503c68d875769d395557b5925a5c6`. Actual-shell fixture: 2,749 bytes, SHA-256 `e3bb8ddb0887ee377d710af4859cb9e0217976fc14ec67c229361a3479c68c96`.

Literal argv:

```text
finance-phase2a-placement-bootstrap.sh p0228-finance-phase1-20260822T234100Z <rootTuple> <stageParentTuple> <stageTuple> <leasesParentTuple> <leaseParentTuple> <carrierTuple> <approvedArchivePath> <archiveBytes> <archiveSha256> <frozenGeneratorPath> <generatorBytes> <generatorSha256> <frozenPhase2BPath> <phase2BBytes> <phase2BSha256>
```

It performs no `/etc/ynx/finance.env` read, generator/executor invocation, carrier write, deploy, restart, current/unit/Caddy/public change, account request, signature or transaction. It emits only path/tuple/SHA receipts after placement. Failure cleanup removes only placed regular files whose captured tuple and SHA still match; Phase 1 directories and siblings are preserved. Phase 2B requires a later Central acceptance and lease.
