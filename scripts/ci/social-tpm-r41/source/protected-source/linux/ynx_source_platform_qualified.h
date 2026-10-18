#ifndef YNX_SOURCE_PLATFORM_QUALIFIED_H
#define YNX_SOURCE_PLATFORM_QUALIFIED_H
#include "../ynx_source_platform_private.h"
/* Private storage facts, never a capability. Expected comes only from the
 * retained static resource driver. No public factory or callback installer. */
#define YNX_STORAGE_FIXED 412u
#define YNX_STORAGE_MAX 66176u
#include "ynx_storage_initialization_aad_private.h"
#define YNX_STORAGE_QUEUE_MAX 1049132u
enum ynx_storage_class {YNX_STORAGE_RECORD=1,YNX_STORAGE_QUEUE=2};
typedef struct ynx_storage_expected {
 uint64_t generation,base_version,next_version,binding[11];
 uint32_t kind,id,extra_id,device,direction,container_class;
 unsigned char source_abi[32],root[32],device_final[32],session[32],purpose[32];
 unsigned char request[32],operation_nonce[32],logical[16],storage_nonce[12];
 ynx_original_bytes name;
 /* Only record7 uses this private exact typed initializer. Others require NULL. */
 const ynx_storage_initialization_aad_v1 *initialization;
} ynx_storage_expected;
typedef struct ynx_storage_ciphertext {
 unsigned char *bytes;size_t size;const char *kind,*id;
} ynx_storage_ciphertext;
typedef struct ynx_platform_storage_hold ynx_platform_storage_hold;
typedef struct ynx_storage_attempt ynx_storage_attempt;
/* Private execution observations. None is an admission/floor/terminal proof.
 * The same original attempt owns all transitions and ciphertext until close. */
enum ynx_execution_stage {YNX_EXEC_ACQUIRING,YNX_EXEC_RESOURCE,YNX_EXEC_SEALED,YNX_EXEC_BOUND,YNX_EXEC_INTENT_DURABLE,YNX_EXEC_WRITE_ENTERED,YNX_EXEC_LOCAL_COMMITTED,YNX_EXEC_TERMINAL_RETURNED,YNX_EXEC_UNKNOWN};
/* Provider-private raw material only: normal commit consumes metadata with
 * key/key_size cleared and seals inside same-resource pre/post-current calls.
 * This interface cannot select or acquire a qualified resource.
 * Returned key is locked, borrowed and distinct from role wrapping keys.
 * expected[0..count] includes exactly one final queue record. Reservations are
 * key-global unique and survive uncertainty/restart; these facts do NOT prove
 * enrollment or floor. Driver holds the original joint fence throughout. */
typedef struct ynx_storage_material {
 const unsigned char *key;size_t key_size;uint64_t key_generation;
 const ynx_storage_expected *expected;size_t count;
 const char *const *kinds,*const *ids;
} ynx_storage_material;
veil_store_status ynx_platform_snapshot_storage_acquire(ynx_platform_snapshot_hold *,const ynx_native_computed_step *,size_t,uint32_t,ynx_original_bytes,ynx_platform_storage_hold **);
veil_store_status ynx_platform_storage_current(ynx_platform_storage_hold *);
veil_store_status ynx_platform_storage_material(ynx_platform_storage_hold *,ynx_storage_material *);
/* Freeze/authenticate exact encrypted journal and intent under original owner.
 * No SQL starts until real driver returns the genuine store/lease/intent. */
veil_store_status ynx_platform_storage_bind_ciphertext(ynx_platform_storage_hold *,const ynx_storage_ciphertext *,size_t,veil_checked_store **,const veil_verified_native_operation_lease **,const veil_native_intent_handle **);
veil_store_status ynx_platform_storage_validate_ciphertext(ynx_platform_storage_hold *,veil_private_effect_guard *,veil_private_intent_pin *,size_t,const ynx_storage_ciphertext *);
/* Cleanup remains callable for UNKNOWN/expired owner. Failure retains hold.
 * Success requires no remaining borrower of key/journal/intent, including
 * independent final output; NULL is the only disposed convention. */
veil_store_status ynx_platform_storage_close(ynx_platform_storage_hold **);
veil_store_status ynx_storage_initialization_header_exact_v1(
 const ynx_storage_expected *,size_t,unsigned char *,size_t,size_t *);
veil_store_status ynx_storage_seal(const unsigned char key[32],const ynx_storage_expected *,ynx_original_bytes,ynx_storage_ciphertext *);
veil_store_status ynx_storage_open(const unsigned char key[32],const ynx_storage_expected *,ynx_original_bytes,unsigned char *locked_sink,size_t,size_t *);
void ynx_storage_ciphertext_free(ynx_storage_ciphertext *);
veil_store_status ynx_qualified_snapshot_commit(ynx_platform_snapshot_hold *,const veil_native_intent_handle *,const ynx_native_computed_step *,size_t,uint32_t,ynx_original_bytes,ynx_storage_attempt **,veil_native_verified_commit **);
veil_store_status ynx_qualified_storage_lookup(ynx_storage_attempt *,veil_native_verified_commit **);
veil_store_status ynx_qualified_storage_close(ynx_storage_attempt **);
/* Same-source original attempt validation is called by normal SQL before any
 * write; local retained-ciphertext equality never substitutes for source. */
veil_store_status ynx_qualified_validate_ciphertext(ynx_platform_storage_hold *,veil_private_effect_guard *,veil_private_intent_pin *,size_t,const ynx_storage_ciphertext *);
/* Normal SQL caller validates same real source before each ciphertext write. */
veil_store_status veil_private_apply_ciphertext(veil_checked_write_handle *,ynx_platform_storage_hold *,size_t,const ynx_storage_ciphertext *,int queue);
/* Private transport custody only: no factory, storage permission or terminal
 * from TLS success. Selection is Native startup's independently registered
 * client object, not an issuer/anchor wrapping owner or Java manifest. */
struct ynx_message_sealed_raw_input;
typedef struct ynx_private_execution_client ynx_private_execution_client;
veil_store_status ynx_private_execution_client_open(const struct ynx_message_sealed_raw_input *,ynx_original_bytes,const unsigned char certificate_digest[32],ynx_private_execution_client **);
veil_store_status ynx_private_execution_client_current(ynx_private_execution_client *);
/* Connected fd is transport only, retained by the caller through close. Exact
 * original host/path/SPKI and monotonic deadline are immutable per exchange.
 * On failure any response stays in this owner; sink/written adopt partial body
 * before late current. No retries, redirects, proxies or permission outputs. */
veil_store_status ynx_private_execution_client_exchange(ynx_private_execution_client *,int,const char *,const char *,const unsigned char[32],uint64_t,ynx_original_bytes,unsigned char *,size_t,size_t *);
/* After Rust retained the COMPLETE original response and late current passes,
 * release exchange buffers/TLS only. Does not retire a remote resource/intent. */
veil_store_status ynx_private_execution_client_complete_response(ynx_private_execution_client *);
veil_store_status ynx_private_execution_client_close(ynx_private_execution_client **);
/* Normal private static loader/dispatcher declarations. Opaque SDK/startup
 * handles are recognized in the same Native inventory, never Java/JS handles.
 * These operations return transport observations only, not admission. */
int32_t ynx_sdk_startup_transport_client_bind_v1(void *,uint32_t,const struct ynx_message_sealed_raw_input *,ynx_original_bytes,const unsigned char[32]);
int32_t ynx_sdk_custody_execution_dispatch_v1(void *,uint32_t,ynx_original_bytes,uint64_t);
#endif
