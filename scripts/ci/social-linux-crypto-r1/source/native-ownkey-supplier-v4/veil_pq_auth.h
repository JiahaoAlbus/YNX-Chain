#ifndef VEIL_PQ_AUTH_CANDIDATE_H
#define VEIL_PQ_AUTH_CANDIDATE_H
#include <stddef.h>
#include <stdint.h>

/* Dormant primitive candidate, not a handshake or an authorization policy.
 * All secret material stays behind this opaque native pointer. No serialization,
 * secret import/export, JNI, JS, UI or production factory is supplied. */
typedef struct veil_pq_key veil_pq_key;
enum { VEIL_PQ_PUBLIC_BYTES = 2592, VEIL_PQ_SIGNATURE_BYTES = 4627,
       VEIL_PQ_MAX_PUBLIC_INPUT = 65536 };

veil_pq_key *veil_pq_key_generate(void);
void veil_pq_key_destroy(veil_pq_key *key);
int veil_pq_public(const veil_pq_key *key, uint8_t *out, size_t capacity);
/* Pure FIPS 204 ML-DSA-87, fixed ASCII context YNX/SOCIAL/PQ-AUTH/V1.
 * Caller owns canonical M validation, trusted key resolution and native lease.
 * Signing public bytes does NOT establish trust, replay safety or confirmation. */
int veil_pq_sign(const veil_pq_key *key, const uint8_t *message, size_t size,
                 uint8_t *signature, size_t capacity, size_t *written);
int veil_pq_verify(const uint8_t *public_key, size_t public_size,
                   const uint8_t *message, size_t size,
                   const uint8_t *signature, size_t signature_size);
#endif
