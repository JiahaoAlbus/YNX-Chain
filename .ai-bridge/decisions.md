# YNX Cloud decisions

- Preserve the existing Cloud runtime; do not replace it with a new scaffold.
- Add a product-isolated Compose profile rather than editing the shared Compose file that contains protected configuration.
- Container defaults remain fail closed: no development Wallet verifier and no implied production provider.
- A public liveness response is not readiness or durability evidence.
- Container delivery remains `implementedLocal` until an exact image build and cold-start succeeds.
- GitHub push failure is handled with a verified bundle, never force push or destructive reset.
