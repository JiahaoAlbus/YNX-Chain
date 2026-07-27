# YNX Mail Current Plan

Product: 25｜YNX Mail  
Branch: `codex/final-mail`  
Stage: INTEGRATE  
Goal: Active

## Protected checkpoint

Release-source commit `682bdb075803a77c9591fc59b83708944ea76fdf` is pushed and matches the remote branch. It carries the verified backup/restore runtime, truthful public metadata, aligned 0.3.0 build identity and reproducible platform proof scripts. The underlying backup/restore implementation was introduced at `0e087bc1fe7f71732d28dab1a6c7414e28d424ce`.

Targeted evidence at this checkpoint:

- `go test -race ./internal/mail`: pass
- `go vet ./internal/mail`: pass
- `npm test --prefix apps/mail`: 9/9 pass
- `npm run build --prefix apps/mail`: pass
- `npm run smoke --prefix apps/mail`: pass
- current-source desktop package/install proof: pass, unsigned local archive
- current-source Android API 36 build/install/cold-start/restart/callback route: pass, debug/test signed
- current-source iOS Swift/project static verification: pass; Simulator build/install blocked because complete Xcode is unavailable
- `go test ./...`: Mail passes; shared preflight remains blocked by non-Mail Consensus, Developer artifact, Faucet and Trust failures
- shared placeholder/secret scripts are not accepted as pass because missing `rg` produced false-green exit code 0; the Mail slice was searched separately and no credential marker was found

## Next autonomous slice

1. Emit private-minimized canonical delivery events for future Data Fabric integration.
2. Add an explicit rollback export/drill against the prior accepted Mail runtime; current evidence proves forward loading of legacy state, not rollback by an older binary.
3. Define active provider health polling without treating a successful probe as delivery readiness.
4. Define a centrally authorized operator review/unsuppression path with Trust and Monitor owners.
5. Complete the current-source iOS Simulator drill, then route Android and desktop artifacts through immutable hosting, provenance and approved signing.

## External gates retained

Provider account, credential reference, verified domain, DNS, public webhook, terms approval, abuse operations, complete Xcode/Simulator availability, immutable hosting and approved signing remain false or unavailable and must not be inferred from local code or local test artifacts.
