#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "product_session_http.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Original CI only: a new private directory contains ephemeral synthetic
 * material prepared by the Go fixture. No Wallet/device/Source, production key,
 * authorization, HTTP operation or chain access exists in this driver. */
enum { CAP = YNX_PRODUCT_SESSION_HTTP_MEMBER_CAPACITY_V4, GUARD = 16,
       INPUT_COUNT = 7, EXPECTED_CASES = 40 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
static Blob inputs[INPUT_COUNT], saved[INPUT_COUNT];
static uint8_t *output;
static unsigned cases;

static void require(int ok, const char *label) {
    if (!ok) {
        fprintf(stderr, "YNX_PRODUCT_SESSION_HTTP_C_REFUSED %s\n", label);
        exit(1);
    }
}
static void wipe(void *memory, size_t length) {
    volatile uint8_t *p = (volatile uint8_t *)memory;
    while (length-- != 0u) { *p++ = 0; }
}
static YNXProductSessionHTTPBytesV4 span(const void *p, size_t length) {
    YNXProductSessionHTTPBytesV4 s = { (const uint8_t *)p, length };
    return s;
}
static void path_for(char *out, size_t capacity, const char *directory, const char *name) {
    int count = snprintf(out, capacity, "%s/%s", directory, name);
    require(count > 0 && (size_t)count < capacity, "fixture_path_bound");
}
static Blob read_blob(const char *directory, const char *name, size_t maximum) {
    char path[4096]; struct stat info; Blob b = { NULL, 0 };
    path_for(path, sizeof(path), directory, name);
    int fd = open(path, O_RDONLY | O_NOFOLLOW);
    require(fd >= 0 && fstat(fd, &info) == 0, "fixture_open");
    require(S_ISREG(info.st_mode) && info.st_nlink == 1 &&
        (info.st_mode & 0777) == 0600 && info.st_size > 0 &&
        (uintmax_t)info.st_size <= maximum, "bounded_private_synthetic_file");
    b.length = (size_t)info.st_size;
    b.bytes = (uint8_t *)malloc(b.length);
    require(b.bytes != NULL, "fixture_allocation");
    size_t used = 0;
    while (used < b.length) {
        ssize_t n = read(fd, b.bytes + used, b.length - used);
        if (n < 0 && errno == EINTR) { continue; }
        require(n > 0, "fixture_read");
        used += (size_t)n;
    }
    uint8_t extra; ssize_t n;
    do { n = read(fd, &extra, 1); } while (n < 0 && errno == EINTR);
    require(n == 0 && close(fd) == 0, "fixture_read_end");
    return b;
}
static void write_public(const char *directory, const char *name,
                         const uint8_t *bytes, size_t length) {
    char path[4096]; path_for(path, sizeof(path), directory, name);
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    require(fd >= 0, "exclusive_public_result");
    size_t used = 0;
    while (used < length) {
        ssize_t n = write(fd, bytes + used, length - used);
        if (n < 0 && errno == EINTR) { continue; }
        require(n > 0, "public_result_write");
        used += (size_t)n;
    }
    require(fsync(fd) == 0 && close(fd) == 0, "public_result_sync");
}
static void check_borrows(void) {
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        require(inputs[i].length == saved[i].length &&
            memcmp(inputs[i].bytes, saved[i].bytes, inputs[i].length) == 0,
            "borrowed_input_modified");
    }
}

/* All non-NULL pointers below are live allocations, including the deliberately
 * misaligned scalar/request addresses. Use memcpy for snapshots, never a C
 * dereference of those misaligned pointers. All writable aliases are inside a
 * full CAP+GUARD allocation, so an erroneous export write remains bounded. */
