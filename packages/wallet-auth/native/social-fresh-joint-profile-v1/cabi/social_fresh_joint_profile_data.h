#ifndef YNX_SOCIAL_FRESH_JOINT_PROFILE_DATA_V1_H
#define YNX_SOCIAL_FRESH_JOINT_PROFILE_DATA_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
#define YNX_SOCIAL_JOINT_BODY_MAX 32768u
#define YNX_SOCIAL_JOINT_CAPTURE_MAX 65536u
#define YNX_SOCIAL_JOINT_OUTER_MAX 65536u /* Auth envelope only; not created here */
enum { YNX_SOCIAL_JOINT_DATA_OK=0, YNX_SOCIAL_JOINT_DATA_INVALID=1,
 YNX_SOCIAL_JOINT_DATA_NOT_SUPPLIED=2, YNX_SOCIAL_JOINT_DATA_CAPACITY=3,
 YNX_SOCIAL_JOINT_DATA_ALIAS=4, YNX_SOCIAL_JOINT_DATA_INTERNAL=5 };
typedef struct { const uint8_t *data; size_t length; } YNXSocialJointSpan;
typedef struct { YNXSocialJointSpan value; uint32_t is_null; } YNXSocialJointNullableText;
typedef struct {
 YNXSocialJointSpan source;
 YNXSocialJointSpan store;
 YNXSocialJointSpan schema;
 YNXSocialJointSpan inode;
 YNXSocialJointSpan restore;
 uint64_t source_generation, native_restore_incarnation;
} YNXSocialJointScope;
typedef struct {
 YNXSocialJointSpan network_id;
 YNXSocialJointSpan canonical_owner;
 YNXSocialJointSpan account;
 YNXSocialJointSpan session_binding;
 YNXSocialJointSpan product_id;
 YNXSocialJointSpan client_id;
 YNXSocialJointSpan platform;
 YNXSocialJointSpan application_id;
 YNXSocialJointNullableText bundle_id;
 YNXSocialJointNullableText package_id;
 YNXSocialJointSpan origin;
 YNXSocialJointSpan callback;
 YNXSocialJointSpan device_id;
 YNXSocialJointSpan generation;
 YNXSocialJointSpan registration_id;
 YNXSocialJointSpan revision;
 YNXSocialJointSpan registration_digest;
} YNXSocialJointExpected17;
typedef struct {
 YNXSocialJointSpan history_original, issuer_original, anchor_original, registration_original;
 YNXSocialJointScope scope;
 uint64_t issuer_epoch, anchor_epoch;
 int64_t history_issued_ms, history_expires_ms, captured_deadline_ms;
} YNXSocialJointCaptured;
typedef struct {
 YNXSocialJointSpan realm;
 YNXSocialJointSpan client;
 YNXSocialJointSpan network;
 YNXSocialJointSpan identity;
 YNXSocialJointSpan device;
 YNXSocialJointSpan header_sha256;
 YNXSocialJointSpan classic_public, pq_public;
 YNXSocialJointExpected17 expected;
} YNXSocialJointRegisteredBinding;
typedef struct {
 int32_t version;
 YNXSocialJointSpan purpose;
 YNXSocialJointSpan role;
 YNXSocialJointSpan realm;
 YNXSocialJointSpan client;
 YNXSocialJointSpan network;
 YNXSocialJointSpan header_sha256;
 int64_t not_before_ms, expires_ms, max_lifetime_ms;
} YNXSocialJointPolicy10;
typedef struct { int64_t issued_ms, expires_ms, at_ms; } YNXSocialJointWindow;
typedef struct {
 uint32_t abi_version, struct_size; /* exactly 1 and sizeof(this struct) */
 YNXSocialJointCaptured captured;
 YNXSocialJointRegisteredBinding binding;
 const YNXSocialJointPolicy10 *issuer_policy, *anchor_policy;
 YNXSocialJointWindow window;
} YNXSocialFreshJointProfileInputV1;
/* Synchronous DATA only. All pointers are caller-owned, readable/writable for
 * the stated lifetime, stable and correctly aligned. Arbitrary invalid memory
 * addresses cannot be validated in a C ABI. No pointer is retained.
 * Span text is UTF8, no implicit terminator; nullable is_null exactly 0/1,
 * null requires {NULL,0}. Four originals each 1..65536 (not a total cap).
 * Outputs: body_capacity 1..32768; written is size_t; history_hex64 is exactly
 * 64 lowercase ASCII bytes with NO terminator. All three output regions must
 * be disjoint from each other and every input, including input structs.
 * Every non-OK leaves ALL output bytes and written unchanged. No partial write.
 * Missing either policy returns NOT_SUPPLIED, never substitutes a default.
 * All inputs are copied before sole Go Prepare/Inspect. No keys, signing,
 * crypto verification, clock/nonce generation, frame writer or authority.
 * Input pointers below are logically const; non-const matches cgo exports. */
int32_t YNXSocialFreshJointProfilePrepareBodyDATA(
 YNXSocialFreshJointProfileInputV1 *input, uint8_t *body_output,
 size_t body_capacity, size_t *written, uint8_t *history_hex64);
int32_t YNXSocialFreshJointProfileInspectBodyDATA(
 YNXSocialJointSpan body_original, YNXSocialFreshJointProfileInputV1 *input,
 uint8_t *body_output, size_t body_capacity, size_t *written,
 uint8_t *history_hex64);
#ifdef __cplusplus
}
#endif
#endif
