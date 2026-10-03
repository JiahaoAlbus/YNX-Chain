#include "veil_attachment.h"
#include <stdlib.h>
#include <string.h>

#define MAX_FRAMES ((VEIL_ATTACHMENT_MAX_BYTES + VEIL_ATTACHMENT_CHUNK_BYTES - 1U) / VEIL_ATTACHMENT_CHUNK_BYTES)
#define FRAME_OVERHEAD crypto_secretstream_xchacha20poly1305_ABYTES

static int inputs(const unsigned char *key, const unsigned char *aad, size_t length) {
  return key != NULL && aad != NULL && length > 0 && length <= VEIL_ATTACHMENT_MAX_AAD;
}

void veil_attachment_ciphertext_free(veil_attachment_ciphertext *value) {
  if (value == NULL) return;
  if (value->frames != NULL) {
    for (size_t i = 0; i < value->count; ++i) free(value->frames[i].bytes);
    free(value->frames);
  }
  sodium_memzero(value, sizeof *value);
  free(value);
}

void veil_attachment_plaintext_free(veil_attachment_plaintext *value) {
  if (value == NULL) return;
  if (value->bytes != NULL) {
    sodium_memzero(value->bytes, value->length);
    free(value->bytes);
  }
  sodium_memzero(value, sizeof *value);
  free(value);
}

int veil_attachment_seal(const unsigned char *key, const unsigned char *aad, size_t aad_length,
    const unsigned char *plaintext, size_t length, veil_attachment_ciphertext **output) {
  if (output == NULL || *output != NULL || !inputs(key, aad, aad_length) || plaintext == NULL ||
      length == 0 || length > VEIL_ATTACHMENT_MAX_BYTES) return VEIL_ATTACHMENT_INVALID;
  if (sodium_init() < 0) return VEIL_ATTACHMENT_RESOURCE;
  unsigned char key_copy[crypto_secretstream_xchacha20poly1305_KEYBYTES];
  unsigned char aad_copy[VEIL_ATTACHMENT_MAX_AAD];
  crypto_secretstream_xchacha20poly1305_state state;
  memset(&state, 0, sizeof state);
  memcpy(key_copy, key, sizeof key_copy);
  memcpy(aad_copy, aad, aad_length);
  unsigned char *snapshot = malloc(length);
  veil_attachment_ciphertext *candidate = calloc(1, sizeof *candidate);
  int result = VEIL_ATTACHMENT_RESOURCE;
  if (snapshot == NULL || candidate == NULL) goto done;
  memcpy(snapshot, plaintext, length);
  candidate->count = (length + VEIL_ATTACHMENT_CHUNK_BYTES - 1U) / VEIL_ATTACHMENT_CHUNK_BYTES;
  candidate->frames = calloc(candidate->count, sizeof *candidate->frames);
  if (candidate->frames == NULL) goto done;
  if (crypto_secretstream_xchacha20poly1305_init_push(&state, candidate->header, key_copy) != 0) goto done;
  size_t offset = 0;
  for (size_t i = 0; i < candidate->count; ++i) {
    size_t part = length - offset;
    if (part > VEIL_ATTACHMENT_CHUNK_BYTES) part = VEIL_ATTACHMENT_CHUNK_BYTES;
    veil_attachment_frame *frame = &candidate->frames[i];
    frame->length = part + FRAME_OVERHEAD;
    frame->bytes = malloc(frame->length);
    if (frame->bytes == NULL) goto done;
    unsigned long long written = 0;
    unsigned char tag = i + 1 == candidate->count ? crypto_secretstream_xchacha20poly1305_TAG_FINAL :
        crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    if (crypto_secretstream_xchacha20poly1305_push(&state, frame->bytes, &written,
        snapshot + offset, part, aad_copy, aad_length, tag) != 0 || written != frame->length) goto done;
    offset += part;
  }
  *output = candidate;
  candidate = NULL;
  result = VEIL_ATTACHMENT_OK;
done:
  if (snapshot != NULL) { sodium_memzero(snapshot, length); free(snapshot); }
  veil_attachment_ciphertext_free(candidate);
  sodium_memzero(key_copy, sizeof key_copy);
  sodium_memzero(aad_copy, sizeof aad_copy);
  sodium_memzero(&state, sizeof state);
  return result;
}

