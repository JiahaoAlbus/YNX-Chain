#ifndef VEIL_PQ_PRIVATE_CUSTODIAN_H
#define VEIL_PQ_PRIVATE_CUSTODIAN_H
#include <stddef.h>
#include <stdint.h>
/* PRIVATE CryptoEngine C ABI candidate. Not a Java/JS secret API or grant.
 * No public admission constructor, identity allocator or trust callback. */
typedef struct veil_pq_custodian veil_pq_custodian;
enum { VEIL_OWN_SECRET=4896, VEIL_OWN_PUBLIC=2592, VEIL_OWN_CLASSIC=33,
 VEIL_OWN_NONCE=12, VEIL_OWN_TAG=16, VEIL_OWN_CIPHER=4912,
 VEIL_OWN_AAD_MAX=7168, VEIL_OWN_BINDING_MAX=4096, VEIL_OWN_CAPACITY=32 };
typedef enum { VEIL_OWN_OK=0, VEIL_OWN_INVALID=1, VEIL_OWN_MEMORY=2,
 VEIL_OWN_UNAVAILABLE=3, VEIL_OWN_AUTH_FAILED=4, VEIL_OWN_UNKNOWN=5,
 VEIL_OWN_WRONG_THREAD=6, VEIL_OWN_CONSISTENCY_FAILED=7,
 VEIL_OWN_NO_RETRY=8, VEIL_OWN_JAVA_PRIMARY=9 } veil_own_result;
typedef struct {
 const char *alias; /* exact ynx.social.ownkey.v1. + 32 lowercase hex */
 uint64_t generation;
 const uint8_t *classic_public; /* 33 bytes, selected libsignal prefix 5 */
 const uint8_t *owner_binding; /* frozen normal source/store/bootstrap association */
 size_t owner_binding_size;
} veil_own_binding;
typedef struct {
 uint32_t version, aad_size;
 uint8_t aad[VEIL_OWN_AAD_MAX], nonce[VEIL_OWN_NONCE], ciphertext[VEIL_OWN_CIPHER];
} veil_own_record; /* In-memory only. Never persist sizeof(struct). */
/* Actual Android adapter supplies ONLY authenticated AES256/GCM encryption.
 * clear is a borrowed mandatory-locked native span valid for this synchronous
 * call only; no retain/export. decrypt success writes exactly4896 bytes, only
 * after tag validation; C wipes on any failure/partial result. Callbacks never
 * mean source authorization or durability. Never call under registry mutex.
 */
typedef struct {
 void *context;
 veil_own_result (*seal)(void *, const uint8_t *, size_t, const uint8_t *, size_t,
     uint8_t nonce[12], uint8_t ciphertext[4912], size_t *written);
 veil_own_result (*unseal)(void *, const uint8_t *, size_t, const uint8_t nonce[12],
     const uint8_t ciphertext[4912], uint8_t *locked_clear, size_t, size_t *written);
} veil_own_protector;
veil_own_result veil_own_aad(const veil_own_binding *, const uint8_t public_key[2592],
    uint8_t out[VEIL_OWN_AAD_MAX], size_t *written);
veil_own_result veil_own_record_encode(const veil_own_record *, uint8_t *, size_t, size_t *);
veil_own_result veil_own_record_decode(const uint8_t *, size_t, veil_own_record *);
/* out MUST initially be NULL. On key creation followed by seal UNKNOWN/error,
 * *out retains the original custodian, record is wiped, no implicit retry.
 * Successful sealing != disk commit, firsttrust or accepted native owner.
 */
veil_own_result veil_own_create_sealed(const veil_own_binding *, const veil_own_protector *,
    veil_pq_custodian **out, veil_own_record *);
/* expected_public is original protected/public binding, NOT caller UI trust.
 * Authenticated bytes are fed directly into native mandatory-locked allocation;
 * adopted only after selected pk_from_sk consistency and expected public match.
 */
veil_own_result veil_own_reload(const veil_own_binding *, const uint8_t expected_public[2592],
    const veil_own_record *, const veil_own_protector *, veil_pq_custodian **out);
veil_own_result veil_own_public(const veil_pq_custodian *, uint8_t out[2592]);
veil_own_result veil_own_sign_public_proof(const veil_pq_custodian *, const uint8_t *, size_t,
    uint8_t signature[4627], size_t *written);
veil_own_result veil_own_close(veil_pq_custodian **);
#endif
