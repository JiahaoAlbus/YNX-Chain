#ifndef YNX_VEIL_ATTACHMENT_H
#define YNX_VEIL_ATTACHMENT_H

#include <stddef.h>
#include <sodium.h>

/* Dormant native algorithm component, NOT a wire format or trust authority.
 * Caller supplies a protected native key and independently admitted metadata.
 * Never expose these keys/handles to JS. Production admission/atomic storage,
 * transport framing and platform integration are intentionally not provided.
 * Handles and input buffers require exclusive native caller ownership. */
#define VEIL_ATTACHMENT_MAX_BYTES (25U * 1024U * 1024U)
#define VEIL_ATTACHMENT_CHUNK_BYTES (64U * 1024U)
#define VEIL_ATTACHMENT_MAX_AAD 4096U

typedef struct {
  unsigned char *bytes;
  size_t length;
} veil_attachment_frame;

typedef struct {
  unsigned char header[crypto_secretstream_xchacha20poly1305_HEADERBYTES];
  veil_attachment_frame *frames;
  size_t count;
} veil_attachment_ciphertext;

typedef struct {
  unsigned char *bytes;
  size_t length;
} veil_attachment_plaintext;

enum {
  VEIL_ATTACHMENT_OK = 0,
  VEIL_ATTACHMENT_INVALID = -1,
  VEIL_ATTACHMENT_RESOURCE = -2,
  VEIL_ATTACHMENT_AUTHENTICATION = -3,
  VEIL_ATTACHMENT_MEMORY_LOCK_DENIED = -4
};

int veil_attachment_seal(const unsigned char key[crypto_secretstream_xchacha20poly1305_KEYBYTES],
    const unsigned char *aad, size_t aad_length, const unsigned char *plaintext,
    size_t length, veil_attachment_ciphertext **output);
int veil_attachment_open(const unsigned char key[crypto_secretstream_xchacha20poly1305_KEYBYTES],
    const unsigned char *aad, size_t aad_length, const veil_attachment_ciphertext *ciphertext,
    veil_attachment_plaintext **output);
void veil_attachment_ciphertext_free(veil_attachment_ciphertext *value);
void veil_attachment_plaintext_free(veil_attachment_plaintext *value);

#endif
