#if defined(__APPLE__)
/* _POSIX_C_SOURCE alone hides Darwin's O_NOFOLLOW declaration. Keep the
 * actual no-symlink flag; never replace it with a permissive fallback. */
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "ynx_artifact_release.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* CI-only synthetic input. No Main key, issuer, current policy or permission
 * enters this driver. Every pointer below refers to our real live allocation;
 * an ABI is not a sandbox for probing arbitrary addresses. */
enum { CAP = YNX_ARTIFACT_PUBLICATION_MEMBER_CAPACITY_V1, GUARD = 16 };
static unsigned cases;
typedef struct { uint8_t *bytes; size_t length; } Blob;

static void require(int ok, const char *label) {
    if (!ok) { fprintf(stderr, "YNX_CABI_C_REFUSED %s\n", label); exit(1); }
}
static void wipe(void *memory, size_t length) {
    volatile uint8_t *p = (volatile uint8_t *)memory;
    while (length-- != 0u) { *p++ = 0; }
}
static YNXArtifactBytesV1 span(const void *bytes, size_t length) {
    YNXArtifactBytesV1 value = { (const uint8_t *)bytes, length }; return value;
}
static YNXArtifactBytesV1 text(const char *value) { return span(value, strlen(value)); }
static void path_for(char *out, size_t cap, const char *directory, const char *name) {
    int count = snprintf(out, cap, "%s/%s", directory, name);
    require(count > 0 && (size_t)count < cap, "fixture_path_bound");
}
static Blob read_blob(const char *directory, const char *name, size_t minimum, size_t maximum) {
    char path[4096]; struct stat info; Blob b = { NULL, 0 };
    path_for(path, sizeof(path), directory, name);
    int fd = open(path, O_RDONLY | O_NOFOLLOW);
    require(fd >= 0 && fstat(fd, &info) == 0, "fixture_open");
    require(S_ISREG(info.st_mode) && info.st_nlink == 1 && info.st_size >= 0 &&
        (size_t)info.st_size >= minimum && (size_t)info.st_size <= maximum, "fixture_regular_size");
    b.length = (size_t)info.st_size;
    b.bytes = (uint8_t *)malloc(b.length);
    require(b.bytes != NULL, "fixture_allocation");
    size_t used = 0;
    while (used < b.length) {
        ssize_t count = read(fd, b.bytes + used, b.length - used);
        if (count < 0 && errno == EINTR) { continue; }
        require(count > 0, "fixture_read"); used += (size_t)count;
    }
    uint8_t extra; require(read(fd, &extra, 1) == 0 && close(fd) == 0, "fixture_read_end");
    return b;
}
static void write_public(const char *directory, const char *name, const void *bytes, size_t length) {
    char path[4096]; path_for(path, sizeof(path), directory, name);
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    require(fd >= 0, "exclusive_public_output");
    size_t used = 0;
    while (used < length) {
        ssize_t count = write(fd, (const uint8_t *)bytes + used, length - used);
        if (count < 0 && errno == EINTR) { continue; }
        require(count > 0, "public_output_write"); used += (size_t)count;
    }
    require(fsync(fd) == 0 && close(fd) == 0, "public_output_sync");
}
static void passed(const char *label) {
    cases++; printf("YNX_CABI_C_CASE_PASS %s\n", label);
}
static void layout_reject(const char *label, YNXArtifactPublicationRequestV1 *request,
        uint8_t *output, size_t capacity, size_t *length, uint32_t *cleanup,
        int32_t expected, const void *region, size_t region_length) {
    uint8_t *before = (uint8_t *)malloc(region_length);
    require(before != NULL, "snapshot_allocation"); memcpy(before, region, region_length);
    YNXArtifactPublicationRequestV1 request_before;
    if (request != NULL) { memcpy(&request_before, request, sizeof(request_before)); }
    size_t old_length = length == NULL ? 0 : *length;
    uint32_t old_cleanup = cleanup == NULL ? 0 : *cleanup;
    int32_t result = YNXArtifactPublicationSignV1(request, output, capacity, length, cleanup);
    require(result == expected, label);
    require(memcmp(before, region, region_length) == 0, "layout_rejection_changed_buffer");
    require(request == NULL || memcmp(&request_before, request, sizeof(request_before)) == 0, "layout_rejection_changed_request");
    require(length == NULL || *length == old_length, "layout_rejection_changed_length");
    require(cleanup == NULL || *cleanup == old_cleanup, "layout_rejection_changed_cleanup");
    free(before); passed(label);
}
static void admitted_reject(const char *label, YNXArtifactPublicationRequestV1 *request,
        uint8_t *output, int32_t expected, uint32_t expected_cleanup) {
    memset(output, 0xa5, CAP + GUARD);
    size_t length = 999; uint32_t cleanup = 999;
    require(YNXArtifactPublicationSignV1(request, output, CAP, &length, &cleanup) == expected, label);
    require(length == 0 && cleanup == expected_cleanup, "admitted_failure_lifecycle");
    for (size_t i = 0; i < CAP + GUARD; i++) { require(output[i] == 0xa5, "admitted_failure_released_output"); }
    passed(label);
}
static size_t successful(const char *label, YNXArtifactPublicationRequestV1 *request, uint8_t *output,
        size_t initial_length, uint32_t initial_cleanup) {
    memset(output, 0xa5, CAP + GUARD);
    size_t length = initial_length; uint32_t cleanup = initial_cleanup;
    require(YNXArtifactPublicationSignV1(request, output, CAP, &length, &cleanup) == YNX_ARTIFACT_OK_V1, label);
    require(cleanup == YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1 && length > 0 && length <= CAP, "success_logical_cleanup_required");
    for (size_t i = length; i < CAP + GUARD; i++) { require(output[i] == 0xa5, "success_touched_unused_capacity"); }
    passed(label); return length;
}
static uint8_t *find_bytes(Blob blob, const char *needle) {
    size_t n = strlen(needle);
    for (size_t i = 0; i + n <= blob.length; i++) {
        if (memcmp(blob.bytes + i, needle, n) == 0) { return blob.bytes + i; }
    }
    require(0, "expected_public_fixture_tag_missing"); return NULL;
}

