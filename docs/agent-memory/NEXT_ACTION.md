# Next Action

Implement the Creator Studio content lifecycle as one product-owned slice:

1. Add explicit draft, in-review, scheduled, published and unpublished states without weakening existing processing/takedown/rights gates.
2. Persist immutable metadata/version records containing actor, timestamp, prior state, next state and content hash.
3. Add service and HTTP transitions for submit-review, approve/reject, schedule, publish-due and unpublish.
4. Add negative tests for unauthorized roles, invalid transitions, expired or unverified rights, takedown, schedule replay and post-revocation mutation.
5. Run `go test ./internal/video`, Race, Vet, Creator Web check/smoke and full repository Go regression after the contract build sequence.
6. Commit, push, verify local/remote SHA equality, then update integration vectors and recovery evidence.
