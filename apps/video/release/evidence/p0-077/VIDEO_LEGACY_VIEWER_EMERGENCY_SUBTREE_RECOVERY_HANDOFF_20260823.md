# Video legacy Viewer emergency recovery

P0-237 left only Viewer port 6494 unavailable. API 6493, Creator 6495, Caddy and the shared-current symlink remain exact. The legacy unit cannot restart because the unchanged Creator release lacks `apps/video/server.mjs`.

The successor adds only the missing `apps/video` subtree from the already-staged, byte-exact predecessor carrier. It extracts into a same-filesystem pending directory, validates the complete 13-file list and every hash, normalizes ownership/modes, atomically renames the subtree, then resets and starts the existing legacy unit. It does not modify the symlink, unit, Caddy, API or Creator.

The production fixture proves both terminal paths. Success serves exact predecessor Viewer bytes and preserves API/Creator. Failure stops the unit and deletes only the newly created subtree after revalidating its identity.

No production write is authorized by this handoff. Central must issue one new single-use emergency recovery lease bound to the accompanying JSON command object.
