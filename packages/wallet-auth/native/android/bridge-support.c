#if defined(__APPLE__)
#define YNX_WALLET_PQ_ORIGINAL_LINKAGE __attribute__((weak_import))
#elif defined(__GNUC__) || defined(__clang__)
#define YNX_WALLET_PQ_ORIGINAL_LINKAGE __attribute__((weak))
#else
#error Fixed original Native weak-symbol availability requires supported toolchain
#endif
#include "bridge-support.h"
extern int32_t ynx_original_wallet_android_transfer_assert_current(ynx_original_wallet_android_transfer_authorization *,const ynx_wallet_pq_transfer_scope_v1 *,uint32_t) YNX_WALLET_PQ_ORIGINAL_LINKAGE;
extern int32_t ynx_wallet_main_android_pq_store_new(ynx_wallet_main_android_pq_storage *,const ynx_wallet_pq_binding_v1 *,const ynx_wallet_pq_private_storage_material_v1 *) YNX_WALLET_PQ_ORIGINAL_LINKAGE;
extern int32_t ynx_wallet_main_android_pq_load_original(ynx_wallet_main_android_pq_storage *,const ynx_wallet_pq_binding_v1 *,ynx_wallet_pq_private_storage_material_v1 *) YNX_WALLET_PQ_ORIGINAL_LINKAGE;
int32_t ynx_bridge_auth_current(ynx_original_wallet_android_transfer_authorization *ref,const ynx_wallet_pq_transfer_scope_v1 *scope,uint32_t phase){
 if(!ref||!scope||!ynx_original_wallet_android_transfer_assert_current)return -7001;
 return ynx_original_wallet_android_transfer_assert_current(ref,scope,phase);
}
int32_t ynx_bridge_storage_available(void){return ynx_wallet_main_android_pq_store_new&&ynx_wallet_main_android_pq_load_original?1:0;}
int32_t ynx_bridge_store_new(ynx_wallet_main_android_pq_storage *ref,const ynx_wallet_pq_binding_v1 *b,const ynx_wallet_pq_private_storage_material_v1 *m){
 if(!ref||!b||!m||!ynx_wallet_main_android_pq_store_new)return -7001;
 return ynx_wallet_main_android_pq_store_new(ref,b,m);
}
int32_t ynx_bridge_load_original(ynx_wallet_main_android_pq_storage *ref,const ynx_wallet_pq_binding_v1 *b,ynx_wallet_pq_private_storage_material_v1 *m){
 if(!ref||!b||!m||!ynx_wallet_main_android_pq_load_original)return -7001;
 return ynx_wallet_main_android_pq_load_original(ref,b,m);
}
void ynx_bridge_clear(void *ptr,size_t length){volatile uint8_t *p=(volatile uint8_t *)ptr;while(length--)*p++=0;}
