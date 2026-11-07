#ifndef YNX_ARTIFACT_RELEASE_CABI_V1_H
#define YNX_ARTIFACT_RELEASE_CABI_V1_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define YNX_ARTIFACT_PUBLICATION_ABI_V1 1u
#define YNX_ARTIFACT_PUBLICATION_MEMBER_CAPACITY_V1 98304u
#define YNX_ARTIFACT_PUBLICATION_REGISTRATION_MAX_V1 8192u
#define YNX_ARTIFACT_PUBLICATION_MANIFEST_MAX_V1 16384u

typedef struct {
    const uint8_t *bytes;
    size_t length;
} YNXArtifactBytesV1;

/* Independently selected by Main's original Auth Source/current path. These
 * DATA fields do not grant publisher authority. Never derive this expected
 * binding solely from the registration supplied for signing. Text is exact
 * UTF-8 bytes, without a terminating NUL; key version is canonical decimal. */
typedef struct {
    YNXArtifactBytesV1 network_id;            /* 32 bytes */
    YNXArtifactBytesV1 subject_owner;         /* 42 lowercase 0x hex bytes */
    YNXArtifactBytesV1 account;               /* 1..256 bytes */
    YNXArtifactBytesV1 project_id;            /* 1..256 bytes */
    YNXArtifactBytesV1 publisher_id;          /* 1..256 bytes */
    YNXArtifactBytesV1 publisher_key_version; /* 1..20 bytes */
    YNXArtifactBytesV1 pk_a;                  /* 2592 bytes */
    YNXArtifactBytesV1 pk_b;                  /* 64 bytes */
} YNXArtifactPublisherExpectedV1;

typedef struct {
    uint32_t abi_version; /* YNX_ARTIFACT_PUBLICATION_ABI_V1 */
    size_t struct_size;   /* sizeof(YNXArtifactPublicationRequestV1) */
    YNXArtifactBytesV1 registration_original; /* original R, 1..8192 bytes */
    YNXArtifactBytesV1 manifest_original;     /* original canonical JSON */
    YNXArtifactPublisherExpectedV1 expected;
    /* Private KEY7 borrow, NOT an IPC/Node/JS interface. Main alone parses its
     * custody record, obtains current binding/review/once, and owns final wipe.
     * Only these four fixed standard material spans enter this same-process
     * synchronous call. Format/version/suite are fixed, never parameters. */
    YNXArtifactBytesV1 pkcs8_a; /* exactly 54 bytes */
    YNXArtifactBytesV1 pkcs8_b; /* exactly 150 bytes */
    YNXArtifactBytesV1 pk_a;    /* exactly 2592 bytes */
    YNXArtifactBytesV1 pk_b;    /* exactly 64 bytes */
} YNXArtifactPublicationRequestV1;

enum YNXArtifactPublicationResultV1 {
    YNX_ARTIFACT_OK_V1 = 0,
    YNX_ARTIFACT_INVALID_ARGUMENT_V1 = 1,
    YNX_ARTIFACT_BOUNDS_V1 = 2,
    YNX_ARTIFACT_OVERLAP_V1 = 3,
    YNX_ARTIFACT_CAPACITY_V1 = 4,
    YNX_ARTIFACT_PUBLIC_BINDING_V1 = 5,
    YNX_ARTIFACT_KEY_MATERIAL_V1 = 6,
    YNX_ARTIFACT_SIGNING_V1 = 7,
    YNX_ARTIFACT_OUTPUT_VALIDATION_V1 = 8,
    YNX_ARTIFACT_CLEANUP_V1 = 9,
    YNX_ARTIFACT_INTERNAL_V1 = 10
};

enum YNXArtifactPublicationCleanupV1 {
    YNX_ARTIFACT_CLEANUP_UNKNOWN_V1 = 0,
    YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1 = 1,
    /* ONLY: owned explicit material copies were Clear'ed and any imported
     * handle was Destroy'ed, with no cleanup panic. No key/handle is retained.
     * This is NOT physical erasure of Go stacks/heaps or CIRCL internals.
     * CIRCL SLH seed/prfKey slices have no upstream physical-zero API. */
    YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1 = 2,
    YNX_ARTIFACT_CLEANUP_FAILED_V1 = 3
};

/* Single synchronous, fixed-purpose operation; no callbacks, keys returned,
 * retained pointers/handles, algorithm/provider/purpose/randomness overrides,
 * helper process, or classic fallback. It signs only the exact original
 * ArtifactPublication message as N=1/index=0 and returns public memberOriginal.
 * Main remains responsible for Source/current/ACL/review/once and final KEY7
 * wipe; mathematical key possession never supplies those facts.
 *
 * Every pointer must refer to a live, correctly sized/aligned C allocation for
 * the entire call. The request and input spans are read-only despite the
 * non-const request pointer needed by the generated cgo declaration. No caller
 * may mutate any input concurrently. This ABI cannot validate arbitrary bad
 * pointers, object lifetime, page permissions or the actual allocation size.
 *
 * Allocate exactly MEMBER_CAPACITY_V1 output bytes (no sizing/signing retry).
 * All three writable output ranges must be mutually disjoint and disjoint from
 * the request and every input range. Extent overflow or overlap is rejected
 * before any write or private-byte read. Input/input overlap is permitted.
 * Initialize *out_length=0 and *cleanup_status=UNKNOWN before calling: rejected
 * pointer/layout requests leave ALL outputs untouched. After layout admission,
 * failure leaves out_length=0 and the member buffer untouched. Success writes
 * only out_length bytes, AFTER logical cleanup completed. Ignore all outputs
 * unless result==OK and cleanup_status==LOGICAL_COMPLETE. Unknown/failed cleanup
 * releases no signature and must not cause automatic retry/re-signing.
 */
int32_t YNXArtifactPublicationSignV1(
    YNXArtifactPublicationRequestV1 *request,
    uint8_t *caller_buffer,
    size_t capacity,
    size_t *out_length,
    uint32_t *cleanup_status);

#ifdef __cplusplus
}
#endif
#endif
