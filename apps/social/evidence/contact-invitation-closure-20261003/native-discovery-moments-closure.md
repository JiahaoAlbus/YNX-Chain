# Native discovery and ordinary Moments continuation

Source parent: 445211f2996a271b4cb060168be0c51fcbaba82d.
The actual App consumer, not just an unused helper, is wired to both changes.

Discovery links persist in existing device-only SecureStore without account,
permission, callback or approval fields. The canonical original personal/invite
URL is retained across consumer restart and restored as a pending review only.
Local serialized writes retain multiple arrivals, deduplicate exact links, refuse
capacity overflow and preserve malformed originals. Closing consumes only the
original entry; late close cannot clear a newer URL. Successful username requests
cannot consume an unrelated invitation. Original invite expiry/revocation and
current target validation still belong to the existing server preview/request.
There is no automatic authorization, contact request, acceptance or follow.

Native delete confirmation captures the original account authority and target.
Follow and reactions retain same-window original desired action and nonce on
unknown delivery; changed intent is refused until the original is retried.
Timed-out late success cannot clear that ledger. Following calls only the existing
follow API and does not accept or request contacts. Feed readback is generation
guarded, and old private feed views are cleared on authority-generation change.

Important limits: action ledgers are same-window, not durable restart storage;
following's existing UI state is not a new authoritative full follow-list readback.
Delete API semantics remain unchanged; no invented server idempotency contract.
Secure-store serialization is not claimed atomic across native processes.
Canonical universal-link handling is not proof of installed AppLinks or install
return. Native API scopes and audience/encryption semantics were not extended.

native-moment-actions-tests.log and native-discovery-recovery-tests.log preserve
the initial compile failure: reaction strings must match the original four-value
API union. The correction uses that union rather than weakening the interface.
Later source logs include typecheck and concentrated software regressions.

Public/installed/real Matrix/Rust, original federation root/MXID, two-node,
restricted Moments and actual device lifecycle remain NOT_VERIFIED. A remains
sole integration/release executor; no deployment or sensitive wallet action ran.
