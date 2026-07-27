# YNX Cloud decisions

- Preserve the existing Cloud runtime; do not replace it with a new scaffold.
- Add a product-isolated Compose profile rather than editing the shared Compose file that contains protected configuration.
- Container defaults remain fail closed: no development Wallet verifier and no implied production provider.
- A public liveness response is not readiness or durability evidence.
- Container delivery may be marked `testedLocal` only after an exact source-bound image build and cold-start; CI run `30275578270` satisfies that bounded proof, not hosting, signing or public deployment.
- GitHub push failure is handled with a verified bundle, never force push or destructive reset.
- Content-addressed deduplication is restricted to the same owner and product; equal hashes across Cloud/Docs or owners do not share physical references.
- Legacy global BlobPath records remain readable and deletable; no silent startup rewrite is allowed.
- Smoke tests build a temporary binary rather than using `go run`, so cleanup terminates the exact tested process and cannot accidentally reuse a stale listener.
- Storage lifecycle state is version-specific; object summary fields mirror only the current version.
- Every lifecycle mutation and retry binds exact Wallet account, Product Session product, object/version, digest, provider ref, source class and target class.
- A shared deduplicated blob must use copy-on-write before one logical version changes storage class.
- `pending` and `failed` lifecycle transitions are unresolved provider truth and block permanent deletion or product erasure until a provider-bound retry completes.
- Migration never invents lifecycle history for legacy metadata-only objects; material objects with missing current versions remain invalid and fail closed.
