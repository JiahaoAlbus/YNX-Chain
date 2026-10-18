#ifndef YNX_WALLET_PQ_ANDROID_V1_H
#define YNX_WALLET_PQ_ANDROID_V1_H
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
#ifndef YNX_WALLET_PQ_ORIGINAL_LINKAGE
#define YNX_WALLET_PQ_ORIGINAL_LINKAGE
#endif
#define YNX_WALLET_PQ_ANDROID_ABI 1u
#define YNX_WALLET_PQ_PK_A_BYTES 2592u
#define YNX_WALLET_PQ_PK_B_BYTES 64u
#define YNX_WALLET_PQ_TRANSFER_MAX_BYTES 1024u
#define YNX_WALLET_PQ_MEMBER_MAX_BYTES 131072u
// Opaque refs stay in original Native private worker ownership, never RN values.
typedef struct ynx_wallet_pq_pair ynx_wallet_pq_pair;
typedef struct ynx_wallet_pq_operation ynx_wallet_pq_operation;
typedef struct ynx_original_wallet_android_transfer_authorization ynx_original_wallet_android_transfer_authorization;
typedef struct ynx_wallet_main_android_pq_storage ynx_wallet_main_android_pq_storage;
// Native in-process ABI; integers are uint64, never JS Number or wire fields.
// Owner is exactly 42 ASCII bytes: 0x + 40 lowercase hex, with no terminator.
typedef struct {uint32_t abi_version;uint8_t network_hash[32];uint64_t native_chain_id;uint8_t owner[42];uint64_t pair_version;} ynx_wallet_pq_binding_v1;
typedef struct {uint8_t pk_a[2592];uint8_t pk_b[64];} ynx_wallet_pq_public_v1;
// Captured complete original E (13 fields / YNX-NATIVE-TRANSFER/v2), not a digest.
// E binds recipient, amount, fee and nonce. Review ID is exact UTF8, 1..128 bytes;
// no NUL/control/surrogate normalization. Digest is Main's exact review original.
// H/revision/nonce are DATA until the original Auth held capability verifies them.
typedef struct {uint32_t abi_version;ynx_wallet_pq_binding_v1 binding;ynx_wallet_pq_public_v1 public_pair;uint64_t policy_revision;uint64_t execution_height;uint64_t transfer_nonce;uint8_t review_digest[32];uint32_t request_id_bytes;uint8_t request_id[128];uint32_t signing_bytes_length;uint8_t signing_bytes[1024];} ynx_wallet_pq_transfer_scope_v1;
#define YNX_WALLET_PQ_BEFORE_SIGN 1u
#define YNX_WALLET_PQ_AFTER_SIGN 2u
typedef struct {int32_t code;int32_t original_auth_code;} ynx_wallet_pq_error_v1;
// REQUIRED ORIGINAL AUTH CALLEE. Currently NOT IMPLEMENTED / not a grant.
// Auth owns the real recognized ref/factory/current Source and request-specific
// review lease. It must compare independently held originals to the WHOLE scope,
// including full pair and E, before/after; phase is this closed two-value enum.
// No SDK factory, supplied boolean, JS object, callback or raw-purpose override.
int32_t ynx_original_wallet_android_transfer_assert_current(ynx_original_wallet_android_transfer_authorization *ref,const ynx_wallet_pq_transfer_scope_v1 *scope,uint32_t phase) YNX_WALLET_PQ_ORIGINAL_LINKAGE;

