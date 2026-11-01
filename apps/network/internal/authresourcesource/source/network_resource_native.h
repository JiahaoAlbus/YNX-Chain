#ifndef YNX_NETWORK_RESOURCE_NATIVE_V1_H
#define YNX_NETWORK_RESOURCE_NATIVE_V1_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_network_source_v1 ynx_network_source_v1;
typedef struct ynx_network_context_v1 ynx_network_context_v1;
typedef struct ynx_network_review_v1 ynx_network_review_v1;
typedef struct ynx_network_consent_v1 ynx_network_consent_v1;
typedef struct ynx_network_claim_v1 ynx_network_claim_v1;
typedef struct ynx_network_permission_v1 ynx_network_permission_v1;
enum ynx_network_original_kind_v1 {YNX_NETWORK_MANIFEST=1,YNX_NETWORK_CONSENT=2,YNX_NETWORK_INPUT=3,YNX_NETWORK_ISSUER_MAPPING=4,YNX_NETWORK_PRINCIPAL_MAPPING=5,YNX_NETWORK_ISSUER_CURRENT=6,YNX_NETWORK_PRINCIPAL_CURRENT=7,YNX_NETWORK_ISSUER_REGISTRATION=8,YNX_NETWORK_PRINCIPAL_REGISTRATION=9,YNX_NETWORK_SCOPE=10};
typedef struct{int32_t code;uint32_t error_present;}ynx_network_error_v1;
typedef struct{uint32_t physical_complete;ynx_network_error_v1 error;}ynx_network_drain_v1;
/* Root-selected only; nonnull outputs are original partial custody BEFORE
 * error interpretation. No caller scope/path/endpoint/boolean/provider input.
 * Process identities are non-reused bounded tombstones, not caller-freed. */
ynx_network_error_v1 ynx_network_source_acquire_v1(ynx_network_source_v1**,ynx_network_context_v1**);
ynx_network_error_v1 ynx_network_source_current_v1(ynx_network_source_v1*,ynx_network_context_v1*);
ynx_network_error_v1 ynx_network_source_read_v1(ynx_network_source_v1*,ynx_network_context_v1*,uint32_t,unsigned char*,size_t,size_t*);
/* direction1 manifest /2 consent. Payload must be exact original canonical
 * Work/Consent bytes, never sandbox-domain wrapper or reconstructed JSON.
 * Independent protected mappings supply signer/current; member never does. */
ynx_network_error_v1 ynx_network_source_verify_v1(ynx_network_source_v1*,ynx_network_context_v1*,uint32_t,const unsigned char*,size_t,const unsigned char*,size_t);
ynx_network_error_v1 ynx_network_source_input_ref_v1(ynx_network_source_v1*,ynx_network_context_v1*,unsigned char*,size_t,size_t*);
ynx_network_error_v1 ynx_network_source_consumer_identity_v1(ynx_network_source_v1*,ynx_network_context_v1*,unsigned char*,size_t,size_t*);
ynx_network_error_v1 ynx_network_source_current_ref_v1(ynx_network_source_v1*,ynx_network_context_v1*,unsigned char*,size_t,size_t*);
ynx_network_error_v1 ynx_network_source_borrow_permission_v1(ynx_network_source_v1*,ynx_network_context_v1*,ynx_network_permission_v1**);
/* Pure same-original permission, not a Source refresh or IO under Store lock. */
int32_t ynx_network_permission_current_no_io_v1(ynx_network_permission_v1*);
ynx_network_drain_v1 ynx_network_permission_close_v1(ynx_network_permission_v1*);
ynx_network_error_v1 ynx_network_source_claim_once_v1(ynx_network_source_v1*,ynx_network_context_v1*,ynx_network_claim_v1**);
ynx_network_error_v1 ynx_network_claim_read_original_v1(ynx_network_claim_v1*,unsigned char*,size_t,size_t*);
int32_t ynx_network_claim_current_no_io_v1(ynx_network_claim_v1*);
ynx_network_drain_v1 ynx_network_claim_close_v1(ynx_network_claim_v1*);
ynx_network_error_v1 ynx_network_source_retire_v1(ynx_network_source_v1*);
ynx_network_drain_v1 ynx_network_source_join_v1(ynx_network_source_v1*);
ynx_network_drain_v1 ynx_network_source_close_v1(ynx_network_source_v1*);
/* Actual review frame, protected pending approval and protected typed signer
 * are separate stages. Missing pending/signer refuses even if math/data pass.
 * There is deliberately no approve(bool), private-key import or callback. */
ynx_network_error_v1 ynx_network_review_prepare_v1(ynx_network_source_v1*,ynx_network_context_v1*,ynx_network_review_v1**);
ynx_network_error_v1 ynx_network_consent_produce_v1(ynx_network_source_v1*,ynx_network_review_v1*,ynx_network_context_v1*,ynx_network_consent_v1**);
#ifdef __cplusplus
}
#endif
#endif
