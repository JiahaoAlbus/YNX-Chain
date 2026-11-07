#pragma once
#include "network_pending_native.h"
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_network_pending_principal_v1 ynx_network_pending_principal_v1;
/* Private recognized SAME-Source resource custody only. No signing/approval,
 * policy CurrentDATA, execution permission, raw key or public setter. A partial
 * owner is returned before any Root/current/registration error; retire, join,
 * close it before its original pending Source parent. NOT_SUPPLIED=83.
 * Normal reviewed rows remain empty. Independent principal CurrentDATA policy
 * and actual Native decision are REQUIRED before any later key read/sign. */
ynx_network_error_v1 ynx_network_pending_principal_capture_v1(ynx_network_pending_source_v1*,ynx_network_pending_principal_v1**);
ynx_network_error_v1 ynx_network_pending_principal_current_v1(ynx_network_pending_principal_v1*);
ynx_network_error_v1 ynx_network_pending_principal_retire_v1(ynx_network_pending_principal_v1*);
ynx_network_drain_v1 ynx_network_pending_principal_join_v1(ynx_network_pending_principal_v1*);
ynx_network_drain_v1 ynx_network_pending_principal_close_v1(ynx_network_pending_principal_v1*);
#ifdef __cplusplus
}
#endif
