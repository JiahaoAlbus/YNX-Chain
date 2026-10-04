#include "veil_backup.h"
#include <sodium.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define BACKUP_OPS UINT64_C(3)
#define BACKUP_MEMORY UINT64_C(67108864)
#define BACKUP_TAG_BYTES 16U
struct veil_backup_blob { unsigned char *bytes; size_t length; int secure; };
static const unsigned char magic[8] = {'V','E','I','L','B','K','0','1'};
_Static_assert(crypto_pwhash_SALTBYTES == 16, "backup salt format");
_Static_assert(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES == 24, "backup nonce format");
_Static_assert(crypto_aead_xchacha20poly1305_ietf_ABYTES == BACKUP_TAG_BYTES, "backup tag format");
static void put64(unsigned char *p, uint64_t value) {
  for (size_t i = 0; i < 8; i++) p[7-i] = (unsigned char)(value >> (i*8));
}
static uint64_t get64(const unsigned char *p) {
  uint64_t value = 0; for (size_t i = 0; i < 8; i++) value = (value << 8) | p[i]; return value;
}
static int inputs(const unsigned char *password, size_t length, const unsigned char *context, veil_backup_blob **output) {
  if (!password || length < 1 || length > 1024 || !context || !output || *output != NULL) return VEIL_BACKUP_INVALID;
  if (sodium_init() < 0 || sodium_is_zero(context, VEIL_BACKUP_CONTEXT_BYTES)) return VEIL_BACKUP_INVALID;
  return VEIL_BACKUP_OK;
}
static veil_backup_blob *allocate(size_t length, int secure) {
  veil_backup_blob *blob = calloc(1, sizeof *blob);
  if (!blob) return NULL;
  blob->length = length; blob->secure = secure;
  blob->bytes = secure ? sodium_malloc(length) : calloc(1, length);
  if (!blob->bytes) { free(blob); return NULL; }
  return blob;
}
void veil_backup_free(veil_backup_blob *blob) {
  if (!blob) return;
  if (blob->bytes) {
    if (blob->secure) sodium_free(blob->bytes);
    else { sodium_memzero(blob->bytes, blob->length); free(blob->bytes); }
  }
  sodium_memzero(blob, sizeof *blob); free(blob);
}
const unsigned char *veil_backup_bytes(const veil_backup_blob *blob) { return blob ? blob->bytes : NULL; }
size_t veil_backup_size(const veil_backup_blob *blob) { return blob ? blob->length : 0; }
static int derive(unsigned char *key, const unsigned char *password, size_t length, const unsigned char *salt) {
  unsigned char *copy = sodium_malloc(length);
  if (!copy) return VEIL_BACKUP_NO_MEMORY;
  if (sodium_mlock(key, crypto_aead_xchacha20poly1305_ietf_KEYBYTES) != 0 || sodium_mlock(copy, length) != 0) {
    sodium_free(copy); return VEIL_BACKUP_MEMORY_LOCK_DENIED;
  }
  memcpy(copy, password, length);
  int status = crypto_pwhash(key, crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
                           (const char *)copy, (unsigned long long)length, salt,
                           BACKUP_OPS, (size_t)BACKUP_MEMORY, crypto_pwhash_ALG_ARGON2ID13);
  sodium_free(copy);
  return status == 0 ? VEIL_BACKUP_OK : VEIL_BACKUP_KDF_FAILED;
}
int veil_backup_seal(const unsigned char *payload, size_t length, const unsigned char *password,
                     size_t password_length, const unsigned char context[VEIL_BACKUP_CONTEXT_BYTES], veil_backup_blob **output) {
  int status = inputs(password, password_length, context, output);
  if (status != VEIL_BACKUP_OK) return status;
  if (!payload || length < 1 || length > VEIL_BACKUP_MAX_BYTES) return VEIL_BACKUP_INVALID;
  veil_backup_blob *candidate = allocate(VEIL_BACKUP_HEADER_BYTES + length + BACKUP_TAG_BYTES, 0);
  unsigned char *key = sodium_malloc(crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  if (!candidate || !key) { veil_backup_free(candidate); if (key) sodium_free(key); return VEIL_BACKUP_NO_MEMORY; }
  unsigned char *h = candidate->bytes;
  memcpy(h, magic, sizeof magic); h[8] = 1; h[9] = 1;
  put64(h+16, BACKUP_OPS); put64(h+24, BACKUP_MEMORY); put64(h+32, (uint64_t)length);
  randombytes_buf(h+40, 16); randombytes_buf(h+56, 24); memcpy(h+80, context, 32);
  status = derive(key, password, password_length, h+40);
  unsigned long long written = 0;
  if (status == VEIL_BACKUP_OK &&
      (crypto_aead_xchacha20poly1305_ietf_encrypt(h+VEIL_BACKUP_HEADER_BYTES, &written,
         payload, (unsigned long long)length, h, VEIL_BACKUP_HEADER_BYTES, NULL, h+56, key) != 0 ||
       written != length + BACKUP_TAG_BYTES)) status = VEIL_BACKUP_AUTH_FAILED;
  sodium_free(key);
  if (status != VEIL_BACKUP_OK) { veil_backup_free(candidate); return status; }
  *output = candidate; return VEIL_BACKUP_OK;
}
int veil_backup_open(const unsigned char *backup, size_t length, const unsigned char *password,
                     size_t password_length, const unsigned char expected_context[VEIL_BACKUP_CONTEXT_BYTES], veil_backup_blob **output) {
  int status = inputs(password, password_length, expected_context, output);
  if (status != VEIL_BACKUP_OK) return status;
  if (!backup || length < VEIL_BACKUP_HEADER_BYTES + BACKUP_TAG_BYTES + 1 ||
      length > VEIL_BACKUP_HEADER_BYTES + VEIL_BACKUP_MAX_BYTES + BACKUP_TAG_BYTES) return VEIL_BACKUP_INVALID;
  if (memcmp(backup, magic, sizeof magic) || backup[8] != 1 || backup[9] != 1 ||
      !sodium_is_zero(backup+10, 6) || get64(backup+16) != BACKUP_OPS || get64(backup+24) != BACKUP_MEMORY) return VEIL_BACKUP_UNSUPPORTED;
  uint64_t payload_length = get64(backup+32);
  if (payload_length < 1 || payload_length > VEIL_BACKUP_MAX_BYTES ||
      length != VEIL_BACKUP_HEADER_BYTES + (size_t)payload_length + BACKUP_TAG_BYTES) return VEIL_BACKUP_INVALID;
  if (sodium_memcmp(backup+80, expected_context, 32) != 0) return VEIL_BACKUP_CONTEXT_MISMATCH;
  veil_backup_blob *candidate = allocate((size_t)payload_length, 1);
  unsigned char *key = sodium_malloc(crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  if (!candidate || !key) { veil_backup_free(candidate); if (key) sodium_free(key); return VEIL_BACKUP_NO_MEMORY; }
  if (sodium_mlock(candidate->bytes, candidate->length) != 0) status = VEIL_BACKUP_MEMORY_LOCK_DENIED;
  else status = derive(key, password, password_length, backup+40);
  unsigned long long written = 0;
  if (status == VEIL_BACKUP_OK &&
      (crypto_aead_xchacha20poly1305_ietf_decrypt(candidate->bytes, &written, NULL,
         backup+VEIL_BACKUP_HEADER_BYTES, length-VEIL_BACKUP_HEADER_BYTES, backup, VEIL_BACKUP_HEADER_BYTES,
         backup+56, key) != 0 || written != payload_length)) status = VEIL_BACKUP_AUTH_FAILED;
  sodium_free(key);
  if (status != VEIL_BACKUP_OK) { veil_backup_free(candidate); return status; }
  *output = candidate; return VEIL_BACKUP_OK;
}
