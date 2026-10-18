#ifndef VEIL_STORE_CUSTODY_H
#define VEIL_STORE_CUSTODY_H
#include "veil_checked_store.h"
#include <sqlite3.h>
/* PRIVATE software diagnostics, NOT admitted binding, grant or restore proof.
 * No retained sqlite3 pointer/cursor, no raw FD accessor, no Java/JNI factory.
 * All calls and destruction on creating thread. Caller exclusively owns the
 * existing SQLite connection/transaction for each synchronous call. */
#define VEIL_CUSTODY_SCHEMA_MAX 32768u
#define VEIL_CUSTODY_OBJECT_MAX 32u
#define VEIL_CUSTODY_PATH_MAX 4096u
typedef struct veil_custody_watch veil_custody_watch;
typedef struct {
  /* Always UNTRUSTED_LOCAL_FACTS (0): no public enum can promote these. */
  unsigned trust;
  uint64_t process_uid,process_euid,file_uid,file_gid,file_device,file_inode;
  uint64_t parent_device,parent_inode;
  uint32_t file_mode,parent_mode;
  int sqlite_has_moved,sqlite_readonly,schema_version,user_version;
  int64_t checkpoint_revision,record_count,record_bytes;
  size_t schema_size,schema_objects;
  /* Exact length-prefixed sqlite_schema metadata, not a new wire codec.
   * Includes original SQL text/index rows, excludes record values/BLOBs.
   * Genuine issuer must compare exact approved schema and inode/path/restore
   * association under its OWN authentic same-source lock. No local restore ID. */
  unsigned char schema[VEIL_CUSTODY_SCHEMA_MAX];
} veil_custody_facts;
/* Opens ONLY existing POSIX regular file O_RDONLY/O_NOFOLLOW, every directory
 * component no symlink. Final parent0700, file0600/single-link/current euid.
 * No create, chmod, truncate, SQL write or automatic restore initialization. */
veil_store_status veil_custody_watch_open(const char *,veil_custody_watch **);
veil_store_status veil_custody_watch_check(sqlite3 *,veil_custody_watch *);
/* Requires already-established caller READ/WRITE snapshot (txn_state); no BEGIN/COMMIT or
 * connection configuration by helper. Layout limits precede SQL materialization.
 * Fixed-size caller output clears on error. Facts do not escape a lease lifetime
 * as authority; caller may copy them only as untrusted local diagnostics. */
veil_store_status veil_custody_read(sqlite3 *,veil_custody_watch *,veil_custody_facts *);
veil_store_status veil_custody_watch_drop(veil_custody_watch **);
/* Native store wrapper: no raw DB getter, requires owner/held source/active txn.
 * Binding remains independently admitted; this function never constructs it. */
veil_store_status veil_private_store_custody_read(veil_checked_store *,veil_custody_facts *);
#endif
