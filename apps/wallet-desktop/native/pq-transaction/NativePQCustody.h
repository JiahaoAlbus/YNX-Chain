#ifndef YNX_AUTH_NATIVE_PQ_CUSTODY_PRIVATE_H
#define YNX_AUTH_NATIVE_PQ_CUSTODY_PRIVATE_H
#include <stddef.h>
#include <stdint.h>
/* ORIGINAL MAIN/NATIVE ONLY. Never preload/renderer/IPC an owner ID, recovery
 * credential, private buffer or raw C pointer. These are custody bodies, NOT
 * Source/approval/Genesis admission. Main must independently hold original
 * reviewed current/once, original vault file+unlock revision and journal. */
enum { YNX_AUTH_PQ_OK=0,YNX_AUTH_PQ_ARGUMENT=1,YNX_AUTH_PQ_BOUNDS=2,
 YNX_AUTH_PQ_CANONICAL=3,YNX_AUTH_PQ_BINDING=4,YNX_AUTH_PQ_AUTHENTICATION=5,
 YNX_AUTH_PQ_CLOSED=6,YNX_AUTH_PQ_PURPOSE=7,YNX_AUTH_PQ_DUPLICATE=8,
 YNX_AUTH_PQ_CRYPTO_BASE=100 };
#ifdef __cplusplus
extern "C" {
#endif
/* Main's EXISTING encrypted backup+credential; no new store or publisher item.
 * out_owner initially0, aligned; never aliases input. Inputs stable/live for
 * the synchronous call. Purpose1 ordinary898; future purpose2 is separate. */
int32_t ynx_auth_pq_native_open_v1(const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,uint32_t,uint64_t*);
int32_t ynx_auth_pq_native_current_v1(uint64_t);
int32_t ynx_auth_pq_native_retire_v1(uint64_t);
int32_t ynx_auth_pq_native_transaction_once_v1(uint64_t,const uint8_t*,size_t,const uint8_t*,size_t,uint64_t,const uint8_t*,size_t,const uint8_t*,size_t);
/* Copy ONLY retained public outcome after success/error/retirement/close.
 * NULL/capacity0 probes public length only; NEVER signs/probes the primitive.
 * All output allocations mutually disjoint/live/aligned; capacity<=98304. */
int32_t ynx_auth_pq_native_copy_outcome_v1(uint64_t,uint8_t*,size_t,size_t*,int32_t*,uint32_t*,uint32_t*);
/* Close wipes original Native private allocations and repeats first result.
 * Main captures original public outcome + first/cleanup debt before RELEASE;
 * release only removes a CLOSED exact ID. IDs monotonically never repeat. */
int32_t ynx_auth_pq_native_close_v1(uint64_t);
int32_t ynx_auth_pq_native_release_closed_v1(uint64_t);
/* Build capabilities only, never Source/approval/Genesis/installed evidence. */
uint32_t ynx_auth_pq_native_capabilities_v1(void);
/* Dedicated birth factory. Its message/fullGenesis/independent raw32 pin/
 * nativeID/exact decimalH are frozen before keys open. Generic open(purpose2)
 * remains rejected. Nonbirth builds return PURPOSE without reading secrets. */
int32_t ynx_auth_pq_native_open_initial_v1(const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,const uint8_t*,size_t,uint64_t,const uint8_t*,size_t,uint64_t*);
/* No message/pin/H overrides after factory. Same current/once/outcome/close. */
int32_t ynx_auth_pq_native_account_initial_once_v1(uint64_t);
#ifdef __cplusplus
}
#endif
#endif
