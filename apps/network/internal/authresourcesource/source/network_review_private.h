#pragma once
#include "network_resource_native.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Preview is exact owned Original Work+Consent DATA only, not approval. */
ynx_network_error_v1 ynx_network_review_read_original_v1(ynx_network_review_v1*,unsigned char*,size_t,size_t*);
ynx_network_error_v1 ynx_network_review_current_v1(ynx_network_review_v1*);
ynx_network_error_v1 ynx_network_review_retire_v1(ynx_network_review_v1*);
ynx_network_drain_v1 ynx_network_review_join_v1(ynx_network_review_v1*);
ynx_network_drain_v1 ynx_network_review_close_v1(ynx_network_review_v1*);
/* Does NOT report approval/execution/finality. This is retained custody DATA
 * for one same original attempt; no sign retry or replacement request. */
ynx_network_error_v1 ynx_network_review_observe_phase_v1(ynx_network_review_v1*,uint32_t*);
#ifdef __cplusplus
}
#endif
