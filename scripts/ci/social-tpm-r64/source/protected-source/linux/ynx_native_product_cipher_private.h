#ifndef YNX_NATIVE_PRODUCT_CIPHER_PRIVATE_H
#define YNX_NATIVE_PRODUCT_CIPHER_PRIVATE_H
#include "ynx_native_product_record_limits.h"
#include "ynx_source_platform_qualified.h"
/* Private product-data AAD; not a Source capability, signing domain or grant.
 * Existing message1..6 and bootstrap7 wire formats remain unchanged. */
typedef struct {uint32_t version,namespace_id,tombstone,reserved;
 uint64_t storage_generation,base_version,next_version,policy_generation,deadline;
 unsigned char store_reference[32],device_binding_digest[32],intent[32],policy_head[32],selector[32],previous_cipher_digest[32],plaintext_digest[32],storage_nonce[12];
} ynx_product_cipher_expected_v1;
veil_store_status ynx_product_cipher_seal_v1(const unsigned char key[32],const ynx_product_cipher_expected_v1 *,ynx_original_bytes,ynx_storage_ciphertext *);
veil_store_status ynx_product_cipher_open_v1(const unsigned char key[32],const ynx_product_cipher_expected_v1 *,ynx_original_bytes,unsigned char *,size_t,size_t *);
#endif
