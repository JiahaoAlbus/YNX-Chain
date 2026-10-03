# Native original publication recovery

Source parent: 874d8c712325c6855bc429890635314f04bf28c6.
Social-owned implementation only; existing API and authority remain unchanged.

The actual native Moments consumer now freezes the reviewed body, visibility
and uploaded media identifiers. Before sending it persists the original nonce
and snapshot in existing device-only SecureStore under the original account.
Unknown delivery retains that snapshot. The explicit restore button reloads it;
changed text, audience or media cannot replace an unconfirmed request.

Local tests cover controller restart, unchanged retry, account separation,
malformed-storage preservation, stale authority, unknown receipt rejection,
actual deferred-Promise timeout followed by late success, composer cancellation,
permission rejection and explicit restoration. These are software fixtures,
not an installed device or public product acceptance receipt.

First compile failure is preserved in native-moment-intent-tests.log:
publication response was unknown. Runtime record-ID decoding replaces unsafe
assumptions. The identified first-draft risk was ignored abort allowing late
success to clear the nonce; native-moment-abort-fence-tests.log and final source
tests cover the corrected send/ack signal and original authority checks.
Composer close, background, unmount and authorization-generation change cancel
local waiting. Already received server actions are not claimed to be revoked.

Storage serialization is local to the controller, not a cross-process atomic
transaction. Native secure-store IO itself is not abortable. A successful record
ID is a checked response field, not independent proof of public source binding,
remote audience, stable federation identity or real installed publication.

Existing visibility semantics are preserved, not silently extended. Native
restricted Moments and Matrix/Rust device lifecycle still need A's actual mature
consumer integration. Legacy crypto is not relabeled as mature Matrix encryption.
No keys, old user databases, requests or historical content are reset or removed.
Central NO_GO and sole A integration/release executor remain in force.
