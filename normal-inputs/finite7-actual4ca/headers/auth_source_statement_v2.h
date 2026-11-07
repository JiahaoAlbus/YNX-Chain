#ifndef YNX_AUTH_SOURCE_STATEMENT_V2_H
#define YNX_AUTH_SOURCE_STATEMENT_V2_H
#include "registered_n1_verify.h"

#define YNX_AUTH_SOURCE_STATEMENT_ABI_V1 1u
#define YNX_AUTH_SOURCE_STATEMENT_BODY_MAX_V2 65536u
#define YNX_AUTH_SOURCE_STATEMENT_MEMBER_MAX_V2 262144u

enum YNXAuthSourceStatementRoleV2 {
 YNX_AUTH_SOURCE_ENROLLMENT_V2 = 1,
 YNX_AUTH_SOURCE_PROFILE_V2 = 2,
 YNX_AUTH_SOURCE_CURRENT_V2 = 3
};
typedef struct {
 uint32_t version, struct_size, role, reserved;
 YNXReadOnlyPublicSpanV1 member, body_original, expected_frame, network, owner, pk_a, pk_b;
 uint64_t key_version, issued_height, observed_height, active_from, revoked_at;
 uint32_t enabled, has_revoked_at;
} YNXAuthSourceStatementVerifyRequestV2;

/* Public synchronous DATA mathematics only. No Root/Source/current admission,
 * product schema, capture, network/files, private key, signing or retained state.
 * The sole SDK must validate the four originals, complete Root/release policy,
 * independently acquired registration/current/floor and lifecycle BEFORE AND
 * AFTER this call. An input struct or successful result cannot replace them.
 *
 * Builds the ORIGINAL E8: domain YNX/AUTH/SOURCE-ORIGINAL/V2, role text,
 * expected_frame, lowercase network hex TEXT, owner TEXT, key_version decimal
 * TEXT, issued_height decimal TEXT, exact canonical body_original UTF8.
 * The same original EncodeFields count/length BE32 framing is used. Only the
 * role selects AUTH-SOURCE-ENROLLMENT / AUTH-SOURCE-PROFILE / AUTH-SOURCE-CURRENT.
 * There is no arbitrary purpose/message or provider override. expected_frame
 * is 1..512 UTF8 bytes with no NUL, chosen from the SAME independently admitted
 * immutable release row, never inferred from the member. There is no default.
 * body_original is 1..65536 bytes of original JS canonical JSON, including
 * safe integers/UTF16 key order; product fields remain the sole SDK's contract.
 * member is 1..262144; network32, owner42 lowercase 0x+40hex, pk_a2592/pk_b64.
 * key_version>0; observed_height>0; active_from<=issued_height<=observed_height;
 * current additionally requires issued_height==observed_height. Enabled and
 * revoked binding semantics are exactly RegisteredAND N1, checked every call.
 * Full expected pair and exact message, BOTH signatures and BOTH roots are
 * verified by the shared RegisteredAND implementation. N=1,index=0 only.
 *
 * Return codes/result are YNXRegisteredN1VerifyStatusV1 and
 * YNXRegisteredANDMemberVerifyN1ResultV1. Success verified=1,member_count=1,
 * index=0; cleanup_status=0 NOT_APPLICABLE (public-only); reserved=0.
 * Layout rejection writes NOTHING. After valid layout result is initialized
 * version1,size32,all other fields0 before ABI/content/flag checks. Failure
 * cannot expose a partial success. role/version/reserved/shape/canonical DATA
 * errors=ARGUMENT; issuance/registration mismatch=TRUST_DENIED; strict wire,
 * N1 and AND failures use the existing MALFORMED/N1_REQUIRED/MATH_INVALID codes.
 *
 * 64-bit ABI. Caller supplies live immutable correctly sized synchronous spans
 * and aligned request/result. This ABI cannot validate arbitrary mapped-pointer
 * provenance/lifetime. Nonempty input extents must not overflow. Read-only input
 * spans may overlap one another; result is disjoint from request and ALL input
 * spans. No input is modified. No authority, physical erasure or mobile build
 * qualification is implied by a math result or a host build.
 */
#ifdef __cplusplus
extern "C" {
#endif
int32_t YNXAuthSourceStatementVerifyV2(YNXAuthSourceStatementVerifyRequestV2 *request,
 YNXRegisteredANDMemberVerifyN1ResultV1 *result);
#ifdef __cplusplus
}
#define YNX_SOURCE_STATIC_ASSERT static_assert
#else
#define YNX_SOURCE_STATIC_ASSERT _Static_assert
#endif
YNX_SOURCE_STATIC_ASSERT(sizeof(YNXAuthSourceStatementVerifyRequestV2)==176,"request176");
YNX_SOURCE_STATIC_ASSERT(offsetof(YNXAuthSourceStatementVerifyRequestV2,member)==16,"member16");
YNX_SOURCE_STATIC_ASSERT(offsetof(YNXAuthSourceStatementVerifyRequestV2,key_version)==128,"revision128");
YNX_SOURCE_STATIC_ASSERT(offsetof(YNXAuthSourceStatementVerifyRequestV2,enabled)==168,"enabled168");
#undef YNX_SOURCE_STATIC_ASSERT
#endif
