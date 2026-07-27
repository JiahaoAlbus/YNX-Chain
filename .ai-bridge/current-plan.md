# YNX Mail Current Plan

Product: 25｜YNX Mail  
Branch: `codex/final-mail`  
Stage: INTEGRATE  
Goal: Active

## Protected checkpoint

Runtime commit `0e087bc1fe7f71732d28dab1a6c7414e28d424ce` is pushed and matches the remote branch. It adds a bounded, mode-restricted Mail backup package; verified restore of provider events, suppressions, dead letters, provider health and sender identity; fail-closed HMAC, manifest, permission, file-layout and Ed25519 consistency checks; same-byte validation/install; and no-replace concurrent destination reservation.

Targeted evidence at this checkpoint:

- `go test -race ./internal/mail`: pass
- `go vet ./internal/mail`: pass
- `npm test --prefix apps/mail`: 8/8 pass
- `npm run build --prefix apps/mail`: pass
- `npm run smoke --prefix apps/mail`: pass
- `go test ./...`: Mail passes; shared preflight remains blocked by non-Mail Consensus, Developer artifact, Faucet and Trust failures
- shared placeholder/secret scripts are not accepted as pass because missing `rg` produced false-green exit code 0; the Mail slice was searched separately and no credential marker was found

## Next autonomous slice

1. Emit private-minimized canonical delivery events for future Data Fabric integration.
2. Add an explicit rollback export/drill against the prior accepted Mail runtime; current evidence proves forward loading of legacy state, not rollback by an older binary.
3. Define active provider health polling without treating a successful probe as delivery readiness.
4. Define a centrally authorized operator review/unsuppression path with Trust and Monitor owners.
5. Rebuild and reinstall current-source desktop, Android and iOS artifacts.

## External gates retained

Provider account, credential reference, verified domain, DNS, public webhook, terms approval, abuse operations and current-source hosted artifacts remain false and must not be inferred from local code.
