#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "product_device_keypair_v4.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Test-only native key generation, never Auth provisioning or OS custody.
 * Only these newly generated SYNTHETIC-ONLY DER files enter a fresh0700 case;
 * the independent verifier removes them after import/sign/verification. */
enum { CANARY = 16, POOL = 4096 };
typedef struct {
    uint8_t a[54 + CANARY], b[150 + CANARY], pa[2592 + CANARY], pb[64 + CANARY];
} Buffers;
static unsigned cases;
static void check(int ok, const char *name) {
    if (!ok) { fprintf(stderr, "DEVICE_KEYPAIR_C_REFUSED %s\n", name); exit(1); }
}
static void wipe(void *pointer, size_t count) {
    volatile uint8_t *bytes = (volatile uint8_t *)pointer;
    while (count-- != 0u) { *bytes++ = 0; }
}
static void passed(const char *name) { cases++; printf("DEVICE_KEYPAIR_C_CASE_PASS %s\n", name); }
static YNXProductSessionDeviceKeypairRequestV4 request_for(Buffers *b) {
    YNXProductSessionDeviceKeypairRequestV4 r;
    memset(&r, 0, sizeof(r)); r.version = 4; r.struct_size = sizeof(r);
    r.pkcs8_a.bytes = b->a; r.pkcs8_a.capacity = 54;
    r.pkcs8_b.bytes = b->b; r.pkcs8_b.capacity = 150;
    r.pk_a.bytes = b->pa; r.pk_a.capacity = 2592;
    r.pk_b.bytes = b->pb; r.pk_b.capacity = 64;
    return r;
}
static YNXProductDeviceKeypairBufferV4 *field(YNXProductSessionDeviceKeypairRequestV4 *r, size_t i) {
    YNXProductDeviceKeypairBufferV4 *fields[] = { &r->pkcs8_a, &r->pkcs8_b, &r->pk_a, &r->pk_b };
    check(i < 4, "field_index"); return fields[i];
}
static void rejected(const char *name, YNXProductSessionDeviceKeypairRequestV4 *r,
        YNXProductSessionDeviceKeypairOutcomeV4 *outcome, int32_t expected,
        Buffers *b, const uint8_t *extra, size_t extra_length) {
    Buffers before = *b;
    uint8_t request_before[sizeof(YNXProductSessionDeviceKeypairRequestV4)];
    uint8_t outcome_before[sizeof(YNXProductSessionDeviceKeypairOutcomeV4)];
    uint8_t *extra_before = NULL;
    if (r != NULL) { memcpy(request_before, r, sizeof(request_before)); }
    if (outcome != NULL) { memcpy(outcome_before, outcome, sizeof(outcome_before)); }
    if (extra != NULL) { extra_before = (uint8_t *)malloc(extra_length); check(extra_before != NULL, "snapshot"); memcpy(extra_before, extra, extra_length); }
    check(YNXProductSessionDeviceKeypairGenerateV4(r, outcome) == expected, name);
    check(memcmp(&before, b, sizeof(before)) == 0, "layout_wrote_output_buffers");
    if (r != NULL) { check(memcmp(request_before, r, sizeof(request_before)) == 0, "layout_wrote_request"); }
    if (outcome != NULL) { check(memcmp(outcome_before, outcome, sizeof(outcome_before)) == 0, "layout_wrote_outcome"); }
    if (extra != NULL) { check(memcmp(extra_before, extra, extra_length) == 0, "layout_wrote_alias_allocation"); wipe(extra_before, extra_length); free(extra_before); }
    passed(name);
}
static void write_case_file(const char *directory, const char *name, const void *bytes, size_t length) {
    char path[4096]; int n = snprintf(path, sizeof(path), "%s/%s", directory, name);
    check(n > 0 && (size_t)n < sizeof(path), "path_bound");
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    check(fd >= 0, "exclusive_test_file"); size_t used = 0;
    while (used < length) {
        ssize_t count = write(fd, (const uint8_t *)bytes + used, length - used);
        if (count < 0 && errno == EINTR) { continue; }
        check(count > 0, "test_write"); used += (size_t)count;
    }
    check(fsync(fd) == 0 && close(fd) == 0, "test_sync");
}
static void success(Buffers *b, const char *directory, const char *prefix) {
    memset(b, 0xa5, sizeof(*b));
    YNXProductSessionDeviceKeypairRequestV4 r = request_for(b), before = r;
    YNXProductSessionDeviceKeypairOutcomeV4 out; memset(&out, 0, sizeof(out));
    check(YNXProductSessionDeviceKeypairGenerateV4(&r, &out) == YNX_PRODUCT_DEVICE_KEYPAIR_OK_V4, "actual_creator");
    check(out.pkcs8_a_length == 54 && out.pkcs8_b_length == 150 && out.pk_a_length == 2592 && out.pk_b_length == 64 &&
        out.cleanup_status == YNX_PRODUCT_DEVICE_KEYPAIR_CLEANUP_LOGICAL_COMPLETE_V4 &&
        out.output_state == YNX_PRODUCT_DEVICE_KEYPAIR_OUTPUT_COMPLETE_V4, "complete_output_contract");
    check(memcmp(&r, &before, sizeof(r)) == 0, "success_mutated_request");
    for (size_t i = 0; i < 4; i++) {
        YNXProductDeviceKeypairBufferV4 *span = field(&r, i);
        for (size_t j = span->capacity; j < span->capacity + CANARY; j++) { check(span->bytes[j] == 0xa5, "capacity_canary"); }
    }
    char name[128];
    check(snprintf(name,sizeof(name),"SYNTHETIC-ONLY-%s-a.der",prefix) > 0, "name"); write_case_file(directory,name,b->a,54);
    check(snprintf(name,sizeof(name),"SYNTHETIC-ONLY-%s-b.der",prefix) > 0, "name"); write_case_file(directory,name,b->b,150);
    check(snprintf(name,sizeof(name),"%s-pk-a.bin",prefix) > 0, "name"); write_case_file(directory,name,b->pa,2592);
    check(snprintf(name,sizeof(name),"%s-pk-b.bin",prefix) > 0, "name"); write_case_file(directory,name,b->pb,64);
    passed("actual_fresh_pair_complete_no_overrun");
}
int main(int argc, char **argv) {
    check(argc == 2, "usage_new_case_directory");
    check(mkdir(argv[1],0700) == 0, "fresh_case_only");
    Buffers b; memset(&b,0xa5,sizeof(b));
    YNXProductSessionDeviceKeypairRequestV4 r = request_for(&b), changed;
    YNXProductSessionDeviceKeypairOutcomeV4 out; memset(&out,0xa5,sizeof(out));
    rejected("null_request",NULL,&out,1,&b,NULL,0);
    rejected("null_outcome",&r,NULL,1,&b,NULL,0);
    changed=r; changed.version=5; rejected("version",&changed,&out,1,&b,NULL,0);
    changed=r; changed.struct_size--; rejected("struct_size",&changed,&out,1,&b,NULL,0);
    uint8_t *pool=(uint8_t *)malloc(POOL); check(pool != NULL,"pool"); memset(pool,0xa5,POOL);
    memcpy(pool+1,&r,sizeof(r));
    rejected("unaligned_request",(YNXProductSessionDeviceKeypairRequestV4 *)(void *)(pool+1),&out,2,&b,pool,POOL);
    rejected("unaligned_outcome",&r,(YNXProductSessionDeviceKeypairOutcomeV4 *)(void *)(pool+1),2,&b,pool,POOL);
    changed=r;
    rejected("outcome_request_overlap",&changed,(YNXProductSessionDeviceKeypairOutcomeV4 *)(void *)&changed,3,&b,NULL,0);
    for (size_t i=0;i<4;i++) {
        memset(pool,0xa5,POOL); memcpy(pool,&r,sizeof(r));
        YNXProductSessionDeviceKeypairRequestV4 *alias=(YNXProductSessionDeviceKeypairRequestV4 *)(void *)pool;
        field(alias,i)->bytes=pool;
        rejected("buffer_request_overlap",alias,&out,3,&b,pool,POOL);
        changed=r; field(&changed,i)->bytes=NULL;
        rejected("null_buffer",&changed,&out,2,&b,NULL,0);
        for (size_t j=0;j<3;j++) {
            changed=r; size_t original=field(&changed,i)->capacity;
            const size_t sizes[]={0,original-1,original+1}; field(&changed,i)->capacity=sizes[j];
            rejected("exact_capacity",&changed,&out,4,&b,NULL,0);
        }
    }
    for (size_t i=0;i<4;i++) {
        for (size_t j=0;j<i;j++) {
            changed=r; field(&changed,i)->bytes=pool; field(&changed,j)->bytes=pool;
            rejected("output_pair_overlap",&changed,&out,3,&b,pool,POOL);
        }
        changed=r; field(&changed,i)->bytes=pool;
        rejected("outcome_buffer_overlap",&changed,(YNXProductSessionDeviceKeypairOutcomeV4 *)(void *)pool,3,&b,pool,POOL);
    }
    wipe(pool,POOL); free(pool);
    success(&b,argv[1],"first");
    uint8_t first_a[2592],first_b[64]; memcpy(first_a,b.pa,sizeof(first_a)); memcpy(first_b,b.pb,sizeof(first_b));
    wipe(&b,sizeof(b));
    success(&b,argv[1],"second");
    check(memcmp(first_a,b.pa,sizeof(first_a)) != 0 && memcmp(first_b,b.pb,sizeof(first_b)) != 0,"both_branches_fresh_per_call");
    wipe(&b,sizeof(b));
    char result[256]; int n=snprintf(result,sizeof(result),
        "{\"version\":\"YNX-PRODUCT-DEVICE-KEYPAIR-C-RESULT/v4\",\"cases\":%u,\"syntheticOnly\":true,\"authority\":false}\n",cases);
    check(n>0 && (size_t)n<sizeof(result),"result_bound");
    write_case_file(argv[1],"C-RESULT.json",result,(size_t)n);
    printf("YNX_PRODUCT_DEVICE_KEYPAIR_C_PASS cases=%u purpose=product-session-device-v4 physicalEraseClaimed=false\n",cases);
    return 0;
}
