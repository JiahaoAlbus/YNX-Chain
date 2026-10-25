#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "account_initial.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* CI-only ephemeral synthetic files. This program does not load a Wallet,
 * issue approval, contact a node or accept any production private material. */
enum { CAP = YNX_ACCOUNT_INITIAL_MEMBER_CAPACITY_V1, GUARD = 16 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
static unsigned cases;
static void require(int ok, const char *label) {
    if (!ok) { fprintf(stderr,"YNX_INITIAL_CABI_C_REFUSED %s\n",label); exit(1); }
}
static void wipe(void *memory, size_t length) {
    volatile uint8_t *p=(volatile uint8_t *)memory;
    while(length-- != 0u) { *p++=0; }
}
static YNXAccountInitialBytesV1 span(const void *p,size_t n) {
    YNXAccountInitialBytesV1 s={(const uint8_t *)p,n}; return s;
}
static YNXAccountInitialBytesV1 text(const char *s) { return span(s,strlen(s)); }
static void path_for(char *out,size_t n,const char *directory,const char *name) {
    int count=snprintf(out,n,"%s/%s",directory,name);
    require(count>0 && (size_t)count<n,"fixture_path_bound");
}
static Blob read_blob(const char *directory,const char *name,size_t maximum) {
    char path[4096]; struct stat info; Blob b={NULL,0};
    path_for(path,sizeof(path),directory,name);
    int fd=open(path,O_RDONLY|O_NOFOLLOW);
    require(fd>=0 && fstat(fd,&info)==0,"fixture_open");
    require(S_ISREG(info.st_mode) && info.st_nlink==1 && (info.st_mode & 0777)==0600 &&
        info.st_size>0 && (uintmax_t)info.st_size<=maximum,"bounded_private_synthetic_file");
    b.length=(size_t)info.st_size; b.bytes=(uint8_t *)malloc(b.length);
    require(b.bytes!=NULL,"fixture_allocation");
    size_t used=0;
    while(used<b.length) {
        ssize_t n=read(fd,b.bytes+used,b.length-used);
        if(n<0 && errno==EINTR) {continue;}
        require(n>0,"fixture_read"); used+=(size_t)n;
    }
    uint8_t extra; require(read(fd,&extra,1)==0 && close(fd)==0,"fixture_read_end"); return b;
}
static void write_public(const char *directory,const uint8_t *bytes,size_t length) {
    char path[4096];path_for(path,sizeof(path),directory,"memberOriginal.bin");
    int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    require(fd>=0,"exclusive_public_member");size_t used=0;
    while(used<length) {
        ssize_t n=write(fd,bytes+used,length-used);
        if(n<0 && errno==EINTR) {continue;}
        require(n>0,"public_member_write");used+=(size_t)n;
    }
    require(fsync(fd)==0 && close(fd)==0,"public_member_sync");
}
static void reject(YNXAccountInitialRequestV1 *r,uint8_t *out,size_t capacity,int32_t expected,
    uint32_t expected_cleanup,int layout,const char *label) {
    uint8_t snapshot[CAP+GUARD];memcpy(snapshot,out,sizeof(snapshot));
    size_t length=777;uint32_t cleanup=999;
    int32_t result=YNXAccountInitialSignV1(r,out,capacity,&length,&cleanup);
    require(result==expected,label);
    require(length==(layout?777u:0u) && cleanup==(layout?999u:expected_cleanup),"failure_scalar_contract");
    require(memcmp(snapshot,out,sizeof(snapshot))==0,"failure_exposed_partial_output");cases++;
}
int main(int argc,char **argv) {
    require(argc==2,"usage_synthetic_input_directory");
    Blob message=read_blob(argv[1],"message.bin",4096),genesis=read_blob(argv[1],"genesis.json",67108864);
    Blob genesis_pin=read_blob(argv[1],"genesis-sha256.bin",32);require(genesis_pin.length==32,"exact_genesis_pin");
    Blob a=read_blob(argv[1],"SYNTHETIC-ONLY-a.der",54),b=read_blob(argv[1],"SYNTHETIC-ONLY-b.der",150);
    Blob pa=read_blob(argv[1],"pk-a.bin",2592),pb=read_blob(argv[1],"pk-b.bin",64);
    require(a.length==54 && b.length==150 && pa.length==2592 && pb.length==64,"exact_synthetic_material");
    uint8_t saved_a[54],saved_b[150];memcpy(saved_a,a.bytes,54);memcpy(saved_b,b.bytes,150);
    uint8_t network[32];memset(network,0x42,sizeof(network));
    uint8_t *out=(uint8_t *)malloc(CAP+GUARD);require(out!=NULL,"output_allocation");memset(out,0xa5,CAP+GUARD);
    YNXAccountInitialRequestV1 r;memset(&r,0,sizeof(r));
    r.abi_version=YNX_ACCOUNT_INITIAL_ABI_V1;r.struct_size=sizeof(r);
    r.message_original=span(message.bytes,message.length);r.genesis_original=span(genesis.bytes,genesis.length);
    r.expected.genesis_sha256=span(genesis_pin.bytes,genesis_pin.length);
    r.expected.network_id=span(network,32);r.expected.owner=text("0x1111111111111111111111111111111111111111");
    r.expected.native_chain_id=6423;r.expected.execution_height=text("2");
    r.expected.pk_a=span(pa.bytes,pa.length);r.expected.pk_b=span(pb.bytes,pb.length);
    r.pkcs8_a=span(a.bytes,a.length);r.pkcs8_b=span(b.bytes,b.length);r.pk_a=r.expected.pk_a;r.pk_b=r.expected.pk_b;
    reject(NULL,out,CAP,YNX_INITIAL_INVALID_ARGUMENT_V1,0,1,"null_request");
    reject(&r,out,CAP-1,YNX_INITIAL_CAPACITY_V1,0,1,"fixed_capacity");
    YNXAccountInitialRequestV1 changed=r;changed.struct_size--;
    reject(&changed,out,CAP,YNX_INITIAL_INVALID_ARGUMENT_V1,0,1,"struct_size");
    changed=r;changed.message_original.length=SIZE_MAX;
    reject(&changed,out,CAP,YNX_INITIAL_BOUNDS_V1,0,1,"extent_bounds");
    changed=r;changed.pkcs8_a.bytes=NULL;
    reject(&changed,out,CAP,YNX_INITIAL_BOUNDS_V1,0,1,"null_key_borrow");
    changed=r;changed.expected.native_chain_id++;
    reject(&changed,out,CAP,YNX_INITIAL_PUBLIC_BINDING_V1,YNX_INITIAL_CLEANUP_NOT_REQUIRED_V1,0,"chain_binding");
    genesis_pin.bytes[0]^=1;changed=r;
    reject(&changed,out,CAP,YNX_INITIAL_PUBLIC_BINDING_V1,YNX_INITIAL_CLEANUP_NOT_REQUIRED_V1,0,"independent_genesis_pin");genesis_pin.bytes[0]^=1;
    changed=r;changed.expected.execution_height=text("1");
    reject(&changed,out,CAP,YNX_INITIAL_PUBLIC_BINDING_V1,YNX_INITIAL_CLEANUP_NOT_REQUIRED_V1,0,"pending_registration");
    a.bytes[0]^=1;
    reject(&r,out,CAP,YNX_INITIAL_KEY_MATERIAL_V1,YNX_INITIAL_CLEANUP_LOGICAL_COMPLETE_V1,0,"actual_private_der_failure");a.bytes[0]^=1;
    /* All alias memory is our live CAP allocation. A regression cannot turn
     * the test into an out-of-allocation write into a short DER/public span. */
    changed=r;changed.pkcs8_a=span(out,54);
    reject(&changed,out,CAP,YNX_INITIAL_OVERLAP_V1,0,1,"private_output_alias");
    changed=r;changed.message_original=span(out,message.length);
    reject(&changed,out,CAP,YNX_INITIAL_OVERLAP_V1,0,1,"message_output_alias");
    size_t length=0;uint32_t cleanup=YNX_INITIAL_CLEANUP_UNKNOWN_V1;
    require(YNXAccountInitialSignV1(&r,out,CAP,&length,&cleanup)==YNX_INITIAL_OK_V1,"actual_fixed_account_initial_TX_BATCH_sign");
    require(length>0 && length<=CAP && cleanup==YNX_INITIAL_CLEANUP_LOGICAL_COMPLETE_V1,"success_bounds_cleanup");
    for(size_t i=length;i<CAP+GUARD;i++) {require(out[i]==0xa5,"success_touched_unused_capacity");}
    require(memcmp(a.bytes,saved_a,54)==0 && memcmp(b.bytes,saved_b,150)==0,"borrowed_secret_modified");
    write_public(argv[1],out,length);cases++;
    memset(out,0xa5,CAP+GUARD);wipe(a.bytes,a.length);wipe(b.bytes,b.length);
    reject(&r,out,CAP,YNX_INITIAL_KEY_MATERIAL_V1,YNX_INITIAL_CLEANUP_LOGICAL_COMPLETE_V1,0,"no_retained_key_after_borrow_removed");
    wipe(saved_a,sizeof(saved_a));wipe(saved_b,sizeof(saved_b));
    free(a.bytes);free(b.bytes);free(pa.bytes);free(pb.bytes);free(message.bytes);free(genesis.bytes);free(genesis_pin.bytes);free(out);
    printf("YNX_ACCOUNT_INITIAL_C_DRIVER_PASS cases=%u authority=false\n",cases);return 0;
}
