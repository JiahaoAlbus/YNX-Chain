#include "veil_attachment.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Compile ONLY the original attachment implementation with allocator/lock
 * symbol substitution. This test calls real libsodium for all successful work.
 * Synthetic test keys only; no platform authority or shipping adapter. */
static int allocations, locks, outstanding, fail_allocation, fail_lock, checks;
#define CHECK(v) do { if (!(v)) { fprintf(stderr, "FAIL line %d\n", __LINE__); exit(1); } ++checks; } while (0)

void *veil_attachment_qa_malloc(size_t length) {
  ++allocations;
  if (allocations == fail_allocation) return NULL;
  void *value = sodium_malloc(length);
  if (value != NULL) ++outstanding;
  return value;
}

int veil_attachment_qa_mlock(void *value, size_t length) {
  ++locks;
  return locks == fail_lock ? -1 : sodium_mlock(value, length);
}

void veil_attachment_qa_free(void *value) {
  if (value != NULL) { CHECK(outstanding > 0); --outstanding; sodium_free(value); }
}

static void failure_at(int allocation, int lock) {
  CHECK(outstanding == 0);
  allocations = locks = 0;
  fail_allocation = allocation;
  fail_lock = lock;
}

int main(void) {
  CHECK(sodium_init() >= 0);
  unsigned char key[crypto_secretstream_xchacha20poly1305_KEYBYTES];
  unsigned char body[VEIL_ATTACHMENT_CHUNK_BYTES + 3];
  const unsigned char aad[] = "synthetic memory-policy metadata";
  crypto_secretstream_xchacha20poly1305_keygen(key);
  randombytes_buf(body, sizeof body);
  veil_attachment_ciphertext *cipher = NULL;
  veil_attachment_plaintext *plain = NULL;
  failure_at(0, 0);
  CHECK(veil_attachment_seal(key, aad, sizeof aad, body, sizeof body, &cipher) == VEIL_ATTACHMENT_OK);
  CHECK(allocations == 2 && locks == 2 && outstanding == 0);
  for (int ordinal = 1; ordinal <= 2; ++ordinal) {
    veil_attachment_ciphertext *rejected = NULL;
    failure_at(ordinal, 0);
    CHECK(veil_attachment_seal(key, aad, sizeof aad, body, sizeof body, &rejected) == VEIL_ATTACHMENT_RESOURCE);
    CHECK(rejected == NULL && outstanding == 0);
    failure_at(0, ordinal);
    CHECK(veil_attachment_seal(key, aad, sizeof aad, body, sizeof body, &rejected) == VEIL_ATTACHMENT_MEMORY_LOCK_DENIED);
    CHECK(rejected == NULL && outstanding == 0);
    failure_at(ordinal, 0);
    CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == VEIL_ATTACHMENT_RESOURCE);
    CHECK(plain == NULL && outstanding == 0);
    failure_at(0, ordinal);
    CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == VEIL_ATTACHMENT_MEMORY_LOCK_DENIED);
    CHECK(plain == NULL && outstanding == 0);
  }
  failure_at(0, 0);
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == VEIL_ATTACHMENT_OK);
  CHECK(locks == 2 && outstanding == 1);
  CHECK(plain->length == sizeof body && memcmp(plain->bytes, body, sizeof body) == 0);
  veil_attachment_plaintext_free(plain); plain = NULL;
  CHECK(outstanding == 0);
  cipher->frames[1].bytes[0] ^= 1;
  failure_at(0, 0);
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == VEIL_ATTACHMENT_AUTHENTICATION);
  CHECK(plain == NULL && outstanding == 0);
  cipher->frames[1].bytes[0] ^= 1;
  failure_at(0, 0);
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == VEIL_ATTACHMENT_OK);
  CHECK(plain->length == sizeof body && memcmp(plain->bytes, body, sizeof body) == 0);
  veil_attachment_plaintext_free(plain);
  CHECK(outstanding == 0);
  veil_attachment_ciphertext_free(cipher);
  sodium_memzero(key, sizeof key);
  sodium_memzero(body, sizeof body);
  printf("PASS attachment protected-memory checks=%d libsodium=%s; injected allocation/lock denial and real crypto; no platform proof\n", checks, sodium_version_string());
  return 0;
}
