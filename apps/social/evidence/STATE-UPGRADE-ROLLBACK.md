# Social state schema 6: upgrade and forward-compatible recovery

This is an operator contract, not a deployment lease or power-loss certification.
Keep the current state, original HMAC key, opaque mapping, contacts, sessions,
devices, history and pending ciphertext. Never upload the integrity key.

1. Obtain the separate Central single-use deployment/data lease. Stop the sole
   Social writer. Preserve an exact read-only recovery copy of the current state
   and its hash; do not use that copy to overwrite newer accepted operations.
2. Use the exact frozen source of this tool and a raw local integrity-key file:

```sh
go run ./apps/social/tools/state-check --state-file "$SOCIAL_STATE" --integrity-key-file "$SOCIAL_KEY_FILE" --target-reader-schema 6 --action check
go run ./apps/social/tools/state-check --state-file "$SOCIAL_STATE" --integrity-key-file "$SOCIAL_KEY_FILE" --target-reader-schema 6 --action upgrade --writer-stopped
```

3. Start only a reader that supports schema 6 and the same private binding and
   relationship contracts. `check` is read-only; `upgrade` validates the HMAC,
   preserves records, and writes an atomic same-directory schema 6 replacement.
4. Roll back UI/application behavior only while retaining the schema 6-compatible
   Social reader. Do not start the immutable pre-opaque/schema 5 daemon on this
   file. Do not strip `publicIdentities`, messages or relationships, and do not
   recompute a projection to fool the old reader. Such a binary downgrade is NO_GO.
5. A failure before rename keeps the prior file and restores memory. A failure
   after rename keeps the committed in-memory state, returns an error, suspends
   further writes/public identity publication, and requires operator recovery.
   Stop the writer; retain the current file and run:

```sh
go run ./apps/social/tools/state-check --state-file "$SOCIAL_STATE" --integrity-key-file "$SOCIAL_KEY_FILE" --target-reader-schema 6 --action recover --writer-stopped
```

6. Restart the compatible daemon on that current file, preserving the same key.
   Recovery verifies integrity and syncs the containing directory; it does not
   restore old bytes. Failure remains NO_GO. Deploy executor and rollback binary
   hashes must be frozen by Central before issuing the separate release lease.

The filesystem must support same-directory atomic rename and directory fsync;
provision the state directory durably before use. There is no successful durability
acknowledgment on unsupported filesystems. Injection tests are not hardware
power-loss tests. The immutable old-reader rejection must be independently rerun
against this exact candidate; this document does not count as that evidence.