static void layout_reject(const char *label, YNXProductSessionHTTPRequestV4 *request,
                          uint8_t *out, size_t capacity, size_t *length,
                          uint32_t *cleanup, int32_t expected,
                          const uint8_t *region, size_t region_length) {
    uint8_t output_before[CAP + GUARD];
    uint8_t request_before[sizeof(YNXProductSessionHTTPRequestV4)];
    uint8_t length_before[sizeof(size_t)], cleanup_before[sizeof(uint32_t)];
    uint8_t *before = (uint8_t *)malloc(region_length);
    require(before != NULL, "layout_snapshot_allocation");
    memcpy(before, region, region_length);
    memcpy(output_before, output, sizeof(output_before));
    if (request != NULL) { memcpy(request_before, request, sizeof(request_before)); }
    if (length != NULL) { memcpy(length_before, length, sizeof(length_before)); }
    if (cleanup != NULL) { memcpy(cleanup_before, cleanup, sizeof(cleanup_before)); }
    int32_t result = YNXProductSessionHTTPProofSignV4(request, out, capacity, length, cleanup);
    require(result == expected, label);
    require(memcmp(before, region, region_length) == 0, "layout_changed_live_region");
    require(memcmp(output_before, output, sizeof(output_before)) == 0,
            "layout_changed_public_output");
    require(request == NULL || memcmp(request_before, request, sizeof(request_before)) == 0,
            "layout_changed_request");
    require(length == NULL || memcmp(length_before, length, sizeof(length_before)) == 0,
            "layout_changed_length");
    require(cleanup == NULL || memcmp(cleanup_before, cleanup, sizeof(cleanup_before)) == 0,
            "layout_changed_cleanup");
    check_borrows(); wipe(before, region_length); free(before); cases++;
}
static void reject(const char *label, YNXProductSessionHTTPRequestV4 *request,
                   int32_t expected, uint32_t expected_cleanup) {
    uint8_t before[CAP + GUARD]; memcpy(before, output, sizeof(before));
    YNXProductSessionHTTPRequestV4 request_before;
    memcpy(&request_before, request, sizeof(request_before));
    size_t length = 777; uint32_t cleanup = 999;
    int32_t result = YNXProductSessionHTTPProofSignV4(request, output, CAP, &length, &cleanup);
    require(result == expected, label);
    require(length == 0 && cleanup == expected_cleanup, "failure_scalar_contract");
    require(memcmp(before, output, sizeof(before)) == 0, "failure_without_wire_changed_output");
    require(memcmp(&request_before, request, sizeof(request_before)) == 0,
            "failure_changed_request");
    check_borrows(); cases++;
}

