#include "veil_attachment.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define CHECK(condition) do { if (!(condition)) { fprintf(stderr, "FAIL line %d\n", __LINE__); exit(1); } ++checks; } while (0)

int main(void) {
  int checks = 0;
  CHECK(sodium_init() >= 0);
  unsigned char key[crypto_secretstream_xchacha20poly1305_KEYBYTES];
  unsigned char wrong_key[sizeof key];
  const unsigned char aad[] = "synthetic independently bound attachment metadata";
  crypto_secretstream_xchacha20poly1305_keygen(key);
  crypto_secretstream_xchacha20poly1305_keygen(wrong_key);
  size_t size = 2 * VEIL_ATTACHMENT_CHUNK_BYTES + 123;
  unsigned char *body = malloc(size);
  CHECK(body != NULL);
  randombytes_buf(body, size);
  veil_attachment_ciphertext *cipher = NULL;
  veil_attachment_ciphertext *second = NULL;
  veil_attachment_plaintext *plain = NULL;
  CHECK(veil_attachment_seal(key, aad, sizeof aad, body, size, &cipher) == 0);
  CHECK(cipher->count == 3);
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == 0);
  CHECK(plain->length == size && memcmp(plain->bytes, body, size) == 0);
  veil_attachment_plaintext_free(plain); plain = NULL;
  CHECK(veil_attachment_seal(key, aad, sizeof aad, body, size, &second) == 0);
  CHECK(memcmp(cipher->header, second->header, sizeof cipher->header) != 0);
  CHECK(veil_attachment_open(wrong_key, aad, sizeof aad, cipher, &plain) != 0 && plain == NULL);
  CHECK(veil_attachment_open(key, (const unsigned char *) "wrong metadata", 14, cipher, &plain) != 0 && plain == NULL);
  cipher->frames[1].bytes[10] ^= 1;
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) != 0 && plain == NULL);
  cipher->frames[1].bytes[10] ^= 1;
  veil_attachment_frame swap = cipher->frames[0];
  cipher->frames[0] = cipher->frames[1]; cipher->frames[1] = swap;
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) != 0 && plain == NULL);
  swap = cipher->frames[0]; cipher->frames[0] = cipher->frames[1]; cipher->frames[1] = swap;
  cipher->count = 2;
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) != 0 && plain == NULL);
  cipher->count = 3;
  size_t original_length = cipher->frames[2].length;
  cipher->frames[2].length--;
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) != 0 && plain == NULL);
  cipher->frames[2].length = original_length;
  cipher->header[0] ^= 1;
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) != 0 && plain == NULL);
  cipher->header[0] ^= 1;
  CHECK(veil_attachment_open(key, aad, sizeof aad, cipher, &plain) == 0);
  CHECK(plain->length == size && memcmp(plain->bytes, body, size) == 0);
  veil_attachment_plaintext_free(plain); plain = NULL;
  CHECK(veil_attachment_seal(key, aad, sizeof aad, body, 0, &second) == VEIL_ATTACHMENT_INVALID);
  CHECK(veil_attachment_seal(key, aad, sizeof aad, body, VEIL_ATTACHMENT_MAX_BYTES + 1U, &second) == VEIL_ATTACHMENT_INVALID);
  CHECK(veil_attachment_open(key, aad, 0, cipher, &plain) == VEIL_ATTACHMENT_INVALID && plain == NULL);
  veil_attachment_ciphertext_free(cipher);
  veil_attachment_ciphertext_free(second);
  sodium_memzero(body, size); free(body);
  sodium_memzero(key, sizeof key); sodium_memzero(wrong_key, sizeof wrong_key);
  printf("PASS native secretstream checks=%d libsodium=%s; synthetic only; no platform/admission/wire proof\n", checks, sodium_version_string());
  return 0;
}
