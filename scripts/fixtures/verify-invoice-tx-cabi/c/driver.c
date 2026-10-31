#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "tx_batch.h"
#include "registered_n1_verify.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Synthetic fixture only: the same original archive supplies BOTH APIs.
 * No Wallet, approval, account state, RPC, retry-sign loop or crypto substitute. */
enum { CAP = YNX_TRANSACTION_BATCH_MEMBER_CAPACITY_V1, GUARD = 16 };
typedef struct { uint8_t *data; size_t size; } Blob;
static unsigned signed_members, rejected_calls, rejected_verifications;
static void require(int ok,const char *label) {
    if(!ok) { fprintf(stderr,"INVOICE_TX_CABI_REFUSED %s\n",label);exit(1); }
}
static void wipe(void *memory,size_t n) { volatile uint8_t *p=memory;while(n--) { *p++=0; } }
static YNXTransactionBytesV1 span(const void *p,size_t n) { YNXTransactionBytesV1 s={p,n};return s; }
static YNXTransactionBytesV1 text(const char *p) { return span(p,strlen(p)); }
static YNXReadOnlyPublicSpanV1 pub(const void *p,size_t n) { YNXReadOnlyPublicSpanV1 s={p,n};return s; }
static Blob read_blob(int dir,const char *name,size_t max) {
    struct stat info;Blob b={NULL,0};int fd=openat(dir,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
    require(fd>=0&&fstat(fd,&info)==0,"input_open");
    require(S_ISREG(info.st_mode)&&info.st_nlink==1&&info.st_uid==geteuid()&&(info.st_mode&0777)==0600&&info.st_size>0&&(uintmax_t)info.st_size<=max,"bounded_owned_input");
    b.size=(size_t)info.st_size;b.data=malloc(b.size);require(b.data!=NULL,"input_allocation");
    size_t used=0;while(used<b.size){ssize_t n=read(fd,b.data+used,b.size-used);if(n<0&&errno==EINTR){continue;}require(n>0,"input_read");used+=(size_t)n;}
    uint8_t extra;require(read(fd,&extra,1)==0&&close(fd)==0,"input_extent");return b;
}
static void absent(int dir,const char *name) {
    struct stat info;errno=0;require(fstatat(dir,name,&info,AT_SYMLINK_NOFOLLOW)<0&&errno==ENOENT,"existing_or_UNKNOWN_output_preserved");
}
static void write_public(int dir,const char *name,const uint8_t *data,size_t size) {
    int fd=openat(dir,name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);require(fd>=0,"exclusive_public_output");
    size_t used=0;while(used<size){ssize_t n=write(fd,data+used,size-used);if(n<0&&errno==EINTR){continue;}require(n>0,"public_write_UNKNOWN_preserved");used+=(size_t)n;}
    require(fsync(fd)==0&&close(fd)==0,"public_sync_UNKNOWN_preserved");
}
static void reject_sign(YNXTransactionBatchRequestV1 *r,uint8_t *out,size_t capacity,int32_t code,uint32_t clean,int layout) {
    uint8_t snapshot[CAP+GUARD];memcpy(snapshot,out,sizeof(snapshot));
    size_t length=777;uint32_t cleanup=999;
    require(YNXTransactionBatchSignV1(r,out,capacity,&length,&cleanup)==code,"real_signer_negative_result");
    require(length==(layout?777u:0u)&&cleanup==(layout?999u:clean),"failure_scalar_contract");
    require(memcmp(snapshot,out,sizeof(snapshot))==0,"failure_changed_retained_original");rejected_calls++;
}
static void verify_member(YNXRegisteredANDMemberVerifyN1RequestV1 *r,int32_t expected) {
    YNXRegisteredANDMemberVerifyN1ResultV1 result;memset(&result,0xa5,sizeof(result));
    int32_t status=YNXRegisteredANDMemberVerifyN1V1(r,&result);
    require(status==expected,"independent_actual_registered_verifier");
    require(result.version==1&&result.struct_size==sizeof(result)&&result.index==0&&result.cleanup_status==0&&result.reserved==0,"verifier_result_shape");
    require(result.verified==(expected==0?1u:0u)&&result.member_count==(expected==0?1u:0u),"no_partial_verification");
    if(expected!=0){rejected_verifications++;}
}
static uint32_t be32(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|(uint32_t)p[3];}
/* Strict framing inspection only, to corrupt one actual signature branch.
 * All mathematical verification is performed by the production CABI above. */
static Blob field(Blob wire,uint32_t count,uint32_t index) {
    require(wire.size>=4&&be32(wire.data)==count&&index<count,"actual_E_count");
    size_t at=4;Blob out={NULL,0};
    for(uint32_t i=0;i<count;i++){require(wire.size-at>=4,"actual_E_length");size_t n=be32(wire.data+at);at+=4;require(n<=wire.size-at,"actual_E_extent");if(i==index){out.data=wire.data+at;out.size=n;}at+=n;}
    require(at==wire.size,"actual_E_trailing");return out;
}
static size_t sign_success(YNXTransactionBatchRequestV1 *r,uint8_t *out) {
    memset(out,0xa5,CAP+GUARD);size_t length=0;uint32_t cleanup=YNX_TRANSACTION_CLEANUP_UNKNOWN_V1;
    require(YNXTransactionBatchSignV1(r,out,CAP,&length,&cleanup)==YNX_TRANSACTION_OK_V1,"actual_invoice_fixed_TX_BATCH_sign");
    require(length>0&&length<=CAP&&cleanup==YNX_TRANSACTION_CLEANUP_LOGICAL_COMPLETE_V1,"sign_result_cleanup");
    for(size_t i=length;i<CAP+GUARD;i++){require(out[i]==0xa5,"unused_capacity_guard");}
    signed_members++;return length;
}
int main(int argc,char **argv) {
    require(argc==2&&argv[1][0]=='/',"usage_absolute_synthetic_directory");
    int dir=open(argv[1],O_RDONLY|O_DIRECTORY|O_NOFOLLOW|O_CLOEXEC);struct stat info;
    require(dir>=0&&fstat(dir,&info)==0&&S_ISDIR(info.st_mode)&&(info.st_mode&0777)==0700&&info.st_uid==geteuid(),"private_case_directory");
    for(unsigned i=0;i<5;i++){char name[32];int n=snprintf(name,sizeof(name),"member-%u.bin",i);require(n>0&&(size_t)n<sizeof(name),"output_name");absent(dir,name);}absent(dir,"DRIVER-RESULT.json");
    Blob messages[4];for(unsigned i=0;i<4;i++){char name[32];int n=snprintf(name,sizeof(name),"message-%u.bin",i);require(n>0&&(size_t)n<sizeof(name),"message_name");messages[i]=read_blob(dir,name,8192);}
    Blob policy=read_blob(dir,"policy-rotated.json",8388608),revoked=read_blob(dir,"policy-revoked.json",8388608);
    Blob a=read_blob(dir,"SYNTHETIC-ONLY-a.der",54),b=read_blob(dir,"SYNTHETIC-ONLY-b.der",150),na=read_blob(dir,"SYNTHETIC-ONLY-next-a.der",54),nb=read_blob(dir,"SYNTHETIC-ONLY-next-b.der",150);
    Blob pa=read_blob(dir,"pk-a.bin",2592),pb=read_blob(dir,"pk-b.bin",64),npa=read_blob(dir,"pk-next-a.bin",2592),npb=read_blob(dir,"pk-next-b.bin",64);
    require(a.size==54&&b.size==150&&na.size==54&&nb.size==150&&pa.size==2592&&pb.size==64&&npa.size==2592&&npb.size==64,"exact_two_synthetic_pairs");
    uint8_t secret_snapshot[408];memcpy(secret_snapshot,a.data,54);memcpy(secret_snapshot+54,b.data,150);memcpy(secret_snapshot+204,na.data,54);memcpy(secret_snapshot+258,nb.data,150);
    uint8_t network[32];for(unsigned i=0;i<32;i++){network[i]=(uint8_t)i;}
    uint8_t *out=malloc(CAP+GUARD);require(out!=NULL,"output_allocation");memset(out,0xa5,CAP+GUARD);
    YNXTransactionBatchRequestV1 r;memset(&r,0,sizeof(r));r.abi_version=1;r.struct_size=sizeof(r);
    r.policy_original=span(policy.data,policy.size);r.expected.network_id=span(network,32);r.expected.owner=text("0x1234567890abcdef1234567890abcdef12345678");r.expected.native_chain_id=UINT64_C(9007199254740993);r.expected.key_version=text("1");r.expected.execution_height=text("7");r.expected.pk_a=span(pa.data,pa.size);r.expected.pk_b=span(pb.data,pb.size);r.pkcs8_a=span(a.data,a.size);r.pkcs8_b=span(b.data,b.size);r.pk_a=r.expected.pk_a;r.pk_b=r.expected.pk_b;
    r.message_original=span(messages[0].data,messages[0].size);
    reject_sign(NULL,out,CAP,YNX_TRANSACTION_INVALID_ARGUMENT_V1,0,1);
    reject_sign(&r,out,CAP-1,YNX_TRANSACTION_CAPACITY_V1,0,1);
    YNXTransactionBatchRequestV1 changed=r;changed.pkcs8_a=span(out,54);reject_sign(&changed,out,CAP,YNX_TRANSACTION_OVERLAP_V1,0,1);
    for(unsigned i=0;i<4;i++) {
        r.message_original=span(messages[i].data,messages[i].size);
        changed=r;changed.expected.key_version=text("2");reject_sign(&changed,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);
        changed=r;changed.expected.execution_height=text("8");reject_sign(&changed,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);
        changed=r;changed.expected.pk_a=span(npa.data,npa.size);reject_sign(&changed,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);
        changed=r;changed.expected.pk_b=span(npb.data,npb.size);reject_sign(&changed,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);
        network[0]^=1;reject_sign(&r,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);network[0]^=1;
        messages[i].data[0]^=0x80;reject_sign(&r,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);messages[i].data[0]^=0x80;
        size_t length=sign_success(&r,out);
        YNXRegisteredANDMemberVerifyN1RequestV1 vr;memset(&vr,0,sizeof(vr));vr.version=1;vr.struct_size=sizeof(vr);vr.member=pub(out,length);vr.message=pub(messages[i].data,messages[i].size);vr.network=pub(network,32);vr.owner=pub(r.expected.owner.bytes,r.expected.owner.length);vr.purpose=pub("TX-BATCH",8);vr.pk_a=pub(pa.data,pa.size);vr.pk_b=pub(pb.data,pb.size);vr.policy_revision=1;vr.observed_height=7;vr.active_from=2;vr.enabled=1;
        verify_member(&vr,YNX_N1_VERIFY_OK);
        Blob member={out,length};Blob cert=field(member,4,1);Blob sigma_a=field(cert,3,1),sigma_b=field(cert,3,2);
        require(sigma_a.size==4627&&sigma_b.size==49856,"fixed_actual_dual_signature_sizes");
        sigma_a.data[0]^=1;verify_member(&vr,YNX_N1_VERIFY_MATH_INVALID);sigma_a.data[0]^=1;
        sigma_b.data[0]^=1;verify_member(&vr,YNX_N1_VERIFY_MATH_INVALID);sigma_b.data[0]^=1;
        YNXRegisteredANDMemberVerifyN1RequestV1 bad=vr;bad.purpose=pub("ACCOUNT-MIGRATION",17);verify_member(&bad,YNX_N1_VERIFY_TRUST_DENIED);
        messages[i].data[messages[i].size-1]^=1;verify_member(&vr,YNX_N1_VERIFY_MATH_INVALID);messages[i].data[messages[i].size-1]^=1;
        network[0]^=1;verify_member(&vr,YNX_N1_VERIFY_TRUST_DENIED);network[0]^=1;
        bad=vr;bad.pk_b=pub(npb.data,npb.size);verify_member(&bad,YNX_N1_VERIFY_TRUST_DENIED);
        char name[32];int n=snprintf(name,sizeof(name),"member-%u.bin",i);require(n>0&&(size_t)n<sizeof(name),"member_name");write_public(dir,name,out,length);
        /* Late caller uncertainty retains exact original before any further
         * admission check. This failure must not replace the buffer or file.
         * It does not inject a runtime panic or claim Wallet journal recovery. */
        changed=r;changed.expected.key_version=text("2");reject_sign(&changed,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);
        Blob retained=read_blob(dir,name,CAP);require(retained.size==length&&memcmp(retained.data,out,length)==0,"late_unknown_original_preserved");free(retained.data);
    }
    /* Legitimate epoch2 full policy plus old material must fail, while the
     * matching new pair succeeds through the SAME unchanged normal C entry. */
    r.message_original=span(messages[0].data,messages[0].size);r.expected.execution_height=text("8");r.expected.key_version=text("2");r.expected.pk_a=span(npa.data,npa.size);r.expected.pk_b=span(npb.data,npb.size);
    reject_sign(&r,out,CAP,YNX_TRANSACTION_KEY_MATERIAL_V1,YNX_TRANSACTION_CLEANUP_LOGICAL_COMPLETE_V1,0);
    r.pkcs8_a=span(na.data,na.size);r.pkcs8_b=span(nb.data,nb.size);r.pk_a=r.expected.pk_a;r.pk_b=r.expected.pk_b;
    changed=r;changed.policy_original=span(revoked.data,revoked.size);changed.expected.execution_height=text("9");reject_sign(&changed,out,CAP,YNX_TRANSACTION_PUBLIC_BINDING_V1,YNX_TRANSACTION_CLEANUP_NOT_REQUIRED_V1,0);
    na.data[0]^=1;reject_sign(&r,out,CAP,YNX_TRANSACTION_KEY_MATERIAL_V1,YNX_TRANSACTION_CLEANUP_LOGICAL_COMPLETE_V1,0);na.data[0]^=1;
    nb.data[0]^=1;reject_sign(&r,out,CAP,YNX_TRANSACTION_KEY_MATERIAL_V1,YNX_TRANSACTION_CLEANUP_LOGICAL_COMPLETE_V1,0);nb.data[0]^=1;
    size_t length=sign_success(&r,out);
    YNXRegisteredANDMemberVerifyN1RequestV1 vr;memset(&vr,0,sizeof(vr));vr.version=1;vr.struct_size=sizeof(vr);vr.member=pub(out,length);vr.message=pub(messages[0].data,messages[0].size);vr.network=pub(network,32);vr.owner=pub(r.expected.owner.bytes,r.expected.owner.length);vr.purpose=pub("TX-BATCH",8);vr.pk_a=pub(npa.data,npa.size);vr.pk_b=pub(npb.data,npb.size);vr.policy_revision=2;vr.observed_height=8;vr.active_from=8;vr.enabled=1;verify_member(&vr,YNX_N1_VERIFY_OK);
    write_public(dir,"member-4.bin",out,length);
    require(memcmp(secret_snapshot,a.data,54)==0&&memcmp(secret_snapshot+54,b.data,150)==0&&memcmp(secret_snapshot+204,na.data,54)==0&&memcmp(secret_snapshot+258,nb.data,150)==0,"borrowed_secret_modified");
    wipe(a.data,a.size);wipe(b.data,b.size);wipe(na.data,na.size);wipe(nb.data,nb.size);wipe(secret_snapshot,sizeof(secret_snapshot));
    reject_sign(&r,out,CAP,YNX_TRANSACTION_KEY_MATERIAL_V1,YNX_TRANSACTION_CLEANUP_LOGICAL_COMPLETE_V1,0);
    char receipt[1024];int size=snprintf(receipt,sizeof(receipt),"{\"version\":\"YNX-INVOICE-TX-CABI-DRIVER/v1\",\"actualCABIExecuted\":true,\"actualRegisteredVerifier\":true,\"signedMembers\":%u,\"rejectedCalls\":%u,\"rejectedVerifications\":%u,\"lateCallerOriginalPreserved\":true,\"abiPanicInjected\":false,\"syntheticOnly\":true,\"authorityGranted\":false}",signed_members,rejected_calls,rejected_verifications);
    require(size>0&&(size_t)size<sizeof(receipt),"bounded_public_receipt");write_public(dir,"DRIVER-RESULT.json",(const uint8_t *)receipt,(size_t)size);
    free(a.data);free(b.data);free(na.data);free(nb.data);free(pa.data);free(pb.data);free(npa.data);free(npb.data);free(policy.data);free(revoked.data);for(unsigned i=0;i<4;i++){free(messages[i].data);}free(out);require(close(dir)==0,"close_case");
    printf("INVOICE_TX_CABI_C_DRIVER_PASS members=%u rejectedCalls=%u rejectedVerifications=%u actualCABI=true authority=false\n",signed_members,rejected_calls,rejected_verifications);return 0;
}
