#ifndef YNX_STORAGE_INITIALIZATION_AAD_PRIVATE_V1
#define YNX_STORAGE_INITIALIZATION_AAD_PRIVATE_V1
#include <stdint.h>
#include <stddef.h>
/* PRIVATE immutable facts of SAME genuine FirstDeviceCoreLoan/participant.
 * No accepted-final/session/logical/message coordinate fields exist here.
 * Hashes are SHA256 of exact original bytes, without reserialization or new
 * signature domains. operation_ids and nonces remain original raw bytes.
 * Raw API layout528: prefix32, fifteen fields32, nonce12/reserved4.
 * Wire is BE in YNXREC1 version2, kind7 at24, fixed560 + selector name64.
 * SourceABI/11 coordinates for later EngineCommit are a separate normal
 * storage descriptor factory; this format MUST NOT manufacture them.
 */
typedef struct ynx_storage_initialization_aad_v1 {
 uint32_t version,size;uint64_t generation,base_version,next_version;
 unsigned char approval_digest[32],root_digest[32],namespace_digest[32],request_digest[32];
 unsigned char native_device_digest[32],account_digest[32],identity_digest[32],device_label_digest[32];
 unsigned char alias_digest[32],source_operation_digest[32],operation_ids[32];
 unsigned char source_nonce[32],account_nonce[32],plaintext_digest[32],selector_digest[32];
 unsigned char storage_nonce[12];uint32_t reserved;
} ynx_storage_initialization_aad_v1;
_Static_assert(sizeof(ynx_storage_initialization_aad_v1)==528,"initAAD528");
_Static_assert(offsetof(ynx_storage_initialization_aad_v1,approval_digest)==32,"initAADdigests32");
_Static_assert(offsetof(ynx_storage_initialization_aad_v1,storage_nonce)==512,"initAADnonce512");
enum {YNX_INITIALIZATION_AAD_VERSION=1,YNX_INITIALIZATION_RECORD_VERSION=2,YNX_INITIALIZATION_RECORD_FIXED=560,YNX_INITIALIZATION_RECORD_HEADER=624};
/* Same-candidate independent Rust original verifier. This checks facts only;
 * the C protected nonce/current/fence remain the key-use authorization path. */
int32_t ynx_sdk_native_core_initialization_aad_verify_v1(void *same_policy,const ynx_storage_initialization_aad_v1 *);
#endif
