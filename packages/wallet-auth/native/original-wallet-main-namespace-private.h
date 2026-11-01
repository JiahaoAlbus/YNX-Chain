#pragma once
#include <node_api.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// PRIVATE native link ABI. Never expose hold/root loan construction via NAPI.
// Auth alone supplies an actual retained RootCtx loan. Its current callback
// MUST qualify SAME completed namespace + four actual functions against the
// independently admitted Main release/full closure and current Root state.
// The HTTP image lease alone is insufficient. No path/hash/boolean is authority.
typedef struct ynx_wallet_main_namespace_root_loan_v1 {
 uint32_t version;
 void* context;
 int32_t (*assert_current)(void*,napi_env,napi_value,const napi_value[4]);
 void (*retire)(void*);
 // 0 means actual drained. Nonzero retains the SAME loan; no forced close.
 int32_t (*join)(void*);
 int32_t (*close)(void*);
} ynx_wallet_main_namespace_root_loan_v1;
typedef struct ynx_wallet_main_namespace_owner_v1 ynx_wallet_main_namespace_owner_v1;
// out is adopted before Root/current/property/NAPI calls. root ownership moves
// only when out becomes nonnull; caller must retain all nonnull partials.
// Owner copies vtable by VALUE before publishing out. Caller may invalidate the
// original table afterwards; context remains retained until its close callback.
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_hold_v1(napi_env,napi_value,
 ynx_wallet_main_namespace_root_loan_v1*,ynx_wallet_main_namespace_owner_v1**);
// Borrowed values live only on SAME env actor, within the current private call.
// Recheck again after foreign work; no cross-await borrow or cached admission.
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_borrow_v1(ynx_wallet_main_namespace_owner_v1*,napi_env,napi_value*,napi_value[4]);
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_recheck_v1(ynx_wallet_main_namespace_owner_v1*,napi_env);
__attribute__((visibility("hidden"))) void ynx_wallet_main_namespace_retire_v1(ynx_wallet_main_namespace_owner_v1*);
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_join_v1(ynx_wallet_main_namespace_owner_v1*,napi_env);
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_close_v1(ynx_wallet_main_namespace_owner_v1*,napi_env);
// SAME original pending JS cause (boxed, so falsy remains distinct from none).
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_failure_v1(ynx_wallet_main_namespace_owner_v1*,napi_env,napi_value*);
// Deletes only an already successfully closed owner. Never drops live debts.
__attribute__((visibility("hidden"))) int32_t ynx_wallet_main_namespace_dispose_v1(ynx_wallet_main_namespace_owner_v1*);
#ifdef __cplusplus
}
#endif
