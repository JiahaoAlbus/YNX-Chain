#ifndef YNX_PUBLISHER_REGISTRATION_CABI_V1_H
#define YNX_PUBLISHER_REGISTRATION_CABI_V1_H

#include "ynx_artifact_release.h"
#include "ynx_project_control.h"
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_PUBLISHER_REGISTRATION_ABI_V1 1u
#define YNX_PUBLISHER_REGISTRATION_MEMBER_CAPACITY_V1 131072u
#define YNX_PUBLISHER_REGISTRATION_PUBLIC_CAPACITY_V1 8192u
#define YNX_PUBLISHER_REGISTRATION_PRIVATE_CAPACITY_V1 16384u

/* Fresh, purpose-isolated publisher identity from the original admitted Main
 * Source. No account key, custodian key, seed, entropy, provider or callback is
 * selectable. These labels do not establish Source/Root/current/ACL consent. */
typedef struct {
    YNXArtifactBytesV1 network_id;
    YNXArtifactBytesV1 subject_owner;
    YNXArtifactBytesV1 account;
    YNXArtifactBytesV1 project_id;
    YNXArtifactBytesV1 publisher_id;
    YNXArtifactBytesV1 publisher_key_version;
} YNXPublisherIdentityV1;

typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    YNXPublisherIdentityV1 identity;
} YNXPublisherGenerateRequestV1;

typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    YNXArtifactBytesV1 public_original;       /* exact R13 */
    YNXArtifactBytesV1 principal_original;    /* exact original Go7 JSON */
    YNXArtifactBytesV1 command_original;      /* exact original Go15 JSON */
    YNXArtifactBytesV1 registration_original; /* exact canonical body16 */
    YNXArtifactPublisherExpectedV1 publisher; /* independently selected R13 */
    uint64_t observed_at_ms;
    YNXArtifactBytesV1 pkcs8_a;
    YNXArtifactBytesV1 pkcs8_b;
    YNXArtifactBytesV1 pk_a;
    YNXArtifactBytesV1 pk_b;
} YNXPublisherPoPRequestV1;

typedef struct {
    uint32_t abi_version;
    size_t struct_size;
    YNXArtifactBytesV1 public_original;
    YNXArtifactBytesV1 principal_original;
    YNXArtifactBytesV1 command_original;
    YNXArtifactBytesV1 registration_original;
    YNXArtifactBytesV1 pop_member_original; /* full raw Member, not a digest */
    YNXArtifactPublisherExpectedV1 publisher;
    /* Independently admitted registered custodian. Both public branches must
     * differ from the new publisher pair. Neither supplied context nor a
     * mathematically valid Member proves that this is a current custodian. */
    YNXProjectControlExpectedV1 custodian;
    uint64_t observed_at_ms;
    YNXArtifactBytesV1 pkcs8_a;
    YNXArtifactBytesV1 pkcs8_b;
    YNXArtifactBytesV1 pk_a;
    YNXArtifactBytesV1 pk_b;
} YNXPublisherCustodianRequestV1;

/* All calls are synchronous, same protected process only. No NAPI, JS, IPC,
 * helper, retained handle, algorithm/purpose override or classic fallback.
 * Main alone obtains explicit review/current/custody authority and reserves
 * the durable once entry BEFORE invoking; failure/UNKNOWN never permits retry.
 *
 * The result and cleanup enums are exactly YNXArtifactPublicationResultV1 and
 * YNXArtifactPublicationCleanupV1. All output ranges, including every scalar,
 * must be mutually disjoint and disjoint from request and ALL input ranges.
 * Live aligned allocation/lifetime/page permission are caller preconditions.
 * Layout rejection writes NOTHING. After layout admission lengths become 0;
 * any failure leaves byte buffers untouched. Success releases bytes only after
 * explicit Go-owned logical cleanup, not physical provider/heap erasure.
 * Main must initialize lengths=0/cleanup=UNKNOWN and discard all outputs unless
 * result==OK && cleanup==LOGICAL_COMPLETE. It owns and wipes every private C
 * output/borrow, including rejected late-current and interrupted persistence.
 * Fixed capacities below are mandatory; there is no sizing/keygen/sign retry.
 */

/* Generates a new OS-random ML-DSA-87 AND SLH-DSA-SHA2-256f pair. The private
 * output is the existing Main storage bytes: ASCII YNX-PUBLISHER-CUSTODY/v1\n,
 * then five big-endian u32-length-prefixed spans R13, PKCS8A54, PKCS8B150,
 * PKA2592, PKB64. The separate public output is the SAME full R13. Never write
 * this private output to disk/log/IPC; retain the first result in Main's normal
 * protected once store before any registration or late callback. Key generation
 * itself performs no registration, publication, Root grant or signature. */
int32_t YNXPublisherGenerateV1(YNXPublisherGenerateRequestV1 *request,
    uint8_t *private_buffer, size_t private_capacity, size_t *private_length,
    uint8_t *public_buffer, size_t public_capacity, size_t *public_length,
    uint32_t *cleanup_status);

/* Fixed IDE-PUBLISHER-REGISTRATION / E9 / N1,index0 PoP using ONLY the new
 * publisher pair. A PoP supplies no existing account/custodian authority. */
int32_t YNXPublisherPoPSignV1(YNXPublisherPoPRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);

/* First validates the full E9 PoP with BOTH signatures and exact originals,
 * then signs fixed AUTH-PUBLISHER-REGISTRATION / E12 / N1,index0 with ONLY the
 * separate custodian pair. E12 binds SHA256 of the entire original raw PoP.
 * Registered/current/custodian-role/ACL/Root/once admission remains Main/Auth's
 * responsibility; a successful mathematical call grants none of these. */
int32_t YNXPublisherCustodianSignV1(YNXPublisherCustodianRequestV1 *request,
    uint8_t *caller_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);

#ifdef __cplusplus
}
#endif
#endif
