#ifndef YNX_REGISTERED_N1_VERIFY_CABI_V1_H
#define YNX_REGISTERED_N1_VERIFY_CABI_V1_H

#include <stddef.h>
#include <stdint.h>

#define YNX_REGISTERED_N1_VERIFY_VERSION_V1 1u
#define YNX_REGISTERED_N1_MEMBER_MAX_V1 98304u
#define YNX_REGISTERED_N1_MESSAGE_MAX_V1 65536u

typedef struct {
    const uint8_t *data;
    uint64_t bytes;
} YNXReadOnlyPublicSpanV1;

typedef struct {
    uint32_t version, struct_size;
    YNXReadOnlyPublicSpanV1 member, message, network, owner, purpose, pk_a, pk_b;
    uint64_t policy_revision, observed_height, active_from, revoked_at;
    uint32_t enabled, has_revoked_at;
} YNXRegisteredANDMemberVerifyN1RequestV1;

typedef struct {
    uint32_t version, struct_size, verified, member_count, index, cleanup_status;
    uint64_t reserved;
} YNXRegisteredANDMemberVerifyN1ResultV1;

enum YNXRegisteredN1VerifyStatusV1 {
    YNX_N1_VERIFY_OK = 0,
    YNX_N1_VERIFY_ARGUMENT = 1,
    YNX_N1_VERIFY_MALFORMED = 2,
    YNX_N1_VERIFY_TRUST_DENIED = 3,
    YNX_N1_VERIFY_N1_REQUIRED = 4,
    YNX_N1_VERIFY_MATH_INVALID = 5,
    YNX_N1_VERIFY_INTERNAL = 6
};

/* Public read-only DATA mathematics, not Source Root authority or approval.
 * Fixed YNX-BATCH/v0.1 ML-DSA-87+SHA3-512 AND SLH-DSA-SHA2-256f+SHA-512.
 * Require a strict encoded Member, N=1,index=0, empty BOTH paths, exact expected
 * message/network/owner/purpose/full pair, BOTH signatures and BOTH tree roots.
 * No key/sign/file/network/global resolver, retained handle, policy registration
 * or cache. Expected public binding must be independently admitted by Auth;
 * supplying these fields never establishes Root/current/account authority.
 *
 * member1..98304/message0..65536/network32/owner1..128/purpose1..64/
 * pk_a2592/pk_b64. Owner and purpose use protocol printable ASCII32..126;
 * comparisons are byte-exact. Message is opaque; Auth builds/checks its own
 * versioned BE32 transcript and chooses the expected purpose independently.
 * revision>0, observed_height>0, enabled=1, flags exactly0/1; no revoked_at
 * value when has_revoked_at=0. Require observed>=active_from; if revoked,
 * revoked_at>=active_from and observed<revoked_at. These live fields are checked
 * on every call and supplied only to a detached, exact per-call resolver.
 *
 * 64-bit ABI only. Caller owns live correctly sized immutable synchronous
 * allocations and aligned request/result. This ABI cannot prove arbitrary
 * pointer mapping/provenance/lifetime. Inputs may overlap each other. Nonempty
 * spans need nonnull pointers and nonoverflowing extents. The result must be
 * disjoint from request and EVERY nonempty input span. Layout/extent rejection
 * writes NOTHING, including result scalars; callers should initialize result.
 * After safe layout admission initialize version1,size32 and ALL other fields0
 * BEFORE version/flags/content parsing. Request and borrowed bytes never change.
 * Request pointer is nonconst only to match cgo's generated export declaration.
 *
 * Success alone sets verified=1,member_count=1,index=0. cleanup_status=0 means
 * NOT_APPLICABLE: no private custody is entered. reserved is always0. Failures
 * retain initialized zeros: ARGUMENT=shape/flags/ASCII/ABI/layout; MALFORMED=
 * strict wire failure; TRUST_DENIED=inactive/revoked/revision/height or expected
 * context/pair mismatch; N1_REQUIRED=well-formed non-N1 Member; MATH_INVALID=
 * exact expected-message mismatch or either signature/tree failure; INTERNAL=
 * internal failure/panic. No partial proof, signature or key is returned.
 */
#ifdef __cplusplus
extern "C" {
#endif
int32_t YNXRegisteredANDMemberVerifyN1V1(
    YNXRegisteredANDMemberVerifyN1RequestV1 *request,
    YNXRegisteredANDMemberVerifyN1ResultV1 *result);
#ifdef __cplusplus
}
#define YNX_N1_STATIC_ASSERT static_assert
#else
#define YNX_N1_STATIC_ASSERT _Static_assert
#endif
YNX_N1_STATIC_ASSERT(sizeof(void *) == 8, "64-bit ABI only");
YNX_N1_STATIC_ASSERT(sizeof(YNXReadOnlyPublicSpanV1) == 16, "span16");
YNX_N1_STATIC_ASSERT(sizeof(YNXRegisteredANDMemberVerifyN1RequestV1) == 160, "request160");
YNX_N1_STATIC_ASSERT(offsetof(YNXRegisteredANDMemberVerifyN1RequestV1, member) == 8, "member8");
YNX_N1_STATIC_ASSERT(offsetof(YNXRegisteredANDMemberVerifyN1RequestV1, policy_revision) == 120, "revision120");
YNX_N1_STATIC_ASSERT(offsetof(YNXRegisteredANDMemberVerifyN1RequestV1, enabled) == 152, "enabled152");
YNX_N1_STATIC_ASSERT(sizeof(YNXRegisteredANDMemberVerifyN1ResultV1) == 32, "result32");
#undef YNX_N1_STATIC_ASSERT
#endif
