#ifndef YNX_VEIL_BACKUP_H
#define YNX_VEIL_BACKUP_H
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
#define VEIL_BACKUP_CONTEXT_BYTES 32U
#define VEIL_BACKUP_HEADER_BYTES 112U
#define VEIL_BACKUP_MAX_BYTES (8U * 1024U * 1024U)
typedef struct veil_backup_blob veil_backup_blob;
enum veil_backup_status {
  VEIL_BACKUP_OK = 0, VEIL_BACKUP_INVALID = -1,
  VEIL_BACKUP_UNSUPPORTED = -2, VEIL_BACKUP_NO_MEMORY = -3,
  VEIL_BACKUP_AUTH_FAILED = -4, VEIL_BACKUP_CONTEXT_MISMATCH = -5,
  VEIL_BACKUP_MEMORY_LOCK_DENIED = -6, VEIL_BACKUP_KDF_FAILED = -7
};
/* Output must initially be NULL; failure never replaces an existing object.
 * Payload is an opaque, already validated native SDK export. These functions
 * neither export actual keys nor authorize backup/restore or install state.
 * Password and expected context are caller-owned, never logged or modified.
 */
int veil_backup_seal(const unsigned char *payload, size_t payload_bytes,
                     const unsigned char *password, size_t password_bytes,
                     const unsigned char context[VEIL_BACKUP_CONTEXT_BYTES],
                     veil_backup_blob **output);
int veil_backup_open(const unsigned char *backup, size_t backup_bytes,
                     const unsigned char *password, size_t password_bytes,
                     const unsigned char expected_context[VEIL_BACKUP_CONTEXT_BYTES],
                     veil_backup_blob **output);
const unsigned char *veil_backup_bytes(const veil_backup_blob *blob);
size_t veil_backup_size(const veil_backup_blob *blob);
void veil_backup_free(veil_backup_blob *blob);
#ifdef __cplusplus
}
#endif
#endif
