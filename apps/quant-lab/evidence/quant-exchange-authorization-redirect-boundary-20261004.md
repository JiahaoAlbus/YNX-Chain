# Exchange authorization transport boundary

Continued from 1e67719375a116ccf27db5bdcb158c1e48104848 on the isolated Quant owner branch. Exchange original worktree was inspected read-only; no shared Wallet/Auth or Exchange files changed.

`HTTPExchangeAdapter` previously used the supplied/default HTTP client's redirect policy. Go follows redirects by default: 307/308 can replay signed POST bodies and authorization headers at another endpoint; 301/302/303 can change methods and carry a custom one-time proof header. A redirected response must not become a valid venue receipt or private-session completion.

The owned adapter now clones the supplied client, preserving transport/timeouts without mutating its policy, and returns the first redirect response without following it. Mandate/order requests reject all non-2xx as before; completion explicitly rejects 3xx with ErrUnavailable and no response body/status promotion. No retry, authority change, alternate venue, new Wallet SDK, signature creation or real transaction was added. The market data reader and public surfaces remain unchanged.

Actual two-local-HTTP-server race regression covers 301/302/303/307/308 × same-origin/cross-origin for mandate, order and completion (30 authorized requests total). Every redirect fails unavailable, target receives zero forwarded calls, and the supplied client callback remains unmodified. Existing exact mandate/order signature and completion success tests run together: PASS, 2.128s. These are controlled local transport tests, not Testnet execution or actual Wallet approval.

Full Go race invocation PASS: `go test -race ./internal/quantlab ./apps/quant-lab/server -count=1`, internal package 45.923s, server 1.442s. Public verifier regression 5/5 PASS, 59.050583ms; gofmt/diff gates PASS. This change supersedes the old binary for future production composition; the previous immutable b60 archive is preserved, not silently rebuilt or replaced. Formal Host publication remains A's sole write surface; all public-current-source, installed, real approval/signature/transaction and aggregate-completion gates remain unverified.