// Fixed ORIGINAL MAIN private Keystore sinks, not public key export/import APIs.
// These plaintext copies may exist only in the protected Native worker borrow;
// wrap/unwrap with OS cipher-bound Keystore, exact binding AAD and current-set
// authentication. Never send them to RN, JS, logs, artifacts or telemetry.
// SDK will wipe the temporary buffers after return. Go/upstream allocations do
// NOT promise immediate physical zeroization; no secure-memory claim is made.
typedef struct {uint8_t pkcs8_a[54];uint8_t pkcs8_b[150];ynx_wallet_pq_public_v1 public_pair;} ynx_wallet_pq_private_storage_material_v1;
int32_t ynx_wallet_main_android_pq_store_new(ynx_wallet_main_android_pq_storage *ref,const ynx_wallet_pq_binding_v1 *binding,const ynx_wallet_pq_private_storage_material_v1 *material) YNX_WALLET_PQ_ORIGINAL_LINKAGE;
int32_t ynx_wallet_main_android_pq_load_original(ynx_wallet_main_android_pq_storage *ref,const ynx_wallet_pq_binding_v1 *binding,ynx_wallet_pq_private_storage_material_v1 *material) YNX_WALLET_PQ_ORIGINAL_LINKAGE;
// Production exports will be supplied with the matching original math and Main
// storage implementations. Absence of either fixed callee refuses acquisition.
// Always retain an out partial before inspecting errors; UNKNOWN never retries.
#ifndef YNX_WALLET_PQ_CGO_IMPLEMENTATION
int32_t ynx_wallet_android_pq_pair_create(ynx_wallet_main_android_pq_storage *storage,const ynx_wallet_pq_binding_v1 *binding,ynx_wallet_pq_pair **out,ynx_wallet_pq_error_v1 *error);
int32_t ynx_wallet_android_pq_pair_restore(ynx_wallet_main_android_pq_storage *storage,const ynx_wallet_pq_binding_v1 *binding,const ynx_wallet_pq_public_v1 *expected,ynx_wallet_pq_pair **out,ynx_wallet_pq_error_v1 *error);
int32_t ynx_wallet_android_pq_pair_public(ynx_wallet_pq_pair *pair,ynx_wallet_pq_public_v1 *out);
int32_t ynx_wallet_android_pq_pair_retire(ynx_wallet_pq_pair *pair);
int32_t ynx_wallet_android_pq_pair_join(ynx_wallet_pq_pair *pair);
int32_t ynx_wallet_android_pq_pair_close(ynx_wallet_pq_pair *pair);
int32_t ynx_wallet_android_pq_transfer_prepare(ynx_wallet_pq_pair *pair,const ynx_wallet_pq_transfer_scope_v1 *scope,ynx_wallet_pq_operation **out,ynx_wallet_pq_error_v1 *error);
int32_t ynx_wallet_android_pq_transfer_sign_once(ynx_wallet_pq_operation *op,ynx_original_wallet_android_transfer_authorization *authorization,ynx_wallet_pq_error_v1 *error);
int32_t ynx_wallet_android_pq_transfer_cancel(ynx_wallet_pq_operation *op);
// Private Native journal capture only, even for late/UNKNOWN signed bytes.
// No transport or permission result. Capacity shortfall must not consume data.
int32_t ynx_wallet_android_pq_transfer_copy_result_data(ynx_wallet_pq_operation *op,uint8_t *out,size_t capacity,size_t *written);
int32_t ynx_wallet_android_pq_transfer_close(ynx_wallet_pq_operation *op);
#endif /* !YNX_WALLET_PQ_CGO_IMPLEMENTATION */
// Lifecycle DATA only. Unknown and first/cleanup causes survive retirement;
// numeric codes are sanitized bridge classes, not raw credential/cause strings.
typedef struct {uint32_t abi_version;uint32_t ready,retired,busy,cleanup_complete;int32_t storage_code;} ynx_wallet_pq_pair_status_v1;
typedef struct {uint32_t abi_version;uint32_t entered,busy,cancelled,result_retained,result_captured,signing_complete,unknown;uint8_t result_digest[32];int32_t first_code,cleanup_code,original_auth_code;} ynx_wallet_pq_operation_status_v1;
#ifndef YNX_WALLET_PQ_CGO_IMPLEMENTATION
int32_t ynx_wallet_android_pq_pair_status(ynx_wallet_pq_pair *,ynx_wallet_pq_pair_status_v1 *);
int32_t ynx_wallet_android_pq_transfer_status(ynx_wallet_pq_operation *,ynx_wallet_pq_operation_status_v1 *);
#endif
#ifdef __cplusplus
}
#endif
#endif
