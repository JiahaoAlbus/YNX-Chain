#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "registered_n1_verify.h"
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Real synchronous C caller. Every borrow/alias/misalignment below is backed
 * by a live sufficiently large allocation. There is no private-key input,
 * signing, Root, network or account state in this driver. */
enum { INPUT_COUNT = 19, REGION = 98304 + 160, EXPECTED_CASES = 62 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
static Blob inputs[INPUT_COUNT], saved[INPUT_COUNT];
static unsigned cases;

static void require(int okay, const char *label) {
    if (!okay) {
        fprintf(stderr, "YNX_REGISTERED_N1_C_REFUSED %s\n", label);
        exit(1);
    }
}
static YNXReadOnlyPublicSpanV1 span(const void *data, size_t bytes) {
    YNXReadOnlyPublicSpanV1 value = { (const uint8_t *)data, bytes };
    return value;
}
static void path_for(char *out, size_t size, const char *directory, const char *name) {
    int n = snprintf(out, size, "%s/%s", directory, name);
    require(n > 0 && (size_t)n < size, "bounded_fixture_path");
}
static Blob read_public(const char *directory, const char *name, size_t maximum) {
    char path[4096]; struct stat info; Blob b = { NULL, 0 };
    path_for(path, sizeof(path), directory, name);
    int fd = open(path, O_RDONLY | O_NOFOLLOW);
    require(fd >= 0 && fstat(fd, &info) == 0, "public_input_open");
    require(S_ISREG(info.st_mode) && (info.st_mode & 0777) == 0600 &&
        info.st_uid == geteuid() && info.st_nlink == 1 && info.st_size > 0 &&
        (uintmax_t)info.st_size <= maximum, "bounded_owned_public_input");
    b.length = (size_t)info.st_size;
    b.bytes = (uint8_t *)malloc(b.length + 160u);
    require(b.bytes != NULL, "public_input_allocation");
    memset(b.bytes, 0xa5, b.length + 160u);
    size_t used = 0;
    while (used < b.length) {
        ssize_t n = read(fd, b.bytes + used, b.length - used);
        if (n < 0 && errno == EINTR) { continue; }
        require(n > 0, "public_input_read");
        used += (size_t)n;
    }
    uint8_t extra; ssize_t n;
    do { n = read(fd, &extra, 1); } while (n < 0 && errno == EINTR);
    require(n == 0 && close(fd) == 0, "public_input_eof");
    return b;
}
static void write_public(const char *directory, const char *name,
                         const uint8_t *bytes, size_t length) {
    char path[4096]; path_for(path, sizeof(path), directory, name);
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    require(fd >= 0, "exclusive_result_open");
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
            memcmp(inputs[i].bytes, saved[i].bytes, inputs[i].length + 160u) == 0,
            "public_borrow_changed");
    }
}
static void layout_reject(const char *label, YNXRegisteredANDMemberVerifyN1RequestV1 *r,
                          YNXRegisteredANDMemberVerifyN1ResultV1 *out,
                          uint8_t *region, size_t region_length) {
    uint8_t request_before[160], result_before[32];
    uint8_t *region_before = (uint8_t *)malloc(region_length);
    require(region_before != NULL, "layout_snapshot_allocation");
    memcpy(region_before, region, region_length);
    if (r != NULL) { memcpy(request_before, r, sizeof(request_before)); }
    if (out != NULL) { memcpy(result_before, out, sizeof(result_before)); }
    require(YNXRegisteredANDMemberVerifyN1V1(r, out) == YNX_N1_VERIFY_ARGUMENT, label);
    require(memcmp(region_before, region, region_length) == 0, "layout_changed_live_region");
    require(r == NULL || memcmp(request_before, r, sizeof(request_before)) == 0, "layout_changed_request");
    require(out == NULL || memcmp(result_before, out, sizeof(result_before)) == 0, "layout_initialized_unsafe_output");
    check_borrows(); free(region_before); cases++;
}
static void call(const char *label, YNXRegisteredANDMemberVerifyN1RequestV1 *r,
                 int32_t expected, YNXRegisteredANDMemberVerifyN1ResultV1 *retained) {
    uint8_t request_before[160]; memcpy(request_before, r, sizeof(request_before));
    YNXRegisteredANDMemberVerifyN1ResultV1 result;
    memset(&result, 0xa5, sizeof(result));
    require(YNXRegisteredANDMemberVerifyN1V1(r, &result) == expected, label);
    require(result.version == 1 && result.struct_size == 32 && result.index == 0 &&
        result.cleanup_status == 0 && result.reserved == 0, "initialized_result_contract");
    if (expected == YNX_N1_VERIFY_OK) {
        require(result.verified == 1 && result.member_count == 1, "success_full_result");
    } else {
        require(result.verified == 0 && result.member_count == 0, "failure_promoted_partial_result");
    }
    require(memcmp(request_before, r, sizeof(request_before)) == 0, "request_modified");
    check_borrows(); cases++;
    if (retained != NULL) { *retained = result; }
}
static const uint8_t *find_original(const Blob *whole, const Blob *part) {
    require(part->length <= whole->length, "overlapping_input_bound");
    for (size_t i = 0; i <= whole->length - part->length; i++) {
        if (memcmp(whole->bytes + i, part->bytes, part->length) == 0) { return whole->bytes + i; }
    }
    require(0, "overlapping_input_original_not_found"); return NULL;
}

