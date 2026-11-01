#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "product_pair_pending_original_query.h"
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
enum { CAP = YNX_PENDING_ORIGINAL_QUERY_MEMBER_CAPACITY_V1, GUARD = 16,
       INPUT_COUNT = 14, EXPECTED_CASES = 77 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
static Blob inputs[INPUT_COUNT], saved[INPUT_COUNT];
static uint8_t *output;
static unsigned cases;

static void require(int ok, const char *label) {
    if (!ok) {
        fprintf(stderr, "YNX_PENDING_QUERY_C_REFUSED %s\n", label);
        exit(1);
    }
}
static void wipe(void *memory, size_t length) {
    volatile uint8_t *p = (volatile uint8_t *)memory;
    while (length-- != 0u) { *p++ = 0; }
}
static YNXPendingOriginalQueryBytesV1 span(const void *p, size_t length) {
    YNXPendingOriginalQueryBytesV1 s = { (const uint8_t *)p, length };
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
    require(S_ISREG(info.st_mode) && info.st_nlink == 1 && info.st_uid == geteuid() &&
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
static void layout_reject(const char *label, YNXPendingOriginalQueryRequestV1 *request,
                          uint8_t *out, size_t capacity, size_t *length,
                          uint32_t *cleanup, int32_t expected,
                          const uint8_t *region, size_t region_length) {
    uint8_t output_before[CAP + GUARD];
    uint8_t request_before[sizeof(YNXPendingOriginalQueryRequestV1)];
    uint8_t length_before[sizeof(size_t)], cleanup_before[sizeof(uint32_t)];
    uint8_t *before = (uint8_t *)malloc(region_length);
    require(before != NULL, "layout_snapshot_allocation");
    memcpy(before, region, region_length);
    memcpy(output_before, output, sizeof(output_before));
    if (request != NULL) { memcpy(request_before, request, sizeof(request_before)); }
    if (length != NULL) { memcpy(length_before, length, sizeof(length_before)); }
    if (cleanup != NULL) { memcpy(cleanup_before, cleanup, sizeof(cleanup_before)); }
    int32_t result = YNXProductPairPendingOriginalQuerySignV1(request, out, capacity, length, cleanup);
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
static void reject(const char *label, YNXPendingOriginalQueryRequestV1 *request,
                   int32_t expected, uint32_t expected_cleanup) {
    uint8_t before[CAP + GUARD]; memcpy(before, output, sizeof(before));
    YNXPendingOriginalQueryRequestV1 request_before;
    memcpy(&request_before, request, sizeof(request_before));
    size_t length = 777; uint32_t cleanup = 999;
    int32_t result = YNXProductPairPendingOriginalQuerySignV1(request, output, CAP, &length, &cleanup);
    require(result == expected, label);
    if (length != 0 || cleanup != expected_cleanup) {
        fprintf(stderr, "YNX_PENDING_QUERY_C_SCALAR_REFUSED case=%s length=%zu cleanup=%u expected=%u\n",
            label, length, cleanup, expected_cleanup);
        require(0, "failure_scalar_contract");
    }
    require(memcmp(before, output, sizeof(before)) == 0, "failure_without_wire_changed_output");
    require(memcmp(&request_before, request, sizeof(request_before)) == 0,
            "failure_changed_request");
    check_borrows(); cases++;
}

int main(int argc, char **argv) {
    require(argc == 2, "usage_synthetic_input_directory");
    const char *names[INPUT_COUNT] = { "query.json", "SYNTHETIC-ONLY-a.der",
        "SYNTHETIC-ONLY-b.der", "pk-a.bin", "pk-b.bin", "network.bin", "owner.txt", "registration.json", "original-pair.json", "actor.bin", "origin.txt", "nonce.txt", "issued.txt", "expires.txt" };
    const size_t maxima[INPUT_COUNT] = { 1024u,
        54, 150, 2592, 64, 32, 42, 16384, 393216, 32, 2048, 64, 24, 24 };
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        inputs[i] = read_blob(argv[1], names[i], maxima[i]);
        require(i == 0 || i == 7 || i == 8 || i == 10 || i == 11 || inputs[i].length == maxima[i], "exact_synthetic_material");
        saved[i].length = inputs[i].length;
        saved[i].bytes = (uint8_t *)malloc(saved[i].length);
        require(saved[i].bytes != NULL, "borrow_snapshot_allocation");
        memcpy(saved[i].bytes, inputs[i].bytes, saved[i].length);
    }
    output = (uint8_t *)malloc(CAP + GUARD);
    uint8_t *region = (uint8_t *)malloc(CAP + GUARD);
    require(output != NULL && region != NULL, "live_boundary_allocations");
    memset(output, 0xa5, CAP + GUARD); memset(region, 0xa5, CAP + GUARD);

    YNXPendingOriginalQueryRequestV1 r; memset(&r, 0, sizeof(r));
    r.abi_version = YNX_PENDING_ORIGINAL_QUERY_ABI_V1; r.struct_size = sizeof(r);
    r.query_original = span(inputs[0].bytes, inputs[0].length);
    r.pkcs8_a = span(inputs[1].bytes, inputs[1].length);
    r.pkcs8_b = span(inputs[2].bytes, inputs[2].length);
    r.pk_a = span(inputs[3].bytes, inputs[3].length);
    r.pk_b = span(inputs[4].bytes, inputs[4].length);
    r.expected.network_id = span(inputs[5].bytes, inputs[5].length);
    r.expected.owner = span(inputs[6].bytes, inputs[6].length);
    r.expected.pk_a = r.pk_a; r.expected.pk_b = r.pk_b;
    _Static_assert(sizeof(YNXPendingOriginalQueryRequestV1) == 296, "exact ABI64 request layout");
    _Static_assert(CAP == 98304, "exact public capacity");
    r.registration_original = span(inputs[7].bytes, inputs[7].length);
    r.original_pair_post = span(inputs[8].bytes, inputs[8].length);
    r.expected.actor_digest = span(inputs[9].bytes, inputs[9].length);
    r.expected.service_origin = span(inputs[10].bytes, inputs[10].length);
    r.expected.nonce = span(inputs[11].bytes, inputs[11].length);
    r.expected.issued_at = span(inputs[12].bytes, inputs[12].length);
    r.expected.expires_at = span(inputs[13].bytes, inputs[13].length);
    r.expected.at_ms = UINT64_C(1793520000000);
    r.expected.source_issued_at_ms = r.expected.at_ms - UINT64_C(60000);
    r.expected.source_expires_at_ms = r.expected.at_ms + UINT64_C(60000);
    size_t length = 777; uint32_t cleanup = 999;

    /* no nil pointer may expose a private borrow or initialize scalars. */
    layout_reject("null_request", NULL, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_ARGUMENT_V1, region, CAP + GUARD);
    layout_reject("null_output", &r, NULL, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_ARGUMENT_V1, region, CAP + GUARD);
    layout_reject("null_length", &r, output, CAP, NULL, &cleanup,
        YNX_PENDING_QUERY_ARGUMENT_V1, region, CAP + GUARD);
    layout_reject("null_cleanup", &r, output, CAP, &length, NULL,
        YNX_PENDING_QUERY_ARGUMENT_V1, region, CAP + GUARD);

    /* fixed ABI and exact capacity, including rejected larger capacity. */
    YNXPendingOriginalQueryRequestV1 changed = r; changed.abi_version = 2;
    layout_reject("version_one", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_ARGUMENT_V1, region, CAP + GUARD);
    changed = r; changed.struct_size--;
    layout_reject("struct_size", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_ARGUMENT_V1, region, CAP + GUARD);
    layout_reject("capacity_short", &r, output, CAP - 1u, &length, &cleanup,
        YNX_PENDING_QUERY_CAPACITY_V1, region, CAP + GUARD);
    layout_reject("capacity_long", &r, output, CAP + 1u, &length, &cleanup,
        YNX_PENDING_QUERY_CAPACITY_V1, region, CAP + GUARD);

    /* all pointers remain live. SIZE_MAX is rejected as a span length
     * before range arithmetic or any read beyond the CAP allocation boundary. */
    changed = r; changed.query_original.length = 0;
    layout_reject("empty_unsigned", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);
    changed = r; changed.query_original = span(region, 1024u + 1u);
    layout_reject("oversize_unsigned", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);
    changed = r; changed.query_original.bytes = NULL;
    layout_reject("null_unsigned", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);
    changed = r; changed.pkcs8_a.bytes = NULL;
    layout_reject("null_private_borrow", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);
    changed = r; changed.query_original = span(region + CAP - 1u, SIZE_MAX);
    layout_reject("input_extent_overflow", &changed, output, CAP, &length, &cleanup,
        YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);

    /* memcpy admits safe snapshots without dereferencing misalignment. */
    memcpy(region + 1, &r, sizeof(r));
    layout_reject("misaligned_request", (YNXPendingOriginalQueryRequestV1 *)(void *)(region + 1),
        output, CAP, &length, &cleanup, YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);
    memset(region, 0xa5, CAP + GUARD);
    layout_reject("misaligned_length", &r, output, CAP, (size_t *)(void *)(region + 1),
        &cleanup, YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);
    layout_reject("misaligned_cleanup", &r, output, CAP, &length,
        (uint32_t *)(void *)(region + 1), YNX_PENDING_QUERY_BOUNDS_V1, region, CAP + GUARD);

    /* Sixteen real input spans must never alias writable output. */
    for (size_t i = 0; i < 16; i++) {
        changed = r;
        YNXPendingOriginalQueryBytesV1 *all[] = {&changed.query_original, &changed.registration_original,
            &changed.original_pair_post, &changed.expected.network_id, &changed.expected.owner,
            &changed.expected.pk_a, &changed.expected.pk_b, &changed.expected.actor_digest,
            &changed.expected.service_origin, &changed.expected.nonce, &changed.expected.issued_at,
            &changed.expected.expires_at, &changed.pk_a, &changed.pk_b, &changed.pkcs8_a, &changed.pkcs8_b};
        all[i]->bytes = output;
        layout_reject("output_input_overlap", &changed, output, CAP, &length, &cleanup,
            YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    }
    /* Every public/private alias is rejected before reading either side. */
    for (size_t i = 0; i < 14; i++) {
        for (size_t j = 0; j < 2; j++) {
            changed = r;
            YNXPendingOriginalQueryBytesV1 *pub[] = {&changed.query_original, &changed.registration_original,
                &changed.original_pair_post, &changed.expected.network_id, &changed.expected.owner,
                &changed.expected.pk_a, &changed.expected.pk_b, &changed.expected.actor_digest,
                &changed.expected.service_origin, &changed.expected.nonce, &changed.expected.issued_at,
                &changed.expected.expires_at, &changed.pk_a, &changed.pk_b};
            pub[i]->bytes = region;
            if (j == 0) { changed.pkcs8_a.bytes = region; } else { changed.pkcs8_b.bytes = region; }
            layout_reject("public_private_overlap", &changed, output, CAP, &length, &cleanup,
                YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
        }
    }

    /* request/output/scalars and private/scalar overlap. Every extra
     * alias is backed by the live full-size region and must remain untouched. */
    memcpy(region, &r, sizeof(r));
    layout_reject("output_request_overlap", (YNXPendingOriginalQueryRequestV1 *)(void *)region,
        region, CAP, &length, &cleanup, YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    memset(region, 0xa5, CAP + GUARD);
    layout_reject("output_length_overlap", &r, output, CAP, (size_t *)(void *)(output + 16),
        &cleanup, YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    layout_reject("output_cleanup_overlap", &r, output, CAP, &length,
        (uint32_t *)(void *)(output + 16), YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    layout_reject("scalar_scalar_overlap", &r, output, CAP, (size_t *)(void *)region,
        (uint32_t *)(void *)region, YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    memcpy(region, inputs[1].bytes, inputs[1].length); changed = r;
    changed.pkcs8_a = span(region, 54);
    layout_reject("private_length_overlap", &changed, output, CAP, (size_t *)(void *)region,
        &cleanup, YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    layout_reject("private_cleanup_overlap", &changed, output, CAP, &length,
        (uint32_t *)(void *)region, YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    memcpy(region, &r, sizeof(r));
    YNXPendingOriginalQueryRequestV1 *request_alias = (YNXPendingOriginalQueryRequestV1 *)(void *)region;
    layout_reject("request_length_overlap", request_alias, output, CAP, &request_alias->struct_size, &cleanup,
        YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    layout_reject("request_cleanup_overlap", request_alias, output, CAP, &length, &request_alias->abi_version,
        YNX_PENDING_QUERY_OVERLAP_V1, region, CAP + GUARD);
    wipe(region, CAP + GUARD);

    /* public binding failure must occur before any private material entry. */
    uint8_t wrong_owner[42]; memcpy(wrong_owner, inputs[6].bytes, sizeof(wrong_owner));
    wrong_owner[2] = wrong_owner[2] == '2' ? '3' : '2';
    changed = r; changed.expected.owner = span(wrong_owner, sizeof(wrong_owner));
    reject("wrong_expected_owner", &changed, YNX_PENDING_QUERY_PUBLIC_BINDING_V1,
        YNX_PENDING_QUERY_CLEANUP_NOT_REQUIRED_V1);

    memcpy(region, inputs[8].bytes, inputs[8].length); region[inputs[8].length] = ' ';
    changed = r; changed.original_pair_post = span(region, inputs[8].length + 1u);
    reject("wrong_original_post_bytes", &changed, YNX_PENDING_QUERY_PUBLIC_BINDING_V1,
        YNX_PENDING_QUERY_CLEANUP_NOT_REQUIRED_V1);
    changed = r; changed.expected.at_ms += UINT64_C(30000);
    reject("expired_original_window", &changed, YNX_PENDING_QUERY_PUBLIC_BINDING_V1,
        YNX_PENDING_QUERY_CLEANUP_NOT_REQUIRED_V1);
    wipe(region, CAP + GUARD);

    /* invalid actual DER and borrowed full-pair mismatch. Public or
     * private material is never printed, returned or modified by the export. */
    uint8_t bad_a[54], bad_b[150], bad_pa[2592], bad_pb[64];
    memcpy(bad_a, inputs[1].bytes, sizeof(bad_a)); bad_a[0] ^= 1;
    changed = r; changed.pkcs8_a = span(bad_a, sizeof(bad_a));
    reject("bad_actual_der_a", &changed, YNX_PENDING_QUERY_KEY_MATERIAL_V1,
        YNX_PENDING_QUERY_CLEANUP_LOGICAL_COMPLETE_V1);
    require(memcmp(bad_a + 1, inputs[1].bytes + 1, sizeof(bad_a) - 1u) == 0 &&
        bad_a[0] == (uint8_t)(inputs[1].bytes[0] ^ 1u), "bad_der_a_borrow_modified");
    wipe(bad_a, sizeof(bad_a));
    memcpy(bad_b, inputs[2].bytes, sizeof(bad_b)); bad_b[0] ^= 1;
    changed = r; changed.pkcs8_b = span(bad_b, sizeof(bad_b));
    reject("bad_actual_der_b", &changed, YNX_PENDING_QUERY_KEY_MATERIAL_V1,
        YNX_PENDING_QUERY_CLEANUP_LOGICAL_COMPLETE_V1);
    require(memcmp(bad_b + 1, inputs[2].bytes + 1, sizeof(bad_b) - 1u) == 0 &&
        bad_b[0] == (uint8_t)(inputs[2].bytes[0] ^ 1u), "bad_der_b_borrow_modified");
    wipe(bad_b, sizeof(bad_b));
    memcpy(bad_pa, inputs[3].bytes, sizeof(bad_pa)); bad_pa[0] ^= 1;
    changed = r; changed.pk_a = span(bad_pa, sizeof(bad_pa));
    reject("bad_borrowed_full_pair_a", &changed, YNX_PENDING_QUERY_KEY_MATERIAL_V1,
        YNX_PENDING_QUERY_CLEANUP_NOT_REQUIRED_V1);
    require(memcmp(bad_pa + 1, inputs[3].bytes + 1, sizeof(bad_pa) - 1u) == 0 &&
        bad_pa[0] == (uint8_t)(inputs[3].bytes[0] ^ 1u), "bad_public_a_borrow_modified");
    memcpy(bad_pb, inputs[4].bytes, sizeof(bad_pb)); bad_pb[0] ^= 1;
    changed = r; changed.pk_b = span(bad_pb, sizeof(bad_pb));
    reject("bad_borrowed_full_pair_b", &changed, YNX_PENDING_QUERY_KEY_MATERIAL_V1,
        YNX_PENDING_QUERY_CLEANUP_NOT_REQUIRED_V1);
    require(memcmp(bad_pb + 1, inputs[4].bytes + 1, sizeof(bad_pb) - 1u) == 0 &&
        bad_pb[0] == (uint8_t)(inputs[4].bytes[0] ^ 1u), "bad_public_b_borrow_modified");

    /* exactly one successful real C export. A separate Go process verifies
     * the retained Member's exact E13/N1/full pair and actual dual signatures. */
    length = 0; cleanup = YNX_PENDING_QUERY_CLEANUP_UNKNOWN_V1;
    uint8_t request_before[sizeof(r)]; memcpy(request_before, &r, sizeof(r));
    require(YNXProductPairPendingOriginalQuerySignV1(&r, output, CAP, &length, &cleanup) ==
        YNX_PENDING_QUERY_OK_V1, "actual_fixed_pending_query_sign");
    require(length > 0 && length <= CAP &&
        cleanup == YNX_PENDING_QUERY_CLEANUP_LOGICAL_COMPLETE_V1, "success_bounds_cleanup");
    for (size_t i = length; i < CAP + GUARD; i++) {
        require(output[i] == 0xa5, "success_changed_unused_capacity");
    }
    require(memcmp(&r, request_before, sizeof(r)) == 0, "success_changed_request");
    check_borrows();
    write_public(argv[1], "memberOriginal.bin", output, length); cases++;

    /* erase every local private copy, including saved snapshots, before
     * re-entry with the original borrowed addresses. No retained internal key
     * may make this second call produce a signature or expose any Member. */
    wipe(inputs[1].bytes, inputs[1].length); wipe(inputs[2].bytes, inputs[2].length);
    wipe(saved[1].bytes, saved[1].length); wipe(saved[2].bytes, saved[2].length);
    wipe(region, CAP + GUARD); memset(output, 0xa5, CAP + GUARD);
    reject("erased_borrows_cannot_reuse_internal_key", &r, YNX_PENDING_QUERY_KEY_MATERIAL_V1,
        YNX_PENDING_QUERY_CLEANUP_LOGICAL_COMPLETE_V1);
    require(cases == EXPECTED_CASES, "exact_boundary_case_count");
    char count[32]; int n = snprintf(count, sizeof(count), "%u\n", cases);
    require(n > 0 && (size_t)n < sizeof(count), "boundary_count_decimal");
    write_public(argv[1], "C-BOUNDARY-CASES.txt", (const uint8_t *)count, (size_t)n);

    for (size_t i = 0; i < INPUT_COUNT; i++) {
        wipe(inputs[i].bytes, inputs[i].length); wipe(saved[i].bytes, saved[i].length);
        free(inputs[i].bytes); free(saved[i].bytes);
    }
    wipe(output, CAP + GUARD); wipe(region, CAP + GUARD); free(output); free(region);
    printf("YNX_PENDING_QUERY_C_DRIVER_PASS cases=%u authority=false\n", cases);
    return 0;
}
