#ifndef YNX_WALLET_PQ_ANDROID_BRIDGE_SUPPORT_H
#define YNX_WALLET_PQ_ANDROID_BRIDGE_SUPPORT_H
#include "wallet-pq-android.h"
int32_t ynx_bridge_auth_current(ynx_original_wallet_android_transfer_authorization *,const ynx_wallet_pq_transfer_scope_v1 *,uint32_t);
int32_t ynx_bridge_storage_available(void);
int32_t ynx_bridge_store_new(ynx_wallet_main_android_pq_storage *,const ynx_wallet_pq_binding_v1 *,const ynx_wallet_pq_private_storage_material_v1 *);
int32_t ynx_bridge_load_original(ynx_wallet_main_android_pq_storage *,const ynx_wallet_pq_binding_v1 *,ynx_wallet_pq_private_storage_material_v1 *);
void ynx_bridge_clear(void *,size_t);
#endif