int main(int argc, char **argv) {
    require(argc == 2, "usage_synthetic_input_directory");
    const char *names[INPUT_COUNT] = { "unsigned.json", "SYNTHETIC-ONLY-a.der",
        "SYNTHETIC-ONLY-b.der", "pk-a.bin", "pk-b.bin", "network.bin", "owner.txt" };
    const size_t maxima[INPUT_COUNT] = { YNX_PRODUCT_SESSION_HTTP_MESSAGE_MAX_V4,
        54, 150, 2592, 64, 32, 42 };
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        inputs[i] = read_blob(argv[1], names[i], maxima[i]);
        require(i == 0 || inputs[i].length == maxima[i], "exact_synthetic_material");
        saved[i].length = inputs[i].length;
        saved[i].bytes = (uint8_t *)malloc(saved[i].length);
        require(saved[i].bytes != NULL, "borrow_snapshot_allocation");
        memcpy(saved[i].bytes, inputs[i].bytes, saved[i].length);
    }
    output = (uint8_t *)malloc(CAP + GUARD);
    uint8_t *region = (uint8_t *)malloc(CAP + GUARD);
    require(output != NULL && region != NULL, "live_boundary_allocations");
    memset(output, 0xa5, CAP + GUARD); memset(region, 0xa5, CAP + GUARD);

    YNXProductSessionHTTPRequestV4 r; memset(&r, 0, sizeof(r));
    r.version = YNX_PRODUCT_SESSION_HTTP_VERSION_V4; r.struct_size = sizeof(r);
    r.unsigned_original = span(inputs[0].bytes, inputs[0].length);
    r.pkcs8_a = span(inputs[1].bytes, inputs[1].length);
    r.pkcs8_b = span(inputs[2].bytes, inputs[2].length);
    r.pk_a = span(inputs[3].bytes, inputs[3].length);
    r.pk_b = span(inputs[4].bytes, inputs[4].length);
    r.expected.network_id = span(inputs[5].bytes, inputs[5].length);
    r.expected.owner = span(inputs[6].bytes, inputs[6].length);
    r.expected.pk_a = r.pk_a; r.expected.pk_b = r.pk_b;
    size_t length = 777; uint32_t cleanup = 999;

    /* 1-4: no nil pointer may expose a private borrow or initialize scalars. */
    layout_reject("null_request", NULL, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4, region, CAP + GUARD);
    layout_reject("null_output", &r, NULL, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4, region, CAP + GUARD);
    layout_reject("null_length", &r, output, CAP, NULL, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4, region, CAP + GUARD);
    layout_reject("null_cleanup", &r, output, CAP, &length, NULL,
        YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4, region, CAP + GUARD);

    /* 5-8: fixed ABI and exact capacity, including rejected larger capacity. */
    YNXProductSessionHTTPRequestV4 changed = r; changed.version = 1;
    layout_reject("version_one", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4, region, CAP + GUARD);
    changed = r; changed.struct_size--;
    layout_reject("struct_size", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_INVALID_ARGUMENT_V4, region, CAP + GUARD);
    layout_reject("capacity_short", &r, output, CAP - 1u, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_CAPACITY_V4, region, CAP + GUARD);
    layout_reject("capacity_long", &r, output, CAP + 1u, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_CAPACITY_V4, region, CAP + GUARD);

    /* 9-13: all pointers remain live. SIZE_MAX is rejected as a span length
     * before range arithmetic or any read beyond the CAP allocation boundary. */
    changed = r; changed.unsigned_original.length = 0;
    layout_reject("empty_unsigned", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);
    changed = r; changed.unsigned_original = span(region, YNX_PRODUCT_SESSION_HTTP_MESSAGE_MAX_V4 + 1u);
    layout_reject("oversize_unsigned", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);
    changed = r; changed.unsigned_original.bytes = NULL;
    layout_reject("null_unsigned", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);
    changed = r; changed.pkcs8_a.bytes = NULL;
    layout_reject("null_private_borrow", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);
    changed = r; changed.unsigned_original = span(region + CAP - 1u, SIZE_MAX);
    layout_reject("input_extent_overflow", &changed, output, CAP, &length, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);

    /* 14-16: memcpy admits safe snapshots without dereferencing misalignment. */
    memcpy(region + 1, &r, sizeof(r));
    layout_reject("misaligned_request", (YNXProductSessionHTTPRequestV4 *)(void *)(region + 1),
        output, CAP, &length, &cleanup, YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);
    memset(region, 0xa5, CAP + GUARD);
    layout_reject("misaligned_length", &r, output, CAP, (size_t *)(void *)(region + 1),
        &cleanup, YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);
    layout_reject("misaligned_cleanup", &r, output, CAP, &length,
        (uint32_t *)(void *)(region + 1), YNX_PRODUCT_SESSION_HTTP_BOUNDS_V4, region, CAP + GUARD);

    /* 17-25: each of the nine distinct ABI spans overlaps the full live output
     * allocation in turn. No short DER/public allocation becomes an output. */
    for (size_t i = 0; i < 9; i++) {
        changed = r;
        switch (i) {
        case 0: changed.unsigned_original = span(output, inputs[0].length); break;
        case 1: changed.expected.network_id = span(output, 32); break;
        case 2: changed.expected.owner = span(output, 42); break;
        case 3: changed.expected.pk_a = span(output, 2592); break;
        case 4: changed.expected.pk_b = span(output, 64); break;
        case 5: changed.pkcs8_a = span(output, 54); break;
        case 6: changed.pkcs8_b = span(output, 150); break;
        case 7: changed.pk_a = span(output, 2592); break;
        case 8: changed.pk_b = span(output, 64); break;
        default: require(0, "output_alias_case");
        }
        layout_reject("output_input_overlap", &changed, output, CAP, &length, &cleanup,
            YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    }

    /* 26-33: request/output/scalars and private/scalar overlap. Every extra
     * alias is backed by the live full-size region and must remain untouched. */
    memcpy(region, &r, sizeof(r));
    layout_reject("output_request_overlap", (YNXProductSessionHTTPRequestV4 *)(void *)region,
        region, CAP, &length, &cleanup, YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    memset(region, 0xa5, CAP + GUARD);
    layout_reject("output_length_overlap", &r, output, CAP, (size_t *)(void *)(output + 16),
        &cleanup, YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    layout_reject("output_cleanup_overlap", &r, output, CAP, &length,
        (uint32_t *)(void *)(output + 16), YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    layout_reject("scalar_scalar_overlap", &r, output, CAP, (size_t *)(void *)region,
        (uint32_t *)(void *)region, YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    memcpy(region, inputs[1].bytes, inputs[1].length); changed = r;
    changed.pkcs8_a = span(region, 54);
    layout_reject("private_length_overlap", &changed, output, CAP, (size_t *)(void *)region,
        &cleanup, YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    layout_reject("private_cleanup_overlap", &changed, output, CAP, &length,
        (uint32_t *)(void *)region, YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    memcpy(region, &r, sizeof(r));
    YNXProductSessionHTTPRequestV4 *request_alias = (YNXProductSessionHTTPRequestV4 *)(void *)region;
    layout_reject("request_length_overlap", request_alias, output, CAP, &request_alias->struct_size, &cleanup,
        YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    layout_reject("request_cleanup_overlap", request_alias, output, CAP, &length, &request_alias->version,
        YNX_PRODUCT_SESSION_HTTP_OVERLAP_V4, region, CAP + GUARD);
    wipe(region, CAP + GUARD);

    /* 34: public binding failure must occur before any private material entry. */
    uint8_t wrong_owner[42]; memcpy(wrong_owner, inputs[6].bytes, sizeof(wrong_owner));
    wrong_owner[2] = wrong_owner[2] == '2' ? '3' : '2';
    changed = r; changed.expected.owner = span(wrong_owner, sizeof(wrong_owner));
    reject("wrong_expected_owner", &changed, YNX_PRODUCT_SESSION_HTTP_PUBLIC_BINDING_V4,
        YNX_PRODUCT_SESSION_HTTP_CLEANUP_NOT_REQUIRED_V4);

    /* 35-38: invalid actual DER and borrowed full-pair mismatch. Public or
     * private material is never printed, returned or modified by the export. */
    uint8_t bad_a[54], bad_b[150], bad_pa[2592], bad_pb[64];
    memcpy(bad_a, inputs[1].bytes, sizeof(bad_a)); bad_a[0] ^= 1;
    changed = r; changed.pkcs8_a = span(bad_a, sizeof(bad_a));
    reject("bad_actual_der_a", &changed, YNX_PRODUCT_SESSION_HTTP_KEY_MATERIAL_V4,
        YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4);
    require(memcmp(bad_a + 1, inputs[1].bytes + 1, sizeof(bad_a) - 1u) == 0 &&
        bad_a[0] == (uint8_t)(inputs[1].bytes[0] ^ 1u), "bad_der_a_borrow_modified");
    wipe(bad_a, sizeof(bad_a));
    memcpy(bad_b, inputs[2].bytes, sizeof(bad_b)); bad_b[0] ^= 1;
    changed = r; changed.pkcs8_b = span(bad_b, sizeof(bad_b));
    reject("bad_actual_der_b", &changed, YNX_PRODUCT_SESSION_HTTP_KEY_MATERIAL_V4,
        YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4);
    require(memcmp(bad_b + 1, inputs[2].bytes + 1, sizeof(bad_b) - 1u) == 0 &&
        bad_b[0] == (uint8_t)(inputs[2].bytes[0] ^ 1u), "bad_der_b_borrow_modified");
    wipe(bad_b, sizeof(bad_b));
    memcpy(bad_pa, inputs[3].bytes, sizeof(bad_pa)); bad_pa[0] ^= 1;
    changed = r; changed.pk_a = span(bad_pa, sizeof(bad_pa));
    reject("bad_borrowed_full_pair_a", &changed, YNX_PRODUCT_SESSION_HTTP_KEY_MATERIAL_V4,
        YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4);
    require(memcmp(bad_pa + 1, inputs[3].bytes + 1, sizeof(bad_pa) - 1u) == 0 &&
        bad_pa[0] == (uint8_t)(inputs[3].bytes[0] ^ 1u), "bad_public_a_borrow_modified");
    memcpy(bad_pb, inputs[4].bytes, sizeof(bad_pb)); bad_pb[0] ^= 1;
    changed = r; changed.pk_b = span(bad_pb, sizeof(bad_pb));
    reject("bad_borrowed_full_pair_b", &changed, YNX_PRODUCT_SESSION_HTTP_KEY_MATERIAL_V4,
        YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4);
    require(memcmp(bad_pb + 1, inputs[4].bytes + 1, sizeof(bad_pb) - 1u) == 0 &&
        bad_pb[0] == (uint8_t)(inputs[4].bytes[0] ^ 1u), "bad_public_b_borrow_modified");

    /* 39: exactly one successful real C export. A separate Go process verifies
     * the retained Member's exact E5/N1/full pair and actual dual signatures. */
    length = 0; cleanup = YNX_PRODUCT_SESSION_HTTP_CLEANUP_UNKNOWN_V4;
    uint8_t request_before[sizeof(r)]; memcpy(request_before, &r, sizeof(r));
    require(YNXProductSessionHTTPProofSignV4(&r, output, CAP, &length, &cleanup) ==
        YNX_PRODUCT_SESSION_HTTP_OK_V4, "actual_fixed_http_proof_sign");
    require(length > 0 && length <= CAP &&
        cleanup == YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4, "success_bounds_cleanup");
    for (size_t i = length; i < CAP + GUARD; i++) {
        require(output[i] == 0xa5, "success_changed_unused_capacity");
    }
    require(memcmp(&r, request_before, sizeof(r)) == 0, "success_changed_request");
    check_borrows();
    write_public(argv[1], "memberOriginal.bin", output, length); cases++;

    /* 40: erase every local private copy, including saved snapshots, before
     * re-entry with the original borrowed addresses. No retained internal key
     * may make this second call produce a signature or expose any Member. */
    wipe(inputs[1].bytes, inputs[1].length); wipe(inputs[2].bytes, inputs[2].length);
    wipe(saved[1].bytes, saved[1].length); wipe(saved[2].bytes, saved[2].length);
    wipe(region, CAP + GUARD); memset(output, 0xa5, CAP + GUARD);
    reject("erased_borrows_cannot_reuse_internal_key", &r, YNX_PRODUCT_SESSION_HTTP_KEY_MATERIAL_V4,
        YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4);
    require(cases == EXPECTED_CASES, "exact_boundary_case_count");
    char count[32]; int n = snprintf(count, sizeof(count), "%u\n", cases);
    require(n > 0 && (size_t)n < sizeof(count), "boundary_count_decimal");
    write_public(argv[1], "C-BOUNDARY-CASES.txt", (const uint8_t *)count, (size_t)n);

    for (size_t i = 0; i < INPUT_COUNT; i++) {
        wipe(inputs[i].bytes, inputs[i].length); wipe(saved[i].bytes, saved[i].length);
        free(inputs[i].bytes); free(saved[i].bytes);
    }
    wipe(output, CAP + GUARD); wipe(region, CAP + GUARD); free(output); free(region);
    printf("YNX_PRODUCT_SESSION_HTTP_C_DRIVER_PASS cases=%u authority=false\n", cases);
    return 0;
}
