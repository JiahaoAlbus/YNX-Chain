# Matrix audience authority proposal, not mounted or approved

Proposed Social-owned routes:

- POST /social/v3/matrix/audience/resolve
- POST /social/v3/matrix/audience/authorize

Both require current Social feed publishing permission. Contacts/messaging
Matrix transport permission must remain separately verified; profile remains
in the live session. A must confirm the exact proof scope set and matching
Wallet review before mounting either route. Do not invent social.media or
social.follows; do not upgrade old grants. Origin/CSRF, original body digest,
account generation, bounded body and rate limits are required.

Resolve input: kind (contacts/group/selected/private), selected opaque Social
profile IDs for selected only, authorized group ID for group only. No funding
account, arbitrary MXID, room ID or caller-generated revision grants authority.
Owner comes from the current verified actor. The original Social store is the
sole source of accepted/unblocked relationships, group membership and revision.
Exact existing Matrix directory mappings are reused, never derived or created.

Consumer output: protocol=ynx-social-matrix-moment/v1, kind, revision, owner
(existing MXID), roomId, members (bounded exact existing MXIDs including owner).
No credentials, keys, content, media descriptors or attachment names. A room
binding must be stored only after approved room creation and actual confirmed
membership; until that integration exists resolve must fail closed rather
than echo a client room ID or treat a local member list as confirmation.

Authorize input: the original resolved output plus action (publish/comment/
media-prepare/index/read) and original transaction identity. Return the same
consumer output only if the current store policy and confirmed room binding
still match; missing/changed revision or blocked/removed member denies.
Comments also require original parent room/event/revision ownership binding.
Index writes store protocol/room/event/owner/audience/revision/idempotency only.
Existing plaintext Moment/media storage is not the restricted index.

Remaining implementation: derive a durable audience revision from original
Social store transitions without introducing a second relation store; protect
resolve/authorize from concurrent accepted/block/group transitions; confirm
room membership/key lifecycle with real HS and SDK; implement metadata-only
atomic index and explicit UI adapter. These routes currently do not exist.
Pre/post checks alone do not prove atomic revocation with remote HS sends.