int veil_attachment_open(const unsigned char *key, const unsigned char *aad, size_t aad_length,
    const veil_attachment_ciphertext *ciphertext, veil_attachment_plaintext **output) {
  if (output == NULL || *output != NULL || !inputs(key, aad, aad_length) || ciphertext == NULL ||
      ciphertext->frames == NULL || ciphertext->count == 0 || ciphertext->count > MAX_FRAMES)
    return VEIL_ATTACHMENT_INVALID;
  size_t total = 0;
  for (size_t i = 0; i < ciphertext->count; ++i) {
    const veil_attachment_frame *frame = &ciphertext->frames[i];
    if (frame->bytes == NULL || frame->length <= FRAME_OVERHEAD ||
        frame->length > VEIL_ATTACHMENT_CHUNK_BYTES + FRAME_OVERHEAD) return VEIL_ATTACHMENT_INVALID;
    size_t part = frame->length - FRAME_OVERHEAD;
    if (i + 1 < ciphertext->count && part != VEIL_ATTACHMENT_CHUNK_BYTES) return VEIL_ATTACHMENT_INVALID;
    if (part > VEIL_ATTACHMENT_MAX_BYTES - total) return VEIL_ATTACHMENT_INVALID;
    total += part;
  }
  if (sodium_init() < 0) return VEIL_ATTACHMENT_RESOURCE;
  unsigned char key_copy[crypto_secretstream_xchacha20poly1305_KEYBYTES];
  unsigned char aad_copy[VEIL_ATTACHMENT_MAX_AAD];
  unsigned char header[crypto_secretstream_xchacha20poly1305_HEADERBYTES];
  crypto_secretstream_xchacha20poly1305_state state;
  memset(&state, 0, sizeof state);
  memcpy(key_copy, key, sizeof key_copy);
  memcpy(aad_copy, aad, aad_length);
  memcpy(header, ciphertext->header, sizeof header);
  veil_attachment_plaintext *candidate = calloc(1, sizeof *candidate);
  int result = VEIL_ATTACHMENT_RESOURCE;
  if (candidate == NULL) goto done;
  candidate->length = total;
  candidate->bytes = malloc(total);
  if (candidate->bytes == NULL) goto done;
  if (crypto_secretstream_xchacha20poly1305_init_pull(&state, header, key_copy) != 0) {
    result = VEIL_ATTACHMENT_AUTHENTICATION;
    goto done;
  }
  size_t offset = 0;
  for (size_t i = 0; i < ciphertext->count; ++i) {
    const veil_attachment_frame *frame = &ciphertext->frames[i];
    unsigned long long written = 0;
    unsigned char tag = 255;
    unsigned char required = i + 1 == ciphertext->count ? crypto_secretstream_xchacha20poly1305_TAG_FINAL :
        crypto_secretstream_xchacha20poly1305_TAG_MESSAGE;
    if (crypto_secretstream_xchacha20poly1305_pull(&state, candidate->bytes + offset, &written, &tag,
        frame->bytes, frame->length, aad_copy, aad_length) != 0 ||
        written != frame->length - FRAME_OVERHEAD || tag != required) {
      result = VEIL_ATTACHMENT_AUTHENTICATION;
      goto done;
    }
    offset += (size_t) written;
  }
  *output = candidate;
  candidate = NULL;
  result = VEIL_ATTACHMENT_OK;
done:
  veil_attachment_plaintext_free(candidate);
  sodium_memzero(key_copy, sizeof key_copy);
  sodium_memzero(aad_copy, sizeof aad_copy);
  sodium_memzero(header, sizeof header);
  sodium_memzero(&state, sizeof state);
  return result;
}
