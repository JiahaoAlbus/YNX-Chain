#ifndef VEIL_CLASSIC_PRIVATE_PROTECTION_H
#define VEIL_CLASSIC_PRIVATE_PROTECTION_H
#include "veil_pq_custodian.h"
enum { VEIL_CLASSIC_SERIALIZED_MAX=256, VEIL_CLASSIC_CIPHER_MAX=272 };
typedef struct {uint32_t version,aad_size,ciphertext_size;uint8_t aad[VEIL_OWN_AAD_MAX],nonce[12],ciphertext[272];} veil_classic_record;
/* Private CryptoEngine borrowed native spans only; no Java/JS getter.
 * Payload is EXACT Hyp selected IdentityKeyPair serialized bytes. C never
 * claims deserialize/public-correspondence: actual selected Rust body does it.
 */
typedef struct {
 void *context;
 veil_own_result (*seal)(void *,const uint8_t *,size_t,const uint8_t *,size_t,uint8_t nonce[12],uint8_t *,size_t,size_t *);
 veil_own_result (*unseal)(void *,const uint8_t *,size_t,const uint8_t nonce[12],const uint8_t *,size_t,uint8_t *,size_t,size_t *);
} veil_classic_protector;
veil_own_result veil_classic_aad(const veil_own_binding *,const uint8_t pq_public[2592],size_t selected_serialized_size,uint8_t out[VEIL_OWN_AAD_MAX],size_t *);
veil_own_result veil_classic_seal_native(const veil_own_binding *,const uint8_t pq_public[2592],const uint8_t *borrowed_selected_serialized,size_t,const veil_classic_protector *,veil_classic_record *);
veil_own_result veil_classic_unseal_native(const veil_own_binding *,const uint8_t pq_public[2592],const veil_classic_record *,const veil_classic_protector *,uint8_t *owned_native_output,size_t,size_t *);
#endif
