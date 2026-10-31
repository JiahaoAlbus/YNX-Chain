#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "product_device_challenge_v4.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Real same-archive C calls using only fresh synthetic CI material. No fork,
 * network, Auth slot, Source, account signing, permission or once is exercised.
 * Every negative uses live bounded memory; even alias destinations have a
 * CAP+GUARD allocation. No arbitrary foreign pointer is dereferenced. */
enum { CAP = YNX_PRODUCT_DEVICE_MEMBER_CAPACITY_V4, GUARD = 32,
       INPUT_COUNT = 8, WRONG_COUNT = 4, EXPECTED_CASES = 48 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
typedef union {
    YNXProductSessionDeviceRegistrationRequestV4 registration;
    YNXProductSessionDeviceChallengeRequestV4 challenge;
} Request;
typedef enum { REGISTRATION = 0, CHALLENGE = 1 } Role;
typedef struct {
    uint32_t *version;
    size_t *size;
    YNXProductDeviceExpectedV4 *expected;
    YNXProductDeviceBytesV4 *private_a, *public_b;
} View;

static Blob inputs[INPUT_COUNT], saved[INPUT_COUNT], wrong[WRONG_COUNT], wrong_saved[WRONG_COUNT];
static uint8_t *output;
static unsigned cases;

static void wipe(void *memory, size_t n) {
    volatile uint8_t *p = (volatile uint8_t *)memory;
    while (n-- != 0u) { *p++ = 0; }
}
static int refused(const char *label) {
    fprintf(stderr, "PRODUCT_DEVICE_V4_CABI_C_REFUSED %s\n", label);
    return 0;
}
static YNXProductDeviceBytesV4 span(Blob b) {
    YNXProductDeviceBytesV4 value = { b.bytes, b.length };
    return value;
}
static int read_blob(int directory, const char *name, size_t maximum, Blob *b) {
    struct stat s;
    int fd = openat(directory, name, O_RDONLY | O_NOFOLLOW);
    if (fd < 0) { return refused("input_open"); }
    if (fstat(fd, &s) != 0 || !S_ISREG(s.st_mode) || s.st_uid != geteuid() ||
        s.st_nlink != 1 || (s.st_mode & 0777) != 0600 || s.st_size < 1 ||
        (uintmax_t)s.st_size > maximum) {
        (void)close(fd); return refused("private_bounded_input");
    }
    b->length = (size_t)s.st_size;
    b->bytes = (uint8_t *)malloc(CAP + GUARD);
    if (b->bytes == NULL) { (void)close(fd); return refused("input_allocate"); }
    memset(b->bytes, 0xa5, CAP + GUARD);
    size_t used = 0;
    while (used < b->length) {
        ssize_t n = read(fd, b->bytes + used, b->length - used);
        if (n < 0 && errno == EINTR) { continue; }
        if (n <= 0) { (void)close(fd); return refused("input_read"); }
        used += (size_t)n;
    }
    uint8_t extra;
    ssize_t n;
    do { n = read(fd, &extra, 1); } while (n < 0 && errno == EINTR);
    struct stat after;
    int stable = n == 0 && fstat(fd, &after) == 0 && s.st_dev == after.st_dev &&
        s.st_ino == after.st_ino && s.st_size == after.st_size && s.st_mode == after.st_mode &&
        s.st_uid == after.st_uid && s.st_gid == after.st_gid && s.st_nlink == after.st_nlink && s.st_mtime == after.st_mtime;
    int closed = close(fd);
    return stable && closed == 0 ? 1 : refused("input_readback");
}
static int write_public(int directory, const char *name, const uint8_t *raw, size_t length) {
    int fd = openat(directory, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (fd < 0) { return refused("output_exclusive"); }
    size_t used = 0;
    while (used < length) {
        ssize_t n = write(fd, raw + used, length - used);
        if (n < 0 && errno == EINTR) { continue; }
        if (n <= 0) { (void)close(fd); return refused("output_write"); }
        used += (size_t)n;
    }
    int synced = fsync(fd);
    int closed = close(fd);
    return synced == 0 && closed == 0 ? 1 : refused("output_sync");
}
static int borrows_unchanged(void) {
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        if (inputs[i].length != saved[i].length || memcmp(inputs[i].bytes, saved[i].bytes, inputs[i].length) != 0) {
            return refused("original_public_or_private_borrow_changed");
        }
    }
    for (size_t i = 0; i < WRONG_COUNT; i++) {
        if (wrong[i].length != wrong_saved[i].length || memcmp(wrong[i].bytes, wrong_saved[i].bytes, wrong[i].length) != 0) {
            return refused("negative_public_input_changed");
        }
    }
    return 1;
}
static int32_t invoke(Role role, void *request, uint8_t *buffer, size_t capacity,
                      size_t *length, uint32_t *cleanup) {
    if (role == REGISTRATION) {
        return YNXProductSessionDeviceRegistrationSignV4(
            (YNXProductSessionDeviceRegistrationRequestV4 *)request, buffer, capacity, length, cleanup);
    }
    return YNXProductSessionDeviceChallengeSignV4(
        (YNXProductSessionDeviceChallengeRequestV4 *)request, buffer, capacity, length, cleanup);
}
static size_t request_size(Role role) {
    return role == REGISTRATION ? sizeof(YNXProductSessionDeviceRegistrationRequestV4) : sizeof(YNXProductSessionDeviceChallengeRequestV4);
}
static View view(Role role, Request *r) {
    View v;
    if (role == REGISTRATION) {
        v.version = &r->registration.version; v.size = &r->registration.struct_size;
        v.expected = &r->registration.expected; v.private_a = &r->registration.pkcs8_a; v.public_b = &r->registration.pk_b;
    } else {
        v.version = &r->challenge.version; v.size = &r->challenge.struct_size;
        v.expected = &r->challenge.expected; v.private_a = &r->challenge.pkcs8_a; v.public_b = &r->challenge.pk_b;
    }
    return v;
}
static void initialize(Role role, Request *r) {
    YNXProductDeviceExpectedV4 expected = { span(inputs[2]), span(inputs[3]), span(inputs[4]), span(inputs[5]) };
    memset(r, 0, sizeof(*r));
    if (role == REGISTRATION) {
        r->registration.version = 4; r->registration.struct_size = sizeof(r->registration);
        r->registration.registration_original = span(inputs[0]); r->registration.expected = expected;
        r->registration.pkcs8_a = span(inputs[6]); r->registration.pkcs8_b = span(inputs[7]);
        r->registration.pk_a = span(inputs[4]); r->registration.pk_b = span(inputs[5]);
    } else {
        r->challenge.version = 4; r->challenge.struct_size = sizeof(r->challenge);
        r->challenge.registration_original = span(inputs[0]); r->challenge.challenge_original = span(inputs[1]); r->challenge.expected = expected;
        r->challenge.pkcs8_a = span(inputs[6]); r->challenge.pkcs8_b = span(inputs[7]);
        r->challenge.pk_a = span(inputs[4]); r->challenge.pk_b = span(inputs[5]);
    }
}

/* Snapshots use memcpy, including deliberately misaligned request addresses.
 * Failed layout must leave the complete request, all output ranges and every
 * borrowed public/private input untouched. Admitted preflight failures only
 * change their two documented scalars; no synthetic partial Member is invented. */
static int layout_reject(Role role, const char *label, void *request, uint8_t *buffer,
                         size_t capacity, size_t *length, uint32_t *cleanup, int32_t expected) {
    uint8_t before[CAP + GUARD], passed_before[CAP + GUARD], request_before[sizeof(Request)];
    uint8_t length_before[sizeof(size_t)], cleanup_before[sizeof(uint32_t)];
    memcpy(before, output, sizeof(before));
    if (buffer != NULL) { memcpy(passed_before, buffer, sizeof(passed_before)); }
    if (request != NULL) { memcpy(request_before, request, request_size(role)); }
    if (length != NULL) { memcpy(length_before, length, sizeof(length_before)); }
    if (cleanup != NULL) { memcpy(cleanup_before, cleanup, sizeof(cleanup_before)); }
    int32_t result = invoke(role, request, buffer, capacity, length, cleanup);
    if (result != expected) { return refused(label); }
    if (memcmp(before, output, sizeof(before)) != 0 ||
        (buffer != NULL && memcmp(passed_before, buffer, sizeof(passed_before)) != 0) ||
        (request != NULL && memcmp(request_before, request, request_size(role)) != 0) ||
        (length != NULL && memcmp(length_before, length, sizeof(length_before)) != 0) ||
        (cleanup != NULL && memcmp(cleanup_before, cleanup, sizeof(cleanup_before)) != 0)) {
        return refused("layout_wrote_output_or_request");
    }
    if (!borrows_unchanged()) { return 0; }
    cases++;
    return 1;
}
static int admitted_reject(Role role, const char *label, Request *request,
                           int32_t expected, uint32_t expected_cleanup) {
    uint8_t before[CAP + GUARD], request_before[sizeof(Request)];
    memcpy(before, output, sizeof(before)); memcpy(request_before, request, request_size(role));
    size_t length = 777;
    uint32_t cleanup = 999;
    int32_t result = invoke(role, request, output, CAP, &length, &cleanup);
    if (result != expected) { return refused(label); }
    if (length != 0 || cleanup != expected_cleanup || memcmp(before, output, sizeof(before)) != 0 ||
        memcmp(request_before, request, request_size(role)) != 0) {
        return refused("failure_scalar_or_unchanged_buffer_contract");
    }
    if (!borrows_unchanged()) { return 0; }
    cases++;
    return 1;
}

static int run_role(Role role, int directory, size_t *member_length) {
    Request *r = (Request *)malloc(CAP + GUARD);
    uint8_t *misaligned = (uint8_t *)malloc(CAP + GUARD + 1);
    if (r == NULL || misaligned == NULL) {
        free(r); free(misaligned); return refused("request_allocate");
    }
    int ok = 0;
    memset(r, 0xa5, CAP + GUARD); memset(output, 0xa5, CAP + GUARD);
    initialize(role, r);
    View v = view(role, r);
    size_t length = 777;
    uint32_t cleanup = 999;
#define LAYOUT(label, request, buffer, capacity, lenp, cleanp, code) \
    do { if (!layout_reject(role, label, request, buffer, capacity, lenp, cleanp, code)) { goto done; } } while (0)
#define ADMITTED(label, code, status) \
    do { if (!admitted_reject(role, label, r, code, status)) { goto done; } } while (0)
    /* 18 actual pre-private layout calls for EACH export. */
    LAYOUT("null_request", NULL, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4);
    *v.version = 3;
    LAYOUT("version", r, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4);
    *v.version = 4; *v.size = request_size(role) - 1;
    LAYOUT("struct_size", r, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4);
    *v.size = request_size(role);
    memcpy(misaligned + 1, r, request_size(role));
    LAYOUT("misaligned_request", misaligned + 1, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_BOUNDS_V4);
    LAYOUT("null_output", r, NULL, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4);
    LAYOUT("null_length", r, output, CAP, NULL, &cleanup, YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4);
    LAYOUT("null_cleanup", r, output, CAP, &length, NULL, YNX_PRODUCT_DEVICE_INVALID_ARGUMENT_V4);
    LAYOUT("zero_capacity", r, output, 0, &length, &cleanup, YNX_PRODUCT_DEVICE_CAPACITY_V4);
    LAYOUT("short_capacity", r, output, CAP - 1, &length, &cleanup, YNX_PRODUCT_DEVICE_CAPACITY_V4);
    LAYOUT("large_capacity", r, output, CAP + 1, &length, &cleanup, YNX_PRODUCT_DEVICE_CAPACITY_V4);
    v.expected->network_id.bytes = NULL;
    LAYOUT("null_public", r, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_BOUNDS_V4);
    v.expected->network_id = span(inputs[2]); v.private_a->bytes = NULL;
    LAYOUT("null_private", r, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_BOUNDS_V4);
    *v.private_a = span(inputs[6]); v.private_a->length--;
    LAYOUT("private_extent", r, output, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_BOUNDS_V4);
    *v.private_a = span(inputs[6]);
    LAYOUT("output_public_alias", r, inputs[2].bytes, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_OVERLAP_V4);
    LAYOUT("length_output_alias", r, output, CAP, (size_t *)(void *)output, &cleanup, YNX_PRODUCT_DEVICE_OVERLAP_V4);
    LAYOUT("cleanup_length_alias", r, output, CAP, &length, (uint32_t *)(void *)&length, YNX_PRODUCT_DEVICE_OVERLAP_V4);
    LAYOUT("output_request_alias", r, (uint8_t *)(void *)r, CAP, &length, &cleanup, YNX_PRODUCT_DEVICE_OVERLAP_V4);
    LAYOUT("length_request_alias", r, output, CAP, v.size, &cleanup, YNX_PRODUCT_DEVICE_OVERLAP_V4);
    /* Four public expected tuple failures, then a real borrowed pair failure.
     * None can produce a wire or change any borrowed input. */
    v.expected->network_id = span(wrong[0]);
    ADMITTED("wrong_expected_network", YNX_PRODUCT_DEVICE_PUBLIC_BINDING_V4, YNX_PRODUCT_DEVICE_CLEANUP_NOT_REQUIRED_V4);
    v.expected->network_id = span(inputs[2]); v.expected->owner = span(wrong[1]);
    ADMITTED("wrong_expected_owner", YNX_PRODUCT_DEVICE_PUBLIC_BINDING_V4, YNX_PRODUCT_DEVICE_CLEANUP_NOT_REQUIRED_V4);
    v.expected->owner = span(inputs[3]); v.expected->pk_a = span(wrong[2]);
    ADMITTED("wrong_expected_pk_a", YNX_PRODUCT_DEVICE_PUBLIC_BINDING_V4, YNX_PRODUCT_DEVICE_CLEANUP_NOT_REQUIRED_V4);
    v.expected->pk_a = span(inputs[4]); v.expected->pk_b = span(wrong[3]);
    ADMITTED("wrong_expected_pk_b", YNX_PRODUCT_DEVICE_PUBLIC_BINDING_V4, YNX_PRODUCT_DEVICE_CLEANUP_NOT_REQUIRED_V4);
    v.expected->pk_b = span(inputs[5]); *v.public_b = span(wrong[3]);
    ADMITTED("wrong_borrowed_pk_b", YNX_PRODUCT_DEVICE_KEY_MATERIAL_V4, YNX_PRODUCT_DEVICE_CLEANUP_LOGICAL_COMPLETE_V4);
    *v.public_b = span(inputs[5]);
    /* One real successful signing invocation per fixed export, never retried. */
    uint8_t request_before[sizeof(Request)];
    memcpy(request_before, r, request_size(role));
    length = 0; cleanup = YNX_PRODUCT_DEVICE_CLEANUP_UNKNOWN_V4;
    int32_t result = invoke(role, r, output, CAP, &length, &cleanup);
    if (result != YNX_PRODUCT_DEVICE_OK_V4 || cleanup != YNX_PRODUCT_DEVICE_CLEANUP_LOGICAL_COMPLETE_V4 || length == 0 || length > CAP ||
        memcmp(request_before, r, request_size(role)) != 0 || !borrows_unchanged()) {
        (void)refused("actual_fixed_sign_success"); goto done;
    }
    for (size_t i = length; i < CAP + GUARD; i++) {
        if (output[i] != 0xa5) { (void)refused("unused_output_tail_changed"); goto done; }
    }
    cases++;
    *member_length = length;
    if (!write_public(directory, role == REGISTRATION ? "registration-member.bin" : "challenge-member.bin", output, length)) { goto done; }
    ok = 1;
done:
    wipe(r, CAP + GUARD); free(r);
    wipe(misaligned, CAP + GUARD + 1); free(misaligned);
#undef LAYOUT
#undef ADMITTED
    return ok;
}

int main(int argc, char **argv) {
    int status = 1;
    int directory = -1;
    if (argc != 2) { (void)refused("usage_private_synthetic_directory"); goto done; }
    directory = open(argv[1], O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    struct stat ds;
    if (directory < 0 || fstat(directory, &ds) != 0 || !S_ISDIR(ds.st_mode) || ds.st_uid != geteuid() || (ds.st_mode & 0777) != 0700) {
        (void)refused("private_directory"); goto done;
    }
    const char *names[INPUT_COUNT] = { "registration-original.json", "challenge-original.json", "network.bin", "owner.txt", "device-pk-a.bin", "device-pk-b.bin",
        "SYNTHETIC-ONLY-device-a.der", "SYNTHETIC-ONLY-device-b.der" };
    const size_t maxima[INPUT_COUNT] = { 16384, 16384, 32, 42, 2592, 64, 54, 150 };
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        if (!read_blob(directory, names[i], maxima[i], &inputs[i]) || (i >= 2 && inputs[i].length != maxima[i])) { goto done; }
        saved[i].length = inputs[i].length;
        saved[i].bytes = (uint8_t *)malloc(inputs[i].length);
        if (saved[i].bytes == NULL) { (void)refused("borrow_snapshot_allocate"); goto done; }
        memcpy(saved[i].bytes, inputs[i].bytes, inputs[i].length);
    }
    for (size_t i = 0; i < WRONG_COUNT; i++) {
        wrong[i].length = inputs[i + 2].length;
        wrong[i].bytes = (uint8_t *)malloc(CAP + GUARD);
        if (wrong[i].bytes == NULL) { (void)refused("negative_public_allocate"); goto done; }
        memset(wrong[i].bytes, 0xa5, CAP + GUARD);
        memcpy(wrong[i].bytes, inputs[i + 2].bytes, wrong[i].length);
        /* Owner remains canonical lowercase 0x42, but differs independently. */
        wrong[i].bytes[i == 1 ? 2u : 0u] ^= 1u;
        wrong_saved[i].length = wrong[i].length;
        wrong_saved[i].bytes = (uint8_t *)malloc(wrong[i].length);
        if (wrong_saved[i].bytes == NULL) { (void)refused("negative_public_snapshot_allocate"); goto done; }
        memcpy(wrong_saved[i].bytes, wrong[i].bytes, wrong[i].length);
    }
    output = (uint8_t *)malloc(CAP + GUARD);
    if (output == NULL) { (void)refused("output_allocate"); goto done; }
    size_t registration_length = 0, challenge_length = 0;
    if (!run_role(REGISTRATION, directory, &registration_length) || !run_role(CHALLENGE, directory, &challenge_length)) { goto done; }
    if (cases != EXPECTED_CASES) { (void)refused("exact_real_case_count"); goto done; }
    char result[512];
    int n = snprintf(result, sizeof(result), "{\"authority\":false,\"cases\":%u,\"challenge\":{\"bytes\":%zu,\"cleanup\":2,\"rc\":0},\"dataOnly\":true,\"registration\":{\"bytes\":%zu,\"cleanup\":2,\"rc\":0},\"version\":4}\n",
        cases, challenge_length, registration_length);
    if (n < 1 || (size_t)n >= sizeof(result) || !write_public(directory, "C-RESULT.json", (const uint8_t *)result, (size_t)n)) { goto done; }
    printf("PRODUCT_DEVICE_V4_CABI_C_CASES=%u\n", cases);
    status = 0;
done:
    for (size_t i = 0; i < INPUT_COUNT; i++) {
        if (inputs[i].bytes != NULL) { wipe(inputs[i].bytes, CAP + GUARD); free(inputs[i].bytes); }
        if (saved[i].bytes != NULL) { wipe(saved[i].bytes, saved[i].length); free(saved[i].bytes); }
    }
    for (size_t i = 0; i < WRONG_COUNT; i++) {
        if (wrong[i].bytes != NULL) { wipe(wrong[i].bytes, CAP + GUARD); free(wrong[i].bytes); }
        if (wrong_saved[i].bytes != NULL) { wipe(wrong_saved[i].bytes, wrong_saved[i].length); free(wrong_saved[i].bytes); }
    }
    if (output != NULL) { wipe(output, CAP + GUARD); free(output); }
    if (directory >= 0 && close(directory) != 0) { status = 1; }
    return status;
}
