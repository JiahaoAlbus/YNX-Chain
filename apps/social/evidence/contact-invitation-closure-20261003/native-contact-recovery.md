# Native original contact request recovery

Parent: 4e3e78954e99931867f7dbb394c326d1efe5c1b5.
Actual Contacts UI now persists an original reviewed contact intent in existing
device-only SecureStore before the request call. It retains original account,
discovery source/value, public target locator, idempotency key and trimmed note.
No device/identity/crypto key or additional permission is created.

Unknown delivery cannot be replaced by another target, note or freshly generated
nonce. Explicit Restore reads the original, then re-runs the existing private
preview under current authority and checks the original person locator before
showing current profile details. No replacement nonce or automatic send occurs.
The user must confirm the restored review again. Invite expiry/revoke, blocks,
request policy and original target remain server checks, not local authorizations.

An operationReturned marker records only that the existing API call returned
under its original guard. It is not recipient consent, accepted friendship,
stable federation root, a server request ID or independent authenticated receipt.
Recovery of such a marker reads the actual request list and does not resubmit.
Original target/message/nonce remain in storage if a native marker write finishes
after close/account change. Malformed originals are not reset.

The carrier tracks one active recovery intent per account, not the entire request
history. An unknown intent must be restored before starting a different one;
after a returned operation a newly reviewed request may replace this recovery
slot. Server request history and existing account data are not deleted. Same-key
changed bodies are always refused. Storage access is serialized across consumers
in the same JS runtime/account; no cross-process atomicity is claimed. Local waits
use existing 30-second ContactOperation and cancellation; native IO is not itself
abortable, so underlying storage serialization lasts until IO actually settles.

Source tests cover restart with original nonce/body, changed target/message/key
refusal, account separation, corrupt retention, delayed native write after actor
change, remount protection and current private preview/restoration. Backend tests
read for integration retain explicit recipient acceptance and original terminal
request history. Software fixtures are not installed/public end-to-end acceptance.

Native mature Matrix/Rust, actual HS/original MXID/root, two-node, restricted
Moments, device and public/installed acceptance remain NOT_VERIFIED. Local sp
locators are not asserted to be the federation identity root. A owns shared
integration/release and Central NO_GO remains unchanged.
