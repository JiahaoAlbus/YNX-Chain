#ifndef YNX_DEPLOYMENT_MANIFEST_CABI_V2_H
#define YNX_DEPLOYMENT_MANIFEST_CABI_V2_H
#include "ynx_artifact_release.h"
#ifdef __cplusplus
extern "C" {
#endif

#define YNX_DEPLOYMENT_MANIFEST_ABI_V2 2u
#define YNX_DEPLOYMENT_MANIFEST_MEMBER_CAPACITY_V2 98304u
#define YNX_DEPLOYMENT_MANIFEST_MAX_V2 16384u
#define YNX_DEPLOYMENT_ARTIFACT_MAX_V2 67108864u
#define YNX_DEPLOYMENT_BIND_BYTES_V2 152u
#define YNX_DEPLOYMENT_MANIFEST_DOMAIN_V2 "YNX-CLOUD-DEPLOYMENT-MANIFEST/v2"
#define YNX_DEPLOYMENT_MANIFEST_PURPOSE_V2 "CLOUD-DEPLOYMENT-MANIFEST-V2"

/* Fixed SDK a7bfd7800 E11 input, NOT the old six-field ARTIFACT-RELEASE.
 * Original Auth independently selects ALL ten fields, issuer/publisher fullRef
 * and their independent epochs/currentness, approves this exact E11 and lends
 * its purpose-isolated held publisher pair. Neither a submitter's duplicate
 * bytes nor matching hashes create those Source/current/approval facts.
 *
 * WIRE BindE3=E(U64BE8(actual byte count),SHA3-512 raw64,SHA-512 raw64).
 * It is NOT decimal/hex text, JSON, an asset registration or a Root grant.
 * expected_payload_original is original Auth's independent canonical E11;
 * checking it binds exact fullRefs/epochs without deriving them from Ref.rev.
 * The two binds are independently selected by that same original Source.
 */
typedef struct {
    uint32_t abi_version; /* 2 */
    size_t struct_size;   /* sizeof(YNXDeploymentManifestRequestV2) */
    YNXArtifactBytesV1 payload_original;          /* exact E11, 1..16384 */
    YNXArtifactBytesV1 actual_artifact;           /* 0..67108864; NULL iff empty is permitted */
    YNXArtifactBytesV1 expected_payload_original; /* independently held E11, 1..16384 */
    YNXArtifactBytesV1 expected_payload_bind;     /* exact BindE3, 152 */
    YNXArtifactBytesV1 expected_artifact_bind;    /* exact BindE3, 152 */
    /* Existing batch mathematical context labels, supplied independently.
     * These are NOT an asset lookup, inferred fullRef, issuer authority,
     * account registration or permission to use a key. */
    YNXArtifactBytesV1 profile_network_id; /* 32 */
    YNXArtifactBytesV1 subject_owner;      /* existing ASCII label, 1..128 */
    YNXArtifactBytesV1 expected_pk_a;      /* independent full ML-DSA-87 public, 2592 */
    YNXArtifactBytesV1 expected_pk_b;      /* independent full SLH-SHA2-256f public, 64 */
    /* Private same-process, synchronous C borrow only. No JS/IPC/JSON/file
     * transport, key generation, export, retained handle or key-role override.
     * Original Native custodian alone obtains the protected publisher pair. */
    YNXArtifactBytesV1 pkcs8_a; /* 54 */
    YNXArtifactBytesV1 pkcs8_b; /* 150 */
    YNXArtifactBytesV1 pk_a;    /* 2592 */
    YNXArtifactBytesV1 pk_b;    /* 64 */
} YNXDeploymentManifestRequestV2;

/* Result and cleanup numeric values are exactly YNXArtifactPublicationResultV1
 * and YNXArtifactPublicationCleanupV1 from the included original public header.
 * This new symbol signs only exact E11 under the NEW fixed purpose above,
 * N=1/index=0/empty paths, ML-DSA-87 AND SLH-DSA-SHA2-256f. It returns only a
 * public memberOriginal, after actual independent AND verification and logical
 * Clear/Destroy. No physical Go/provider heap erasure guarantee is made.
 *
 * All C allocations, lengths and lifetimes must be valid and inputs stable
 * throughout the call. Input/input aliasing is permitted; ALL three writable
 * output ranges must be disjoint from request, ALL inputs and each other.
 * Alignment/extent/layout rejection leaves ALL outputs unchanged. Initialize
 * length=0 and cleanup=UNKNOWN before calling. Following admission, every
 * error sets length=0 and leaves member bytes untouched. Only OK plus
 * LOGICAL_COMPLETE admits output. UNKNOWN/FAILED must preserve the original
 * Auth once/partial-close association; no automatic retry/new approval.
 * Native owns borrowed material and its final wipe; callee retains no key.
 * There is no generic purpose/provider/algorithm/seed/management override.
 */
int32_t YNXDeploymentManifestSignV2(YNXDeploymentManifestRequestV2 *request,
    uint8_t *member_buffer, size_t capacity, size_t *out_length,
    uint32_t *cleanup_status);

#ifdef __cplusplus
}
#endif
#endif
