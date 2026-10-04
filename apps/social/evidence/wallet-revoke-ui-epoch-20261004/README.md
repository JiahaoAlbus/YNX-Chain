# Standard Wallet revoke UI epoch

A real shared SDK controlled-provider caller regression exposed that the SDK empty-account event increments the public consumer epoch while a revoke operation is pending. The UI then discarded the SDK-confirmed successful revocation as stale.

The repair retains every public epoch change (private callers must still be invalidated), but binds the pending revoke to an operation object and credits only its own exact-provider, consecutive empty-account event. Different account/chain/intent changes still invalidate it. Manual disconnect retires the token. A retired operation's finally cannot clear a newer token.

Original failing regression output is preserved. The complete existing web/network-controls.test.mjs file returns exit 0 after repair; its VM/browser ports are controlled, including the actual shared Wallet SDK. This is not installed/public account approval, Wallet confirmation, real revocation, or full Wallet lifecycle completion. No real account/sign/transaction request was made by the main owner.
