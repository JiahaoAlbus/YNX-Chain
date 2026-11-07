#ifndef YNX_NETWORK_RESOURCE_CONSENT_CABI_V1_H
#define YNX_NETWORK_RESOURCE_CONSENT_CABI_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define YNX_NETWORK_RESOURCE_CONSENT_ABI_V1 1u
#define YNX_NETWORK_RESOURCE_CONSENT_MEMBER_CAPACITY_V1 262144u
typedef struct { const uint8_t *bytes; size_t length; } YNXNetworkResourceBytesV1;
typedef struct {
 YNXNetworkResourceBytesV1 network_id, owner, key_epoch, issued_height, pk_a, pk_b;
} YNXNetworkResourceBindingV1;
typedef struct {
 YNXNetworkResourceBytesV1 subject_owner, policy_original;
 uint64_t execution_height;
 int64_t now_millis;
} YNXNetworkResourceCurrentDATAV1;
typedef struct {
 uint32_t abi_version, action;
 size_t struct_size;
 uint64_t handle;
 YNXNetworkResourceBytesV1 scope_original, input_original;
 YNXNetworkResourceBindingV1 expected;
 YNXNetworkResourceCurrentDATAV1 current;
 YNXNetworkResourceBytesV1 pkcs8_a, pkcs8_b, pk_a, pk_b;
} YNXNetworkResourceConsentRequestV1;
typedef struct {
 uint32_t abi_version, struct_size, status, first_cause, flags, cleanup_status;
 uint64_t handle;
 size_t member_length;
} YNXNetworkResourceConsentResultV1;
enum YNXNetworkResourceActionV1 {
 YNX_RESOURCE_PREPARE_V1=1, YNX_RESOURCE_CURRENT_V1=2,
 YNX_RESOURCE_SIGN_ONCE_V1=3, YNX_RESOURCE_CONFIRM_CURRENT_V1=4,
 YNX_RESOURCE_ORIGINAL_V1=5, YNX_RESOURCE_RETIRE_V1=6,
 YNX_RESOURCE_DRAIN_V1=7, YNX_RESOURCE_CLOSE_V1=8,
 YNX_RESOURCE_RELEASE_V1=9
};
enum YNXNetworkResourceStatusV1 {
 YNX_RESOURCE_OK_V1=0, YNX_RESOURCE_ARGUMENT_V1=1,
 YNX_RESOURCE_BOUNDS_V1=2, YNX_RESOURCE_OVERLAP_V1=3,
 YNX_RESOURCE_CAPACITY_V1=4, YNX_RESOURCE_PUBLIC_DATA_V1=5,
 YNX_RESOURCE_KEY_MATERIAL_V1=6, YNX_RESOURCE_SIGNING_V1=7,
 YNX_RESOURCE_CURRENT_DATA_V1=8, YNX_RESOURCE_CLEANUP_V1=9,
 YNX_RESOURCE_INTERNAL_V1=10, YNX_RESOURCE_UNKNOWN_HANDLE_V1=11,
 YNX_RESOURCE_ALREADY_SELECTED_V1=12, YNX_RESOURCE_RETIRED_V1=13,
 YNX_RESOURCE_PENDING_V1=14, YNX_RESOURCE_RESOURCE_LIMIT_V1=15
};
enum YNXNetworkResourceFlagsV1 {
 YNX_RESOURCE_SELECTED_V1=1, YNX_RESOURCE_RUNNING_V1=2,
 YNX_RESOURCE_SIGNATURE_VERIFIED_V1=4, YNX_RESOURCE_BATCH_CLEAN_V1=8,
 YNX_RESOURCE_CURRENT_MATCHED_V1=16, YNX_RESOURCE_RETIRED_FLAG_V1=32,
 YNX_RESOURCE_CLOSED_V1=64, YNX_RESOURCE_DRAINED_V1=128,
 YNX_RESOURCE_UNKNOWN_V1=256
};
/* Fixed NETWORK-RESOURCE-CONSENT, public-block-histogram, existing E7, dual
 * ML-DSA-87 AND SLH-DSA-SHA2-256f, N=1/index0 only. No raw message, purpose,
 * provider, entropy, key export, Root bool, or authorization factory.
 *
 * PREPARE: handle=0, scope <=49152, input <=4194304, independent binding:
 * raw network32, canonical owner42, canonical decimal uint64 epoch/height,
 * full PK2592/64. CurrentDATA uses actual same-authority WalletPolicyProjection
 * <=8388608 and independently acquired subjectOwner/executionHeight/clock.
 * Pending13.principalCurrent9 is NOT this policy. Never map generation->epoch,
 * construct policy from Source JSON, or claim the public values authenticate it.
 * CURRENT/SIGN_ONCE/CONFIRM: existing handle + fresh CurrentDATA. SIGN_ONCE
 * alone supplies synchronous protected borrowed DER54/150 and full PK2592/64.
 * All other unused spans/scalars MUST be zero; no input is retained by pointer.
 * SIGN_ONCE/CONFIRM/ORIGINAL/CLOSE require caller_buffer exactly262144. Other
 * actions require NULL buffer/capacity0. Layout failure writes NOTHING.
 *
 * Valid aligned stable C allocations are caller preconditions; arbitrary bad
 * pointers cannot be validated. Result/buffer must be mutually disjoint and
 * disjoint from request/all inputs. Private spans must be disjoint from ALL
 * public inputs and request before any copy/read; public/public overlap is OK.
 * Admitted result always initialized. Capture handle + public member + flags
 * BEFORE interpreting status; late errors retain original partial/first cause.
 * Selection precedes first private read and cannot be reset, even on UNKNOWN.
 * Current cannot sign, Original cannot re-sign, Close preserves original public
 * result. RELEASE only after Close+Drain and caller-owned reconciliation; it
 * discards that public operation token permanently. Handles are not authority.
 * Registry holds <=32 public operations / <=32MiB reserved owned public bytes;
 * reservation includes scope/input, MAX policy/member and binding allowance;
 * no private key/borrow, resident worker, service or global key registry exists.
 *
 * cleanup_status: 1 no private entry; 2 owned explicit copies Clear + imported
 * key Destroy completed LOGICALLY; 0 unknown/3 failure. It NEVER promises Go/
 * CIRCL/stack/heap physical erasure. Native must clear its borrowed material.
 * Native owns actual Source/current/device fences, explicit decision, durable
 * original once/UNKNOWN, protected parent retention and physical drain. This
 * API's math/data completion grants no Root/account/Source/session/execution.
 */
int32_t YNXNetworkResourceConsentAttemptV1(YNXNetworkResourceConsentRequestV1 *request,
 uint8_t *caller_buffer, size_t capacity, YNXNetworkResourceConsentResultV1 *result);
#ifdef __cplusplus
}
#endif
#endif
