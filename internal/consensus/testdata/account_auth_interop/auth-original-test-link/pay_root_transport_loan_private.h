#pragma once
#include <stdint.h>
#include "private_client_v1.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_wallet_pay_root_transport_loan_v1 ynx_wallet_pay_root_transport_loan_v1;
typedef struct ynx_wallet_pay_root_transport_route_v1 {
 uint8_t enabled;char method[5],path[2049],content_type[17];
 uint64_t maximum_body_bytes,timeout_ms;
} ynx_wallet_pay_root_transport_route_v1;
typedef struct ynx_wallet_pay_root_transport_profile_v1 {
 uint32_t version,size;char resource_ref[129],socket_path[104],service[129];
 uint32_t peer_uid;int32_t peer_pid;
 uint64_t timeout_ms,maximum_header_bytes,maximum_response_bytes;
 ynx_wallet_pay_root_transport_route_v1 routes[5];
} ynx_wallet_pay_root_transport_profile_v1;
// Hidden in-process getters. No Root/config constructor from C/Go/JS and no
// cross-process pointers. Normal Native owner alone captures the actual loan.
int32_t ynx_wallet_pay_root_transport_profile_read_v1(ynx_wallet_pay_root_transport_loan_v1*,ynx_wallet_pay_root_transport_profile_v1*);
int32_t ynx_wallet_pay_root_transport_fence_v1(ynx_wallet_pay_root_transport_loan_v1*,ynx_link_private_client_source_fence_v1*);
void ynx_wallet_pay_root_transport_retire_v1(ynx_wallet_pay_root_transport_loan_v1*);
int32_t ynx_wallet_pay_root_transport_close_v1(ynx_wallet_pay_root_transport_loan_v1*);
int32_t ynx_wallet_pay_root_transport_closed_v1(ynx_wallet_pay_root_transport_loan_v1*);
#ifdef __cplusplus
}
#endif
