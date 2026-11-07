#pragma once
#include "network_resource_native.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_network_pending_source_v1 ynx_network_pending_source_v1;
/* Distinct inventory/type. No execute/dispatch/claim/settle/sign/approve API.
 * Existing execution ABI recognizes none of these owners, even by cast. */
ynx_network_error_v1 ynx_network_pending_source_acquire_v1(ynx_network_pending_source_v1**);
ynx_network_error_v1 ynx_network_pending_source_current_v1(ynx_network_pending_source_v1*);
/* 1..9 same original read kinds; 10 resourceScope; 11 inputRef; 12 actualGo
 * consumerIdentity; 13 exact9 SourceCurrent; 14 NONCONSUMING once7 observation.
 * Original members are base64url only in raw JSON mapping transport; sole SDK
 * converts/brands independently protected registrations. No received JSON is
 * a Native permission. Getter outputs are DATA, never a public capability. */
ynx_network_error_v1 ynx_network_pending_source_read_v1(ynx_network_pending_source_v1*,uint32_t,unsigned char*,size_t,size_t*);
ynx_network_error_v1 ynx_network_pending_source_retire_v1(ynx_network_pending_source_v1*);
ynx_network_drain_v1 ynx_network_pending_source_join_v1(ynx_network_pending_source_v1*);
ynx_network_drain_v1 ynx_network_pending_source_close_v1(ynx_network_pending_source_v1*);
#ifdef __cplusplus
}
#endif
