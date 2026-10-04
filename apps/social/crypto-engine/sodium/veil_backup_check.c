#include "veil_backup.h"
#include <sodium.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static int checks;
#define CHECK(value) do { checks++; if (!(value)) { fprintf(stderr, "FAIL backup check=%d line=%d\n", checks, __LINE__); exit(1); } } while (0)
int main(void) {
  CHECK(sodium_init() >= 0);
  CHECK(strcmp(sodium_version_string(), "1.0.22") == 0);
  const unsigned char password[] = "synthetic-user-held-passphrase-only";
  const unsigned char wrong[] = "synthetic-wrong-passphrase-only";
  unsigned char context[32], other_context[32], payload[] = {1,0,2,0,3,255,4,0,5};
  crypto_hash_sha256(context, (const unsigned char *)"synthetic-backup-context", 24);
  memcpy(other_context, context, 32); other_context[0] ^= 1;
  veil_backup_blob *sealed = NULL, *second = NULL, *opened = NULL;
  CHECK(veil_backup_seal(payload, sizeof payload, password, sizeof password-1, context, &sealed) == VEIL_BACKUP_OK);
  CHECK(veil_backup_size(sealed) == VEIL_BACKUP_HEADER_BYTES + sizeof payload + 16);
  CHECK(veil_backup_open(veil_backup_bytes(sealed), veil_backup_size(sealed), password, sizeof password-1, context, &opened) == VEIL_BACKUP_OK);
  CHECK(veil_backup_size(opened) == sizeof payload && memcmp(veil_backup_bytes(opened), payload, sizeof payload) == 0);
  veil_backup_blob *original = opened;
  CHECK(veil_backup_open(veil_backup_bytes(sealed), veil_backup_size(sealed), password, sizeof password-1, context, &opened) == VEIL_BACKUP_INVALID && opened == original);
  veil_backup_free(opened); opened = NULL;
  CHECK(veil_backup_open(veil_backup_bytes(sealed), veil_backup_size(sealed), wrong, sizeof wrong-1, context, &opened) == VEIL_BACKUP_AUTH_FAILED && opened == NULL);
  CHECK(veil_backup_open(veil_backup_bytes(sealed), veil_backup_size(sealed), password, sizeof password-1, other_context, &opened) == VEIL_BACKUP_CONTEXT_MISMATCH && opened == NULL);
  CHECK(veil_backup_open(veil_backup_bytes(sealed), veil_backup_size(sealed)-1, password, sizeof password-1, context, &opened) == VEIL_BACKUP_INVALID);
  unsigned char *mutated = malloc(veil_backup_size(sealed)); CHECK(mutated != NULL);
  const size_t offsets[] = {0,8,9,10,16,24,32,40,56,80,VEIL_BACKUP_HEADER_BYTES};
  for (size_t i = 0; i < sizeof offsets/sizeof offsets[0]; i++) {
    memcpy(mutated, veil_backup_bytes(sealed), veil_backup_size(sealed)); mutated[offsets[i]] ^= 1;
    CHECK(veil_backup_open(mutated, veil_backup_size(sealed), password, sizeof password-1, context, &opened) != VEIL_BACKUP_OK && opened == NULL);
  }
  CHECK(veil_backup_seal(payload, sizeof payload, password, sizeof password-1, context, &second) == VEIL_BACKUP_OK);
  CHECK(memcmp(veil_backup_bytes(sealed)+40, veil_backup_bytes(second)+40, 40) != 0);
  CHECK(veil_backup_seal(payload, VEIL_BACKUP_MAX_BYTES+1, password, sizeof password-1, context, &opened) == VEIL_BACKUP_INVALID);
  CHECK(veil_backup_open(mutated, 0, password, sizeof password-1, context, &opened) == VEIL_BACKUP_INVALID);
  CHECK(veil_backup_seal(payload, sizeof payload, password, 0, context, &opened) == VEIL_BACKUP_INVALID);
  memset(other_context, 0, 32);
  CHECK(veil_backup_seal(payload, sizeof payload, password, sizeof password-1, other_context, &opened) == VEIL_BACKUP_INVALID);
  free(mutated); veil_backup_free(second); veil_backup_free(sealed); veil_backup_free(NULL);
  printf("PASS backup checks=%d libsodium=%s; synthetic only; no native export/platform/activation proof\n", checks, sodium_version_string());
  return 0;
}
