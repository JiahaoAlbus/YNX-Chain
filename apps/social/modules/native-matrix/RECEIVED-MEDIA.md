# Original received media adapter, not a mounted feature or E2E receipt

These native adapters consume an original remote SDK timeline event, not a JS
URL, ciphertext key, attachment descriptor, or an alternative encryption system.
They retain the official SDK media-file handle as a native preview lease. The
locked Rust client explicitly deletes its temporary file when that handle drops.
No plaintext is persisted/copied or automatically shared with another app.

Both pin sets expose Client.getMediaFile, MediaSource.toJson/url and
Timeline.getEventTimelineItemByEventId. The event ID, sender, original encrypted
file descriptor and SDK descriptor must agree. Edited content needs a separate
review and is not silently substituted. The SDK performs media retrieval and
decryption; source tests do not prove successful cryptographic verification.
The installed offline SDK probe observed Ruma reordering JWK key_ops. Comparison
normalizes only this non-duplicate encrypt/decrypt set; keys, IVs, hashes, URL,
other fields and arrays are still compared strictly. This is not hash verification.

The caller MUST supply review(roomId, sender), backed by the current native handle,
canonical unexpired authority, encrypted direct-room audience, and original
accepted peer. These helpers are not registered as Expo functions yet. They must
not be mounted using a Wallet ProductSession as a Matrix credential, an arbitrary
Timeline, or a permissive review callback. Close must run on background, room
change, authority invalidation and teardown; each preview release drops only its
own handle. The JS controller independently fences late/replaced preview results.

The current maximum is 32 MiB. Declared oversize and downloaded size mismatch are
refused; this is not a bounded network-transfer/disk-quota guarantee. SDK pin
behavior and transport-level limits still need real-device hostile-file testing.
Raster preview supports PNG/JPEG/WebP/GIF only; other files are not auto-rendered
as HTML/SVG or launched. Original filenames are display labels, never paths.

Open integration and acceptance: register against the admitted native handle,
mount an accessible viewer, enforce canonical peer/room invalidation, real
encrypted image/file download and SDK hash rejection, unreadable file/size/error
recovery, process restart cache cleanup, Apple SDK typing/linking, ordinary-user
ABC journey and true dot MONSTER. No successful received-media E2E is claimed.
