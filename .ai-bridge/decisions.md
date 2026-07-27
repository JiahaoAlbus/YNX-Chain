# YNX Cloud decisions

- Preserve the existing Cloud runtime; do not replace it with a new scaffold.
- Add a product-isolated Compose profile rather than editing the shared Compose file that contains protected configuration.
- Container defaults remain fail closed: no development Wallet verifier and no implied production provider.
- A public liveness response is not readiness or durability evidence.
- Container delivery remains `implementedLocal` until an exact image build and cold-start succeeds.
- GitHub push failure is handled with a verified bundle, never force push or destructive reset.
- Content-addressed deduplication is restricted to the same owner and product; equal hashes across Cloud/Docs or owners do not share physical references.
- Legacy global BlobPath records remain readable and deletable; no silent startup rewrite is allowed.
- Smoke tests build a temporary binary rather than using `go run`, so cleanup terminates the exact tested process and cannot accidentally reuse a stale listener.
