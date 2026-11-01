#pragma once
#include <stddef.h>
#include <stdint.h>
/* Matching69 ordinary NativePQCustody.h subset, declarations only. Link the
 * actual Auth implementation; do not compile a second signer into this module. */
#ifdef __cplusplus
extern "C" {
#endif
int32_t ynx_auth_pq_native_open_v1(const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,uint32_t,uint64_t*);
int32_t ynx_auth_pq_native_current_v1(uint64_t);
int32_t ynx_auth_pq_native_transaction_once_v1(uint64_t,const uint8_t*,size_t,const uint8_t*,size_t,uint64_t,const uint8_t*,size_t,const uint8_t*,size_t);
int32_t ynx_auth_pq_native_copy_outcome_v1(uint64_t,uint8_t*,size_t,size_t*,int32_t*,uint32_t*,uint32_t*);
int32_t ynx_auth_pq_native_retire_v1(uint64_t);
int32_t ynx_auth_pq_native_close_v1(uint64_t);
int32_t ynx_auth_pq_native_release_closed_v1(uint64_t);
/* REQUIRED new Auth custody read-only getter; not present in matching69.
 * Original owner must implement same-thread ordinary/current exact binding
 * comparison. A uint64 numeric ID alone never proves the opened identity. */
int32_t ynx_auth_pq_native_assert_binding_v1(uint64_t,const uint8_t*,size_t);
#ifdef __cplusplus
}
#endif