int main(int argc, char **argv) {
    require(argc == 3, "usage_driver_input_new_output");
    require(mkdir(argv[2], 0700) == 0, "exclusive_output_directory");
    Blob registration = read_blob(argv[1], "registration.bin", 1, 8192);
    Blob manifest = read_blob(argv[1], "manifest.json", 1, 16384);
    Blob a = read_blob(argv[1], "SYNTHETIC-ONLY-a.der", 54, 54);
    Blob b = read_blob(argv[1], "SYNTHETIC-ONLY-b.der", 150, 150);
    Blob pa = read_blob(argv[1], "pk-a.bin", 2592, 2592);
    Blob pb = read_blob(argv[1], "pk-b.bin", 64, 64);
    uint8_t saved_a[54], saved_b[150]; memcpy(saved_a,a.bytes,54); memcpy(saved_b,b.bytes,150);
    uint8_t network[32]; memset(network, 0x42, sizeof(network));
    uint8_t *output = (uint8_t *)malloc(CAP + GUARD);
    require(output != NULL, "output_allocation"); memset(output,0xa5,CAP+GUARD);
    YNXArtifactPublicationRequestV1 request;
    memset(&request,0,sizeof(request));
    request.abi_version = YNX_ARTIFACT_PUBLICATION_ABI_V1; request.struct_size = sizeof(request);
    request.registration_original = span(registration.bytes,registration.length);
    request.manifest_original = span(manifest.bytes,manifest.length);
    request.expected.network_id = span(network,sizeof(network));
    request.expected.subject_owner = text("0x1111111111111111111111111111111111111111");
    request.expected.account = text("developer-synthetic-owner");
    request.expected.project_id = text("project-alpha");
    request.expected.publisher_id = text("publisher-alpha");
    request.expected.publisher_key_version = text("1");
    request.expected.pk_a = span(pa.bytes,pa.length); request.expected.pk_b = span(pb.bytes,pb.length);
    request.pkcs8_a = span(a.bytes,a.length); request.pkcs8_b = span(b.bytes,b.length);
    /* Expected/public material input-input aliases are deliberately legal. */
    request.pk_a = request.expected.pk_a; request.pk_b = request.expected.pk_b;
    size_t length = 777; uint32_t cleanup = 999;
    layout_reject("null_request",NULL,output,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    layout_reject("null_output",&request,NULL,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    layout_reject("null_length",&request,output,CAP,NULL,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    layout_reject("null_cleanup",&request,output,CAP,&length,NULL,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    for (size_t cap_index = 0; cap_index < 3; cap_index++) {
        const size_t capacities[3] = {0,CAP-1,CAP+1};
        layout_reject("exact_capacity_required",&request,output,capacities[cap_index],&length,&cleanup,
            YNX_ARTIFACT_CAPACITY_V1,output,CAP+GUARD);
    }
    YNXArtifactPublicationRequestV1 changed = request;
    changed.abi_version++;
    layout_reject("abi_version",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    changed = request; changed.struct_size--;
    layout_reject("struct_size",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    changed = request; changed.pkcs8_a.bytes = NULL;
    layout_reject("null_input_span",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    changed = request; changed.pkcs8_b.length--;
    layout_reject("short_key_span",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    changed = request; changed.pk_a.length = SIZE_MAX;
    layout_reject("input_extent_bound",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    /* Check each actual input span, not just one private-key range. Each
     * overlapping buffer is a real CAP-sized allocation, never a bad address. */
    for (size_t index = 0; index < 14; index++) {
        changed = request;
        YNXArtifactBytesV1 *inputs[14] = {&changed.registration_original,&changed.manifest_original,
            &changed.expected.network_id,&changed.expected.subject_owner,&changed.expected.account,&changed.expected.project_id,
            &changed.expected.publisher_id,&changed.expected.publisher_key_version,&changed.expected.pk_a,&changed.expected.pk_b,
            &changed.pkcs8_a,&changed.pkcs8_b,&changed.pk_a,&changed.pk_b};
        uint8_t *overlap = (uint8_t *)malloc(CAP+GUARD);
        require(overlap != NULL, "overlap_allocation"); memset(overlap,0xa5,CAP+GUARD);
        memcpy(overlap,inputs[index]->bytes,inputs[index]->length); inputs[index]->bytes = overlap;
        layout_reject("output_input_overlap",&changed,overlap,CAP,&length,&cleanup,YNX_ARTIFACT_OVERLAP_V1,overlap,CAP+GUARD);
        wipe(overlap,CAP+GUARD); free(overlap);
    }
    uint8_t *request_region = (uint8_t *)malloc(CAP+GUARD);
    require(request_region != NULL, "overlap_request_allocation"); memset(request_region,0xa5,CAP+GUARD);
    memcpy(request_region,&request,sizeof(request));
    layout_reject("output_request_overlap",(YNXArtifactPublicationRequestV1 *)(void *)request_region,request_region,CAP,
        &length,&cleanup,YNX_ARTIFACT_OVERLAP_V1,request_region,CAP+GUARD);
    free(request_region);
    memset(output,0xa5,CAP+GUARD);
    size_t *alias_length = (size_t *)(void *)output; *alias_length = 777;
    layout_reject("length_output_overlap",&request,output,CAP,alias_length,&cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    changed = request;
    layout_reject("length_request_overlap",&changed,output,CAP,&changed.struct_size,&cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    union { size_t length; uint32_t cleanup; } alias;
    alias.length = 0;
    layout_reject("writable_scalars_overlap",&request,output,CAP,&alias.length,&alias.cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    changed = request;
    layout_reject("cleanup_request_overlap",&changed,output,CAP,&length,&changed.abi_version,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    changed = request; changed.expected.publisher_id = text("other-publisher");
    admitted_reject("independent_expected_publisher",&changed,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);
    uint8_t *purpose = find_bytes(registration,"ARTIFACT-RELEASE"); uint8_t purpose_first = *purpose; *purpose = 'X';
    admitted_reject("fixed_purpose_only",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1); *purpose = purpose_first;
    uint8_t *project = find_bytes(manifest,"project-alpha"); uint8_t project_first = *project; *project = 'X';
    admitted_reject("manifest_project_binding",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1); *project = project_first;
    uint8_t bad_public[64]; memcpy(bad_public,pb.bytes,64); bad_public[0] ^= 1;
    changed = request; changed.expected.pk_b = span(bad_public,sizeof(bad_public));
    admitted_reject("independent_full_pair_binding",&changed,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);
    changed = request; changed.pk_b = span(bad_public,sizeof(bad_public));
    admitted_reject("borrowed_full_pair_consistency",&changed,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    a.bytes[0] ^= 1;
    admitted_reject("ml_dsa_der_rejected",&request,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1); a.bytes[0] ^= 1;
    b.bytes[b.length-1] ^= 1;
    admitted_reject("slh_derived_root_rejected",&request,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1); b.bytes[b.length-1] ^= 1;
    size_t first_length = successful("actual_dual_signature",&request,output,0,YNX_ARTIFACT_CLEANUP_UNKNOWN_V1);
    write_public(argv[2],"memberOriginal.bin",output,first_length);
    require(memcmp(a.bytes,saved_a,54) == 0 && memcmp(b.bytes,saved_b,150) == 0,"borrowed_private_inputs_changed");
    wipe(a.bytes,a.length); wipe(b.bytes,b.length);
    admitted_reject("no_retained_signer_after_borrow_wipe",&request,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    memcpy(a.bytes,saved_a,54); memcpy(b.bytes,saved_b,150);
    size_t second_length = successful("dirty_scalars_are_initialized_after_admission",&request,output,777,999);
    write_public(argv[2],"memberOriginal-second.bin",output,second_length);
    require(memcmp(a.bytes,saved_a,54) == 0 && memcmp(b.bytes,saved_b,150) == 0,"borrowed_private_inputs_changed_second_call");
    wipe(a.bytes,a.length); wipe(b.bytes,b.length); wipe(saved_a,sizeof(saved_a)); wipe(saved_b,sizeof(saved_b));
    free(a.bytes); free(b.bytes); free(pa.bytes); free(pb.bytes); free(registration.bytes); free(manifest.bytes);
    wipe(output,CAP+GUARD); free(output);
    char result[256]; int count = snprintf(result,sizeof(result),
        "{\"version\":\"YNX-ARTIFACT-RELEASE-CABI-C-RESULT/v1\",\"cases\":%u,\"syntheticOnly\":true,\"logicalCleanupOnly\":true}\n",cases);
    require(count > 0 && (size_t)count < sizeof(result),"public_result_bound");
    write_public(argv[2],"C-RESULT.json",result,(size_t)count);
    printf("YNX_ARTIFACT_CABI_C_BOUNDARY_PASS cases=%u physicalEraseClaimed=false\n",cases);
    return 0;
}
