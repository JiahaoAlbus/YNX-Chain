#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "publisher_registration.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <spawn.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
extern char **environ;

/* CI-only C caller of the SAME already built shared archive. The newly
 * generated private custody never leaves this C process or reaches disk. */
enum { CAP=131072, PRIV=16384, PUB=8192, GUARD=16 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
static unsigned cases;
static uint8_t *private_output;
static Blob custodian_a, custodian_b;
static void wipe(void *p,size_t n) { volatile uint8_t *v=(volatile uint8_t *)p; while(n--!=0u){*v++=0;} }
static void cleanup_private(void) {
    if(private_output!=NULL){wipe(private_output,PRIV+GUARD);free(private_output);private_output=NULL;}
    if(custodian_a.bytes!=NULL){wipe(custodian_a.bytes,custodian_a.length);free(custodian_a.bytes);custodian_a.bytes=NULL;}
    if(custodian_b.bytes!=NULL){wipe(custodian_b.bytes,custodian_b.length);free(custodian_b.bytes);custodian_b.bytes=NULL;}
}
static void need(int ok,const char *label){if(!ok){fprintf(stderr,"YNX_PUBLISHER_CABI_REFUSED %s\n",label);exit(1);}}
static YNXArtifactBytesV1 span(const void *p,size_t n){YNXArtifactBytesV1 s={(const uint8_t *)p,n};return s;}
static YNXArtifactBytesV1 text(const char *p){return span(p,strlen(p));}
static YNXProjectControlBytesV1 control_span(const void *p,size_t n){YNXProjectControlBytesV1 s={(const uint8_t *)p,n};return s;}
static YNXProjectControlBytesV1 control_text(const char *p){return control_span(p,strlen(p));}
static void path_for(char *p,size_t n,const char *d,const char *name){int k=snprintf(p,n,"%s/%s",d,name);need(k>0&&(size_t)k<n,"path_bound");}
static Blob read_blob(const char *d,const char *name,size_t maximum){
    char path[4096];struct stat s;Blob b={NULL,0};path_for(path,sizeof(path),d,name);
    int fd=open(path,O_RDONLY|O_NOFOLLOW);need(fd>=0&&fstat(fd,&s)==0,"fixture_open");
    need(S_ISREG(s.st_mode)&&s.st_nlink==1&&(s.st_mode&0777)==0600&&s.st_size>0&&(uintmax_t)s.st_size<=maximum,"bounded_fixture");
    b.length=(size_t)s.st_size;b.bytes=(uint8_t *)malloc(b.length);need(b.bytes!=NULL,"allocation");
    size_t used=0;while(used<b.length){ssize_t k=read(fd,b.bytes+used,b.length-used);if(k<0&&errno==EINTR){continue;}need(k>0,"fixture_read");used+=(size_t)k;}
    uint8_t extra;need(read(fd,&extra,1)==0&&close(fd)==0,"fixture_end");return b;
}
static void write_public(const char *d,const char *name,const uint8_t *p,size_t n){
    char path[4096];path_for(path,sizeof(path),d,name);int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);need(fd>=0,"exclusive_public_output");
    size_t used=0;while(used<n){ssize_t k=write(fd,p+used,n-used);if(k<0&&errno==EINTR){continue;}need(k>0,"public_write");used+=(size_t)k;}
    need(fsync(fd)==0&&close(fd)==0,"public_sync");
}
static Blob take_span(const uint8_t *p,size_t n,size_t *at){
    need(*at<=n&&n-*at>=4,"custody_prefix");
    uint32_t k=((uint32_t)p[*at]<<24)|((uint32_t)p[*at+1]<<16)|((uint32_t)p[*at+2]<<8)|p[*at+3];*at+=4;
    need((size_t)k<=n-*at,"custody_extent");Blob b={(uint8_t *)(uintptr_t)(p+*at),(size_t)k};*at+=(size_t)k;return b;
}
static void reject_generate(YNXPublisherGenerateRequestV1 *r,uint8_t *public_output,size_t pc,size_t uc,int32_t expected,int layout){
    uint8_t before_private[PRIV+GUARD],before_public[PUB+GUARD];
    memcpy(before_private,private_output,sizeof(before_private));memcpy(before_public,public_output,sizeof(before_public));
    size_t pl=777,ul=888;uint32_t cleanup=999;
    int32_t rc=YNXPublisherGenerateV1(r,private_output,pc,&pl,public_output,uc,&ul,&cleanup);
    need(rc==expected,"generate_negative_result");need(pl==(layout?777u:0u)&&ul==(layout?888u:0u)&&cleanup==(layout?999u:YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1),"generate_failure_scalars");
    need(memcmp(before_private,private_output,sizeof(before_private))==0&&memcmp(before_public,public_output,sizeof(before_public))==0,"generate_partial_output");cases++;
}
static void reject_pop(YNXPublisherPoPRequestV1 *r,uint8_t *out,size_t capacity,int32_t expected,uint32_t cleaned,int layout){
    uint8_t *before=(uint8_t *)malloc(CAP+GUARD);need(before!=NULL,"snapshot_allocation");memcpy(before,out,CAP+GUARD);
    size_t length=777;uint32_t cleanup=999;int32_t rc=YNXPublisherPoPSignV1(r,out,capacity,&length,&cleanup);
    need(rc==expected,"pop_negative_result");need(length==(layout?777u:0u)&&cleanup==(layout?999u:cleaned),"pop_failure_scalars");
    need(memcmp(before,out,CAP+GUARD)==0,"pop_partial_output");free(before);cases++;
}
static void reject_custodian(YNXPublisherCustodianRequestV1 *r,uint8_t *out,size_t capacity,int32_t expected,uint32_t cleaned,int layout){
    uint8_t *before=(uint8_t *)malloc(CAP+GUARD);need(before!=NULL,"snapshot_allocation");memcpy(before,out,CAP+GUARD);
    size_t length=777;uint32_t cleanup=999;int32_t rc=YNXPublisherCustodianSignV1(r,out,capacity,&length,&cleanup);
    need(rc==expected,"custodian_negative_result");need(length==(layout?777u:0u)&&cleanup==(layout?999u:cleaned),"custodian_failure_scalars");
    need(memcmp(before,out,CAP+GUARD)==0,"custodian_partial_output");free(before);cases++;
}
static void originals_helper(const char *exe,const char *directory){
    /* Spawn only the public fixture arguments; do not fork a child that runs
     * application code with a copy of the linked Go runtime/private C buffers. */
    need(exe[0]=='/',"fixed_fixture_absolute_executable");pid_t pid;
    char *const args[]={(char *)(uintptr_t)exe,"originals",(char *)(uintptr_t)directory,NULL};
    need(posix_spawn(&pid,exe,NULL,NULL,args,environ)==0,"public_originals_spawn");
    int status;pid_t joined;do{joined=waitpid(pid,&status,0);}while(joined<0&&errno==EINTR);
    need(joined==pid&&WIFEXITED(status)&&WEXITSTATUS(status)==0,"independent_public_originals_helper");
}
int main(int argc,char **argv){
    need(argc==3,"usage_input_directory_and_public_fixture");need(atexit(cleanup_private)==0,"private_cleanup_registration");
    Blob account=read_blob(argv[1],"account.txt",256);
    uint8_t network[32];memset(network,0x42,sizeof(network));
    private_output=(uint8_t *)malloc(PRIV+GUARD);uint8_t *public_output=(uint8_t *)malloc(PUB+GUARD),*out=(uint8_t *)malloc(CAP+GUARD);
    need(private_output!=NULL&&public_output!=NULL&&out!=NULL,"output_allocation");memset(private_output,0xa5,PRIV+GUARD);memset(public_output,0xa5,PUB+GUARD);memset(out,0xa5,CAP+GUARD);
    YNXPublisherGenerateRequestV1 g;memset(&g,0,sizeof(g));g.abi_version=1;g.struct_size=sizeof(g);
    g.identity.network_id=span(network,32);g.identity.subject_owner=text("0x1111111111111111111111111111111111111111");g.identity.account=span(account.bytes,account.length);
    g.identity.project_id=text("PUBLIC-project");g.identity.publisher_id=text("PUBLIC-publisher");g.identity.publisher_key_version=text("1");
    reject_generate(NULL,public_output,PRIV,PUB,YNX_ARTIFACT_INVALID_ARGUMENT_V1,1);
    reject_generate(&g,public_output,PRIV-1,PUB,YNX_ARTIFACT_CAPACITY_V1,1);
    reject_generate(&g,public_output,PRIV,PUB-1,YNX_ARTIFACT_CAPACITY_V1,1);
    YNXPublisherGenerateRequestV1 gg=g;gg.struct_size--;reject_generate(&gg,public_output,PRIV,PUB,YNX_ARTIFACT_INVALID_ARGUMENT_V1,1);
    gg=g;gg.identity.network_id.bytes=NULL;reject_generate(&gg,public_output,PRIV,PUB,YNX_ARTIFACT_BOUNDS_V1,1);
    gg=g;gg.identity.network_id.bytes=(const uint8_t *)(uintptr_t)(UINTPTR_MAX-16u);reject_generate(&gg,public_output,PRIV,PUB,YNX_ARTIFACT_BOUNDS_V1,1);
    gg=g;gg.identity.project_id=span(private_output,14);reject_generate(&gg,public_output,PRIV,PUB,YNX_ARTIFACT_OVERLAP_V1,1);
    gg=g;gg.identity.publisher_key_version=text("01");reject_generate(&gg,public_output,PRIV,PUB,YNX_ARTIFACT_PUBLIC_BINDING_V1,0);
    size_t pl=777,ul=888;uint32_t cleanup=999;
    need(YNXPublisherGenerateV1(&g,private_output,PRIV,&pl,private_output,PUB,&ul,&cleanup)==YNX_ARTIFACT_OVERLAP_V1&&pl==777u&&ul==888u&&cleanup==999u,"generate_output_alias");cases++;
    need(YNXPublisherGenerateV1(&g,private_output,PRIV,&pl,public_output,PUB,&pl,&cleanup)==YNX_ARTIFACT_OVERLAP_V1&&pl==777u&&cleanup==999u,"generate_scalar_alias");cases++;
    for(size_t k=0;k<PRIV+GUARD;k++){need(private_output[k]==0xa5,"generate_layout_wrote_private");}
    for(size_t k=0;k<PUB+GUARD;k++){need(public_output[k]==0xa5,"generate_layout_wrote_public");}
    pl=0;ul=0;cleanup=0;need(YNXPublisherGenerateV1(&g,private_output,PRIV,&pl,public_output,PUB,&ul,&cleanup)==YNX_ARTIFACT_OK_V1,"actual_generate");
    need(pl>0&&pl<=PRIV&&ul>0&&ul<=PUB&&cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1,"generate_cleanup_bounds");cases++;
    for(size_t k=pl;k<PRIV+GUARD;k++){need(private_output[k]==0xa5,"private_unused_capacity");}
    for(size_t k=ul;k<PUB+GUARD;k++){need(public_output[k]==0xa5,"public_unused_capacity");}
    static const char magic[]="YNX-PUBLISHER-CUSTODY/v1\n";need(pl>=sizeof(magic)-1u&&memcmp(private_output,magic,sizeof(magic)-1u)==0,"existing_Main_custody_magic");
    size_t at=sizeof(magic)-1u;Blob r=take_span(private_output,pl,&at),a=take_span(private_output,pl,&at),b=take_span(private_output,pl,&at),pa=take_span(private_output,pl,&at),pb=take_span(private_output,pl,&at);
    need(at==pl&&r.length==ul&&memcmp(r.bytes,public_output,ul)==0&&a.length==54&&b.length==150&&pa.length==2592&&pb.length==64,"existing_Main_five_span_layout");
    uint8_t saved_a[54],saved_b[150];memcpy(saved_a,a.bytes,54);memcpy(saved_b,b.bytes,150);
    write_public(argv[1],"publicOriginal.bin",public_output,ul);originals_helper(argv[2],argv[1]);
    Blob principal=read_blob(argv[1],"principal.json",8192),command=read_blob(argv[1],"command.json",8192),registration=read_blob(argv[1],"registration.json",16384);
    YNXPublisherPoPRequestV1 p;memset(&p,0,sizeof(p));p.abi_version=1;p.struct_size=sizeof(p);p.public_original=span(public_output,ul);
    p.principal_original=span(principal.bytes,principal.length);p.command_original=span(command.bytes,command.length);p.registration_original=span(registration.bytes,registration.length);
    p.publisher.network_id=g.identity.network_id;p.publisher.subject_owner=g.identity.subject_owner;p.publisher.account=g.identity.account;p.publisher.project_id=g.identity.project_id;
    p.publisher.publisher_id=g.identity.publisher_id;p.publisher.publisher_key_version=g.identity.publisher_key_version;p.publisher.pk_a=span(pa.bytes,pa.length);p.publisher.pk_b=span(pb.bytes,pb.length);
    p.observed_at_ms=1001;p.pkcs8_a=span(a.bytes,a.length);p.pkcs8_b=span(b.bytes,b.length);p.pk_a=p.publisher.pk_a;p.pk_b=p.publisher.pk_b;
    reject_pop(NULL,out,CAP,YNX_ARTIFACT_INVALID_ARGUMENT_V1,0,1);reject_pop(&p,out,CAP-1,YNX_ARTIFACT_CAPACITY_V1,0,1);
    uint8_t *misaligned=(uint8_t *)malloc(sizeof(p)+1u);need(misaligned!=NULL,"misaligned_request_allocation");memcpy(misaligned+1,&p,sizeof(p));
    reject_pop((YNXPublisherPoPRequestV1 *)(void *)(misaligned+1),out,CAP,YNX_ARTIFACT_BOUNDS_V1,0,1);free(misaligned);
    YNXPublisherPoPRequestV1 pp=p;pp.pkcs8_a.bytes=NULL;reject_pop(&pp,out,CAP,YNX_ARTIFACT_BOUNDS_V1,0,1);
    pp=p;pp.pkcs8_a=span(out,54);reject_pop(&pp,out,CAP,YNX_ARTIFACT_OVERLAP_V1,0,1);
    pp=p;pp.command_original.length=SIZE_MAX;reject_pop(&pp,out,CAP,YNX_ARTIFACT_BOUNDS_V1,0,1);
    pp=p;pp.publisher.project_id=text("OTHER-project");reject_pop(&pp,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);
    pp=p;pp.observed_at_ms=20000;reject_pop(&pp,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);
    registration.bytes[registration.length-2]^=1;reject_pop(&p,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);registration.bytes[registration.length-2]^=1;
    a.bytes[0]^=1;reject_pop(&p,out,CAP,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1,0);a.bytes[0]^=1;
    size_t scalar_alias=777;
    need(YNXPublisherPoPSignV1(&p,out,CAP,&scalar_alias,(uint32_t *)(void *)&scalar_alias)==YNX_ARTIFACT_OVERLAP_V1&&scalar_alias==777u,"pop_scalar_overlap");cases++;
    union { max_align_t alignment; uint8_t bytes[64]; } alias_input;memset(alias_input.bytes,0x5a,sizeof(alias_input.bytes));
    pp=p;pp.pkcs8_a=span(alias_input.bytes,54);cleanup=999;
    need(YNXPublisherPoPSignV1(&pp,out,CAP,(size_t *)(void *)alias_input.bytes,&cleanup)==YNX_ARTIFACT_OVERLAP_V1&&cleanup==999u,"pop_scalar_private_input_overlap");
    for(size_t k=0;k<sizeof(alias_input.bytes);k++){need(alias_input.bytes[k]==0x5a,"layout_wrote_private_scalar_alias");}cases++;
    for(size_t k=0;k<CAP+GUARD;k++){need(out[k]==0xa5,"pop_layout_wrote_output");}
    size_t length=0;cleanup=0;need(YNXPublisherPoPSignV1(&p,out,CAP,&length,&cleanup)==YNX_ARTIFACT_OK_V1&&cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1&&length>0&&length<=CAP,"actual_fixed_E9_pop");cases++;
    for(size_t k=length;k<CAP+GUARD;k++){need(out[k]==0xa5,"pop_unused_capacity");}
    need(memcmp(a.bytes,saved_a,54)==0&&memcmp(b.bytes,saved_b,150)==0,"publisher_borrow_modified");
    Blob pop={(uint8_t *)malloc(length),length};need(pop.bytes!=NULL,"pop_allocation");memcpy(pop.bytes,out,length);write_public(argv[1],"popMemberOriginal.bin",pop.bytes,pop.length);
    custodian_a=read_blob(argv[1],"SYNTHETIC-ONLY-custodian-a.der",54);custodian_b=read_blob(argv[1],"SYNTHETIC-ONLY-custodian-b.der",150);
    Blob ca=read_blob(argv[1],"custodian-pk-a.bin",2592),cb=read_blob(argv[1],"custodian-pk-b.bin",64);
    need(custodian_a.length==54&&custodian_b.length==150&&ca.length==2592&&cb.length==64,"custodian_exact_material");
    uint8_t saved_ca[54],saved_cb[150];memcpy(saved_ca,custodian_a.bytes,54);memcpy(saved_cb,custodian_b.bytes,150);
    YNXPublisherCustodianRequestV1 c;memset(&c,0,sizeof(c));c.abi_version=1;c.struct_size=sizeof(c);
    c.public_original=p.public_original;c.principal_original=p.principal_original;c.command_original=p.command_original;c.registration_original=p.registration_original;c.pop_member_original=span(pop.bytes,pop.length);c.publisher=p.publisher;c.observed_at_ms=1001;
    c.custodian.network_id=control_span(network,32);c.custodian.owner=control_text("0x2222222222222222222222222222222222222222");c.custodian.key_version=control_text("18446744073709551615");
    c.custodian.execution_height=control_text("9007199254740993");c.custodian.caller_identity=control_text("PUBLIC-native");c.custodian.source_current_ref=control_text("PUBLIC-custodian-current");
    c.custodian.pk_a=control_span(ca.bytes,ca.length);c.custodian.pk_b=control_span(cb.bytes,cb.length);c.pkcs8_a=span(custodian_a.bytes,custodian_a.length);c.pkcs8_b=span(custodian_b.bytes,custodian_b.length);c.pk_a=span(ca.bytes,ca.length);c.pk_b=span(cb.bytes,cb.length);
    memset(out,0xa5,CAP+GUARD);reject_custodian(NULL,out,CAP,YNX_ARTIFACT_INVALID_ARGUMENT_V1,0,1);reject_custodian(&c,out,CAP-1,YNX_ARTIFACT_CAPACITY_V1,0,1);
    YNXPublisherCustodianRequestV1 cc=c;cc.pop_member_original=span(out,pop.length);reject_custodian(&cc,out,CAP,YNX_ARTIFACT_OVERLAP_V1,0,1);
    cc=c;cc.custodian.pk_a=control_span(pa.bytes,pa.length);reject_custodian(&cc,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);
    pop.bytes[pop.length-1]^=1;reject_custodian(&c,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);pop.bytes[pop.length-1]^=1;
    /* Keep framing, E9, and full pair intact: EACH real signature branch
     * must be checked before the custodian's borrowed DER can be imported. */
    size_t member_at=4;Blob member_tag=take_span(pop.bytes,pop.length,&member_at),cert=take_span(pop.bytes,pop.length,&member_at);
    need(member_tag.length>0&&cert.length>4,"actual_member_certificate");
    size_t cert_at=4;Blob descriptor=take_span(cert.bytes,cert.length,&cert_at),sig_a=take_span(cert.bytes,cert.length,&cert_at),sig_b=take_span(cert.bytes,cert.length,&cert_at);
    need(descriptor.length>0&&sig_a.length==4627&&sig_b.length==49856&&cert_at==cert.length,"actual_AND_signature_spans");
    sig_a.bytes[0]^=1;reject_custodian(&c,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);sig_a.bytes[0]^=1;
    sig_b.bytes[0]^=1;reject_custodian(&c,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);sig_b.bytes[0]^=1;
    cc=c;cc.custodian.source_current_ref=control_text("PUBLIC-other-current");reject_custodian(&cc,out,CAP,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1,0);
    custodian_b.bytes[0]^=1;reject_custodian(&c,out,CAP,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1,0);custodian_b.bytes[0]^=1;
    length=0;cleanup=0;need(YNXPublisherCustodianSignV1(&c,out,CAP,&length,&cleanup)==YNX_ARTIFACT_OK_V1&&cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1&&length>0&&length<=CAP,"actual_fixed_E12_custodian");cases++;
    for(size_t k=length;k<CAP+GUARD;k++){need(out[k]==0xa5,"custodian_unused_capacity");}
    need(memcmp(custodian_a.bytes,saved_ca,54)==0&&memcmp(custodian_b.bytes,saved_cb,150)==0&&memcmp(a.bytes,saved_a,54)==0&&memcmp(b.bytes,saved_b,150)==0,"original_borrows_modified");
    write_public(argv[1],"custodianMemberOriginal.bin",out,length);
    wipe(a.bytes,a.length);wipe(b.bytes,b.length);memset(out,0xa5,CAP+GUARD);
    reject_pop(&p,out,CAP,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1,0);
    wipe(saved_a,sizeof(saved_a));wipe(saved_b,sizeof(saved_b));wipe(saved_ca,sizeof(saved_ca));wipe(saved_cb,sizeof(saved_cb));
    char counter[32];int n=snprintf(counter,sizeof(counter),"%u\n",cases);need(n>0&&(size_t)n<sizeof(counter),"counter_bound");write_public(argv[1],"C-BOUNDARY-CASES.txt",(const uint8_t *)counter,(size_t)n);
    free(account.bytes);free(principal.bytes);free(command.bytes);free(registration.bytes);free(pop.bytes);free(ca.bytes);free(cb.bytes);free(public_output);free(out);
    printf("YNX_PUBLISHER_REGISTRATION_C_DRIVER_PASS cases=%u authority=false privateOutputPersisted=false\n",cases);return 0;
}
