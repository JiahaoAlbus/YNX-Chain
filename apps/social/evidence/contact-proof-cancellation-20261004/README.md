# Original contact request cancellation across proof and transport

Base: 87a845d77ed198aedd3404732c8a8794df2b48e2.

Three actual source-consumer counterexamples are retained in original-tests.txt: cancelling confirmation while proof is pending still dispatched a later contact request; cancelling preview still dispatched a late preview; a late proof rejection after cancellation invalidated the retained authorization.

ContactRequestFlow now forwards ContactOperation's original AbortSignal through Social-owned previewContact/requestContact into the existing API request guards and Fetch. Cancellation before/during proof cannot produce late transport or apply a cancelled proof error. Existing target preview, original message, idempotency key, account-generation checks and explicit confirmation remain unchanged. An abort does not revoke an operation already received by a server; uncertain original intents remain retained. An API operation return never becomes recipient acceptance, friendship or follow authorization.

After the production repair, all three new counterexamples passed but the original positive fixture failed because it expected five arguments. repaired-tests.txt preserves that failure. The fixture still asserts all five exact original business arguments and additionally verifies the sixth argument is a non-aborted AbortSignal; no assertion/test/function was deleted. The four new tests use the actual SocialAPI/ContactRequestFlow with controlled proof/transport fixtures, not a protected producer or actual users.

Final full npm test exit0; TypeScript exit0; actual isolated Expo Android/iOS exports exit0. Exact logs are retained. Complete backend regression and deadline-view isolation evidence are in ../contact-view-snapshot-20261004/.

No shared authority, SDK, permissions, Host or actual account was modified. No backend permissions added, no real messages sent, no sensitive Wallet operation/device takeover/deployment. Actual rendered normal-user three-entry request/accept/deny/follow/audience/OS/public/MONSTER remain unverified; Social v2+crypto649 are not complete. Prior dormant9aa independent source PASS is not rerun or enlarged.