int main(int argc, char **argv) {
    require(argc == 2, "usage_original_public_fixture_directory");
    struct stat directory;
    require(lstat(argv[1], &directory) == 0 && S_ISDIR(directory.st_mode) &&
        (directory.st_mode & 0777) == 0700 && directory.st_uid == geteuid(), "owned_fixture_directory");
    const char *names[INPUT_COUNT] = {
        "member.bin", "message.bin", "network.bin", "owner.txt", "purpose.txt", "pk-a.bin", "pk-b.bin",
        "bad-sig-a.bin", "bad-sig-b.bin", "bad-leaf.bin", "bad-message.bin", "member-n2.bin",
        "bad-index.bin", "bad-path-a.bin", "bad-path-b.bin", "bad-suite.bin", "member-empty.bin", "member-revoke.bin", "purpose-revoke.txt"
    };
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        inputs[i] = read_public(argv[1], names[i], 98304);
        saved[i].length = inputs[i].length;
        saved[i].bytes = (uint8_t *)malloc(inputs[i].length + 160u);
        require(saved[i].bytes != NULL, "borrow_snapshot_allocation");
        memcpy(saved[i].bytes, inputs[i].bytes, inputs[i].length + 160u);
    }
    require(inputs[2].length == 32 && inputs[3].length == 42 && inputs[5].length == 2592 &&
        inputs[6].length == 64, "expected_public_lengths");
    uint8_t *region = (uint8_t *)malloc(REGION);
    require(region != NULL, "layout_live_region"); memset(region, 0xa5, REGION);
    YNXRegisteredANDMemberVerifyN1RequestV1 r;
    memset(&r, 0, sizeof(r)); r.version = 1; r.struct_size = sizeof(r);
    r.member = span(inputs[0].bytes, inputs[0].length);
    r.message = span(inputs[1].bytes, inputs[1].length);
    r.network = span(inputs[2].bytes, inputs[2].length);
    r.owner = span(inputs[3].bytes, inputs[3].length);
    r.purpose = span(inputs[4].bytes, inputs[4].length);
    r.pk_a = span(inputs[5].bytes, inputs[5].length);
    r.pk_b = span(inputs[6].bytes, inputs[6].length);
    r.policy_revision = 7; r.observed_height = 12; r.active_from = 10; r.enabled = 1;
    YNXRegisteredANDMemberVerifyN1ResultV1 output; memset(&output, 0xa5, sizeof(output));
    YNXRegisteredANDMemberVerifyN1RequestV1 changed;

    /* 1-5: NULL, alignment, and request-output overlap: no writes at all. */
    layout_reject("null_request", NULL, &output, region, REGION);
    layout_reject("null_output", &r, NULL, region, REGION);
    memcpy(region + 1, &r, sizeof(r));
    layout_reject("misaligned_request", (YNXRegisteredANDMemberVerifyN1RequestV1 *)(void *)(region + 1), &output, region, REGION);
    memset(region, 0xa5, REGION);
    layout_reject("misaligned_output", &r, (YNXRegisteredANDMemberVerifyN1ResultV1 *)(void *)(region + 1), region, REGION);
    memcpy(region, &r, sizeof(r));
    layout_reject("output_request_overlap", (YNXRegisteredANDMemberVerifyN1RequestV1 *)(void *)region,
        (YNXRegisteredANDMemberVerifyN1ResultV1 *)(void *)region, region, REGION);
    memset(region, 0xa5, REGION);

    /* 6-12: every borrowed input can alias the full live result allocation. */
    for (size_t i = 0; i < 7; i++) {
        changed = r;
        switch (i) {
        case 0: changed.member = span(region, inputs[0].length); break;
        case 1: changed.message = span(region, inputs[1].length); break;
        case 2: changed.network = span(region, 32); break;
        case 3: changed.owner = span(region, 42); break;
        case 4: changed.purpose = span(region, inputs[4].length); break;
        case 5: changed.pk_a = span(region, 2592); break;
        case 6: changed.pk_b = span(region, 64); break;
        default: require(0, "alias_case");
        }
        layout_reject("output_input_overlap", &changed,
            (YNXRegisteredANDMemberVerifyN1ResultV1 *)(void *)region, region, REGION);
    }

    /* 13-26: invalid borrowed sizes are rejected before any content read. */
    changed = r; changed.member.data = NULL;
    layout_reject("null_member", &changed, &output, region, REGION);
    changed = r; changed.network.data = NULL;
    layout_reject("null_network", &changed, &output, region, REGION);
    changed = r; changed.message.data = NULL;
    layout_reject("nonnull_message_required", &changed, &output, region, REGION);
    changed = r; changed.member.bytes = 0;
    layout_reject("empty_member", &changed, &output, region, REGION);
    changed = r; changed.member = span(region, 98305);
    layout_reject("oversized_member", &changed, &output, region, REGION);
    changed = r; changed.message = span(region, 65537);
    layout_reject("oversized_message", &changed, &output, region, REGION);
    changed = r; changed.member = span(region, UINT64_MAX);
    layout_reject("overflow_length", &changed, &output, region, REGION);
    changed = r; changed.network.bytes = 31;
    layout_reject("short_network", &changed, &output, region, REGION);
    changed = r; changed.owner.bytes = 0;
    layout_reject("empty_owner", &changed, &output, region, REGION);
    changed = r; changed.owner = span(region, 129);
    layout_reject("oversized_owner", &changed, &output, region, REGION);
    changed = r; changed.purpose.bytes = 0;
    layout_reject("empty_purpose", &changed, &output, region, REGION);
    changed = r; changed.purpose = span(region, 65);
    layout_reject("oversized_purpose", &changed, &output, region, REGION);
    changed = r; changed.pk_a.bytes = 2591;
    layout_reject("short_pk_a", &changed, &output, region, REGION);
    changed = r; changed.pk_b.bytes = 63;
    layout_reject("short_pk_b", &changed, &output, region, REGION);

    /* 27-40: admitted layout always initializes every result field. */
    changed = r; changed.version = 0; call("wrong_version", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);
    changed = r; changed.struct_size--; call("wrong_struct_size", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);
    changed = r; changed.enabled = 2; call("enabled_not_boolean", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);
    changed = r; changed.has_revoked_at = 2; call("revoked_not_boolean", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);
    changed = r; changed.revoked_at = 20; call("hidden_revocation", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);
    changed = r; changed.enabled = 0; call("disabled", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.policy_revision = 0; call("zero_revision", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.observed_height = 0; call("zero_height", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.active_from = 13; call("not_active", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.has_revoked_at = 1; changed.revoked_at = 12;
    call("revoked_boundary", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.has_revoked_at = 1; changed.revoked_at = 11;
    call("revoked_past", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.has_revoked_at = 1; changed.revoked_at = 9;
    call("invalid_revocation_interval", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    uint8_t owner[42]; memcpy(owner, inputs[3].bytes, sizeof(owner)); owner[10] = 0;
    changed = r; changed.owner = span(owner, sizeof(owner)); call("owner_nul", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);
    uint8_t purpose[64]; memcpy(purpose, inputs[4].bytes, inputs[4].length); purpose[0] = '\n';
    changed = r; changed.purpose = span(purpose, inputs[4].length); call("purpose_lf", &changed, YNX_N1_VERIFY_ARGUMENT, NULL);

    /* 41-46: never resolve expected context or pair from certificate values. */
    uint8_t network[32], pk_a[2592], pk_b[64];
    memcpy(network, inputs[2].bytes, sizeof(network)); network[0] ^= 1;
    changed = r; changed.network = span(network, sizeof(network)); call("wrong_network", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    memcpy(owner, inputs[3].bytes, sizeof(owner)); owner[2] = '2';
    changed = r; changed.owner = span(owner, sizeof(owner)); call("wrong_owner", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.purpose = span(inputs[18].bytes, inputs[18].length); call("wrong_purpose", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    memcpy(pk_a, inputs[5].bytes, sizeof(pk_a)); pk_a[0] ^= 1;
    changed = r; changed.pk_a = span(pk_a, sizeof(pk_a)); call("wrong_public_a", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    memcpy(pk_b, inputs[6].bytes, sizeof(pk_b)); pk_b[0] ^= 1;
    changed = r; changed.pk_b = span(pk_b, sizeof(pk_b)); call("wrong_public_b", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r; changed.message = span(inputs[10].bytes, inputs[10].length); call("wrong_expected_message", &changed, YNX_N1_VERIFY_MATH_INVALID, NULL);

    /* 47-56: independent branch, valid-cert leaf, N1 and strict-wire failures. */
    changed = r; changed.member = span(inputs[7].bytes, inputs[7].length); call("bad_actual_signature_a", &changed, YNX_N1_VERIFY_MATH_INVALID, NULL);
    changed = r; changed.member = span(inputs[8].bytes, inputs[8].length); call("bad_actual_signature_b", &changed, YNX_N1_VERIFY_MATH_INVALID, NULL);
    changed = r; changed.member = span(inputs[9].bytes, inputs[9].length); changed.message = span(inputs[10].bytes, inputs[10].length);
    call("valid_certificate_wrong_leaf", &changed, YNX_N1_VERIFY_MATH_INVALID, NULL);
    changed = r; changed.member = span(inputs[11].bytes, inputs[11].length); call("n2_member", &changed, YNX_N1_VERIFY_N1_REQUIRED, NULL);
    changed = r; changed.member = span(inputs[12].bytes, inputs[12].length); call("n1_nonzero_index", &changed, YNX_N1_VERIFY_MALFORMED, NULL);
    changed = r; changed.member = span(inputs[13].bytes, inputs[13].length); call("n1_nonempty_path_a", &changed, YNX_N1_VERIFY_MALFORMED, NULL);
    changed = r; changed.member = span(inputs[14].bytes, inputs[14].length); call("n1_nonempty_path_b", &changed, YNX_N1_VERIFY_MALFORMED, NULL);
    changed = r; changed.member = span(inputs[15].bytes, inputs[15].length); call("wrong_suite", &changed, YNX_N1_VERIFY_MALFORMED, NULL);
    changed = r; changed.member.bytes--; call("truncated_member", &changed, YNX_N1_VERIFY_MALFORMED, NULL);
    memcpy(region, inputs[0].bytes, inputs[0].length); region[inputs[0].length] = 0;
    changed = r; changed.member = span(region, inputs[0].length + 1u); call("trailing_member", &changed, YNX_N1_VERIFY_MALFORMED, NULL);

    /* 57-62: real success, independent current boundary, legal empty message,
     * second explicit Auth purpose and overlapping public inputs. */
    call("actual_full_and_n1", &r, YNX_N1_VERIFY_OK, &output);
    changed = r; changed.has_revoked_at = 1; changed.revoked_at = 13;
    call("future_revocation_live", &changed, YNX_N1_VERIFY_OK, NULL);
    changed = r; changed.member = span(inputs[16].bytes, inputs[16].length); changed.message = span(NULL, 0);
    call("empty_opaque_message", &changed, YNX_N1_VERIFY_OK, NULL);
    changed = r; changed.member = span(inputs[17].bytes, inputs[17].length); changed.purpose = span(inputs[18].bytes, inputs[18].length);
    call("explicit_revoke_purpose", &changed, YNX_N1_VERIFY_OK, NULL);
    changed = r; changed.has_revoked_at = 1; changed.revoked_at = 13; changed.observed_height = 13;
    call("prior_success_never_bypasses_current_revoke", &changed, YNX_N1_VERIFY_TRUST_DENIED, NULL);
    changed = r;
    changed.message = span(find_original(&inputs[0], &inputs[1]), inputs[1].length);
    changed.network = span(find_original(&inputs[0], &inputs[2]), inputs[2].length);
    changed.owner = span(find_original(&inputs[0], &inputs[3]), inputs[3].length);
    changed.purpose = span(find_original(&inputs[0], &inputs[4]), inputs[4].length);
    changed.pk_a = span(find_original(&inputs[0], &inputs[5]), inputs[5].length);
    changed.pk_b = span(find_original(&inputs[0], &inputs[6]), inputs[6].length);
    call("public_input_overlap_is_read_only", &changed, YNX_N1_VERIFY_OK, NULL);

    require(cases == EXPECTED_CASES, "exact_real_export_case_count");
    char result[512];
    int n = snprintf(result, sizeof(result),
        "{\"version\":%u,\"structSize\":%u,\"verified\":%u,\"memberCount\":%u,\"index\":%u,\"cleanupStatus\":%u,\"reserved\":%" PRIu64 ",\"cases\":%u,\"authority\":false}",
        output.version, output.struct_size, output.verified, output.member_count,
        output.index, output.cleanup_status, output.reserved, cases);
    require(n > 0 && (size_t)n < sizeof(result), "bounded_result_json");
    write_public(argv[1], "N1-C-RESULT.json", (const uint8_t *)result, (size_t)n);
    n = snprintf(result, sizeof(result), "%u\n", cases);
    require(n > 0 && (size_t)n < sizeof(result), "bounded_case_count");
    write_public(argv[1], "C-BOUNDARY-CASES.txt", (const uint8_t *)result, (size_t)n);
    for (size_t i = 0; i < INPUT_COUNT; i++) { free(inputs[i].bytes); free(saved[i].bytes); }
    free(region);
    printf("YNX_REGISTERED_N1_C_DRIVER_PASS cases=%u authority=false\n", cases);
    return 0;
}
