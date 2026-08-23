# Browser P0-233 Emergency Recovery Successor

This is a lease request, not recovery authority. The failed P0-233 state remains untouched.

The successor removes the missing-forward-receipt dependency. It binds recovery to the immutable P0-233 diagnostic journal, the exact parent/root/target/binary tuples and hashes, the exact old handler and PID, and the immutable P0-232 journal. It only permits unregistering the exact candidate, confirming the old handler without opening the scheme, deleting the exact candidate, and deleting the same empty isolated root.

Implementation commit: `718dc2770e39c78c94d70dc379a04710464f9e7d`

Executor SHA-256: `667c07bdb4ddc7cd3a29ab6f6c124e920aea3c55ba76387af2cc5c67c80e42aa`

Actual-shell fixture: focused 33/33 and full Browser 51/51. It covers root substitution, concurrent root contents, a running candidate, receipt-less recovery, and partial-cleanup stage journals while retaining the eleven legacy-copy/PID fixture.

Current direct state remains: old handler resolved, PID 93119 exact and sole, P0-233 candidate present, twelve total copies (eleven old plus the candidate), P0-233 journal SHA `f89bacb7d95f24808f9af811797ae03d2f55a829edd1523f4894ad47b62fa28e`, and P0-232 journal SHA `b48b4b0984371b81ce457f9e68fcd1891e7a82b4bdbbc403f73fd92c28d84dc8`.

Central must issue a wholly new single-use Browser-only recovery lease before the exact recovery argv may run. No application launch, scheme invocation, provider, account, signature or transaction is authorized.
