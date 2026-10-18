#ifndef YNX_NATIVE_PRODUCT_ORIGINALS_PRIVATE_H
#define YNX_NATIVE_PRODUCT_ORIGINALS_PRIVATE_H
#include "ynx_native_product_source_private.h"
typedef struct veil_native_product_original veil_native_product_original;
/* Same qualified Source custody. Capturing bytes is not session, effect,
 * actor or final authorization. Publish retained partial before late current.
 * No public metadata/status/transport response can construct this owner. */
veil_store_status veil_private_product_original_prepare_message_v1(veil_native_product_source *,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,veil_native_product_original **);
veil_store_status veil_private_product_original_prepare_incoming_v1(veil_native_product_source *,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,const unsigned char *,size_t,veil_native_product_original **);
veil_store_status veil_private_product_original_prepare_contact_v1(veil_native_product_source *,const unsigned char *,size_t,const unsigned char *,size_t,veil_native_product_original **);
veil_store_status veil_private_product_original_current_v1(veil_native_product_original *);
veil_store_status veil_private_product_original_reference_v1(veil_native_product_original *,unsigned char *,size_t,size_t *);
veil_store_status veil_private_product_original_session_records_v1(veil_native_product_original *,unsigned char *,size_t,size_t *);
veil_store_status veil_private_product_original_completion_v1(veil_native_product_original *,uint32_t *);
veil_store_status veil_private_product_original_require_committed_output_v1(veil_native_product_original *,const unsigned char *,uint32_t,uint32_t,const unsigned char *,size_t);
veil_store_status veil_private_product_original_execute_contact_v1(veil_native_product_original *);
veil_store_status veil_private_product_original_close_v1(veil_native_product_original **);
veil_store_status veil_private_product_original_terminal_v1(veil_native_product_source *,const unsigned char *,size_t,uint32_t,uint32_t *);

/* Pre-session original facts. This same-thread child pins the genuine owning
 * Source/captured input before any peer session exists. No signer, key-use
 * permission, Root or device grant is created. Own-records context is an opaque
 * read/current input only; its SDK registry independently recognizes it. */
typedef struct veil_native_message_original_child veil_native_message_original_child;
typedef struct veil_native_message_original_snapshot_v1 {
 uint32_t version,size,direction,kind;
 uint64_t started_ns,deadline_ns;
 int64_t issued_ms,expires_ms;
 unsigned char nonce[32],logical[16],request_digest[32];
 ynx_original_bytes operation,request,route,command,context;
 ynx_original_bytes device_final,device_current,device_terminal,device_checkpoint;
 const ynx_original_bytes *device_predecessors;size_t device_predecessor_count;
 void *own_records_context;
 ynx_native_core_device_binding_v2 device_binding;
 unsigned char source_reference[32];
} veil_native_message_original_snapshot_v1;
veil_store_status veil_private_product_message_original_acquire_v1(veil_native_product_original *,veil_native_message_original_child **);
veil_store_status veil_private_product_message_original_current_v1(veil_native_message_original_child *);
veil_store_status veil_private_product_message_original_snapshot_v1(veil_native_message_original_child *,veil_native_message_original_snapshot_v1 *);
veil_store_status veil_private_product_message_original_first_cause_v1(veil_native_message_original_child *);
veil_store_status veil_private_product_message_original_close_v1(veil_native_message_original_child **);
/* DATA query and owning retain for the same native per-operation origin. */
veil_store_status veil_private_product_message_operation_original_v1(const veil_native_verified_commit *,uint32_t,const unsigned char[16],const unsigned char[32],ynx_message_operation_input *);
veil_store_status veil_private_product_message_operation_retain_v1(const veil_native_verified_commit *,const ynx_message_operation_input *,veil_native_message_original_child **);
/* Signed public-original publication only, not session admission. WRITE4 + paired end + independent READ3 exact readback, once per same native child. */
veil_store_status veil_private_product_message_material_publish_v1(veil_native_message_original_child *,const unsigned char *,size_t);
#endif
