#if defined(__APPLE__)
#define _DARWIN_C_SOURCE 1
#endif
#define _POSIX_C_SOURCE 200809L
#include "deployment_manifest_v2.h"
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

/* Real C caller, CI synthetic material only. No Source, native protected key,
 * publisher authority, approval, helper/IPC or physical-erasure claim. Every
 * address below belongs to a live allocation, never an arbitrary bad pointer. */
enum { CAP=YNX_DEPLOYMENT_MANIFEST_MEMBER_CAPACITY_V2, GUARD=16, EXPECTED_CASES=54 };
typedef struct { uint8_t *bytes; size_t length; } Blob;
static unsigned cases;
static void need(int ok,const char *name){if(!ok){fprintf(stderr,"YNX_DEPLOYMENT_V2_C_REFUSED %s\n",name);exit(1);}}
static void wipe(void *memory,size_t n){volatile uint8_t *p=(volatile uint8_t *)memory;while(n--!=0u){*p++=0;}}
static YNXArtifactBytesV1 span(const void *p,size_t n){YNXArtifactBytesV1 s={(const uint8_t *)p,n};return s;}
static YNXArtifactBytesV1 text(const char *s){return span(s,strlen(s));}
static void path_for(char *out,size_t capacity,const char *dir,const char *name){int n=snprintf(out,capacity,"%s/%s",dir,name);need(n>0&&(size_t)n<capacity,"fixed_fixture_path");}
static Blob read_blob(const char *dir,const char *name,size_t minimum,size_t maximum){
    char path[4096];struct stat st;Blob b={NULL,0};path_for(path,sizeof(path),dir,name);
    int fd=open(path,O_RDONLY|O_NOFOLLOW);need(fd>=0&&fstat(fd,&st)==0,"fixture_open");
    need(S_ISREG(st.st_mode)&&st.st_nlink==1&&st.st_uid==geteuid()&&(st.st_mode&0777)==0600&&st.st_size>=0&&(size_t)st.st_size>=minimum&&(size_t)st.st_size<=maximum,"owned_fixture_size_mode");
    b.length=(size_t)st.st_size;b.bytes=(uint8_t *)malloc(b.length==0?1:b.length);need(b.bytes!=NULL,"fixture_allocate");
    size_t at=0;while(at<b.length){ssize_t n=read(fd,b.bytes+at,b.length-at);if(n<0&&errno==EINTR){continue;}need(n>0,"fixture_read");at+=(size_t)n;}
    uint8_t end;need(read(fd,&end,1)==0&&close(fd)==0,"fixture_exact_end");return b;
}
static void write_public(const char *dir,const char *name,const void *raw,size_t length){
    char path[4096];path_for(path,sizeof(path),dir,name);int fd=open(path,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);need(fd>=0,"exclusive_public_output");
    size_t at=0;while(at<length){ssize_t n=write(fd,(const uint8_t *)raw+at,length-at);if(n<0&&errno==EINTR){continue;}need(n>0,"public_write");at+=(size_t)n;}
    need(fsync(fd)==0&&close(fd)==0,"public_file_sync");
    int parent=open(dir,O_RDONLY|O_NOFOLLOW);need(parent>=0&&fsync(parent)==0&&close(parent)==0,"public_parent_sync");
}
static void passed(const char *name){cases++;printf("YNX_DEPLOYMENT_V2_C_CASE_PASS %s\n",name);}
static void layout_reject(const char *label,YNXDeploymentManifestRequestV2 *req,uint8_t *out,size_t cap,size_t *length,uint32_t *cleanup,int32_t expected,const void *region,size_t region_size){
    uint8_t *before=(uint8_t *)malloc(region_size);need(before!=NULL,"snapshot_allocate");memcpy(before,region,region_size);
    uint8_t request_before[sizeof(YNXDeploymentManifestRequestV2)],length_before[sizeof(size_t)],cleanup_before[sizeof(uint32_t)];
    if(req!=NULL){memcpy(request_before,req,sizeof(request_before));}if(length!=NULL){memcpy(length_before,length,sizeof(length_before));}if(cleanup!=NULL){memcpy(cleanup_before,cleanup,sizeof(cleanup_before));}
    need(YNXDeploymentManifestSignV2(req,out,cap,length,cleanup)==expected,label);
    need(memcmp(region,before,region_size)==0,"layout_changed_buffer");
    need(req==NULL||memcmp(req,request_before,sizeof(request_before))==0,"layout_changed_request");
    need(length==NULL||memcmp(length,length_before,sizeof(length_before))==0,"layout_changed_length");
    need(cleanup==NULL||memcmp(cleanup,cleanup_before,sizeof(cleanup_before))==0,"layout_changed_cleanup");free(before);passed(label);
}
static void admitted_reject(const char *label,YNXDeploymentManifestRequestV2 *req,uint8_t *out,int32_t expected,uint32_t wanted_cleanup){
    memset(out,0xa5,CAP+GUARD);size_t length=777;uint32_t cleanup=999;
    need(YNXDeploymentManifestSignV2(req,out,CAP,&length,&cleanup)==expected,label);
    need(length==0&&cleanup==wanted_cleanup,"admitted_failure_lifecycle");
    for(size_t i=0;i<CAP+GUARD;i++){need(out[i]==0xa5,"admitted_failure_released_output");}passed(label);
}
static size_t successful(const char *label,YNXDeploymentManifestRequestV2 *req,uint8_t *out,size_t initial_length,uint32_t initial_cleanup){
    memset(out,0xa5,CAP+GUARD);size_t length=initial_length;uint32_t cleanup=initial_cleanup;
    need(YNXDeploymentManifestSignV2(req,out,CAP,&length,&cleanup)==YNX_ARTIFACT_OK_V1,label);
    need(length>0&&length<=CAP&&cleanup==YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1,"success_requires_logical_cleanup");
    for(size_t i=length;i<CAP+GUARD;i++){need(out[i]==0xa5,"success_changed_unused_capacity");}passed(label);return length;
}
static uint8_t *find_bytes(Blob b,const char *text_value){size_t n=strlen(text_value);for(size_t i=0;i+n<=b.length;i++){if(memcmp(b.bytes+i,text_value,n)==0){return b.bytes+i;}}need(0,"known_original_domain_missing");return NULL;}

int main(int argc,char **argv){
    need(argc==3,"usage_input_new_output");need(mkdir(argv[2],0700)==0,"exclusive_output_directory");
    Blob payload=read_blob(argv[1],"payloadOriginal.bin",1,16384),artifact=read_blob(argv[1],"artifact.bin",1,67108864);
    Blob payload_bind=read_blob(argv[1],"payload-bind.bin",152,152),artifact_bind=read_blob(argv[1],"artifact-bind.bin",152,152);
    Blob a=read_blob(argv[1],"SYNTHETIC-ONLY-a.der",54,54),b=read_blob(argv[1],"SYNTHETIC-ONLY-b.der",150,150),pa=read_blob(argv[1],"pk-a.bin",2592,2592),pb=read_blob(argv[1],"pk-b.bin",64,64);
    uint8_t saved_a[54],saved_b[150];memcpy(saved_a,a.bytes,54);memcpy(saved_b,b.bytes,150);
    uint8_t network[32];memset(network,0x42,sizeof(network));uint8_t *output=(uint8_t *)malloc(CAP+GUARD);need(output!=NULL,"output_allocate");memset(output,0xa5,CAP+GUARD);
    YNXDeploymentManifestRequestV2 request;memset(&request,0,sizeof(request));request.abi_version=YNX_DEPLOYMENT_MANIFEST_ABI_V2;request.struct_size=sizeof(request);
    request.payload_original=span(payload.bytes,payload.length);request.actual_artifact=span(artifact.bytes,artifact.length);request.expected_payload_original=request.payload_original;
    request.expected_payload_bind=span(payload_bind.bytes,payload_bind.length);request.expected_artifact_bind=span(artifact_bind.bytes,artifact_bind.length);
    request.profile_network_id=span(network,32);request.subject_owner=text("PUBLIC-ONLY-E11-PUBLISHER");request.expected_pk_a=span(pa.bytes,pa.length);request.expected_pk_b=span(pb.bytes,pb.length);
    request.pkcs8_a=span(a.bytes,a.length);request.pkcs8_b=span(b.bytes,b.length);request.pk_a=request.expected_pk_a;request.pk_b=request.expected_pk_b;
    size_t length=777;uint32_t cleanup=999;
    layout_reject("null_request",NULL,output,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    layout_reject("null_output",&request,NULL,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    layout_reject("null_length",&request,output,CAP,NULL,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    layout_reject("null_cleanup",&request,output,CAP,&length,NULL,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    const size_t capacities[3]={0,CAP-1,CAP+1};for(size_t i=0;i<3;i++){layout_reject("fixed_capacity",&request,output,capacities[i],&length,&cleanup,YNX_ARTIFACT_CAPACITY_V1,output,CAP+GUARD);}
    YNXDeploymentManifestRequestV2 changed=request;changed.abi_version=1;layout_reject("old_abi_cannot_sign_v2",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    changed=request;changed.struct_size--;layout_reject("exact_struct_size",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_INVALID_ARGUMENT_V1,output,CAP+GUARD);
    changed=request;changed.pkcs8_a.bytes=NULL;layout_reject("null_nonempty_private",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    changed=request;changed.pkcs8_b.length--;layout_reject("short_private",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    changed=request;changed.pk_a.length=SIZE_MAX;layout_reject("oversize_public_extent",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    changed=request;changed.actual_artifact.bytes=NULL;layout_reject("null_nonempty_artifact",&changed,output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    uint8_t *unaligned=(uint8_t *)malloc(sizeof(request)+1);need(unaligned!=NULL,"unaligned_request_allocate");memcpy(unaligned+1,&request,sizeof(request));
    layout_reject("misaligned_request",(YNXDeploymentManifestRequestV2 *)(void *)(unaligned+1),output,CAP,&length,&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);free(unaligned);
    uint8_t *scalar=(uint8_t *)malloc(sizeof(size_t)+1);need(scalar!=NULL,"unaligned_scalar_allocate");memset(scalar,0x77,sizeof(size_t)+1);
    layout_reject("misaligned_length",&request,output,CAP,(size_t *)(void *)(scalar+1),&cleanup,YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);
    layout_reject("misaligned_cleanup",&request,output,CAP,&length,(uint32_t *)(void *)(scalar+1),YNX_ARTIFACT_BOUNDS_V1,output,CAP+GUARD);free(scalar);
    for(size_t i=0;i<13;i++){
        changed=request;YNXArtifactBytesV1 *inputs[13]={&changed.payload_original,&changed.actual_artifact,&changed.expected_payload_original,&changed.expected_payload_bind,&changed.expected_artifact_bind,&changed.profile_network_id,&changed.subject_owner,&changed.expected_pk_a,&changed.expected_pk_b,&changed.pkcs8_a,&changed.pkcs8_b,&changed.pk_a,&changed.pk_b};
        uint8_t *alias=(uint8_t *)malloc(CAP+GUARD);need(alias!=NULL,"input_overlap_allocate");memset(alias,0xa5,CAP+GUARD);memcpy(alias,inputs[i]->bytes,inputs[i]->length);inputs[i]->bytes=alias;
        layout_reject("output_each_input_overlap",&changed,alias,CAP,&length,&cleanup,YNX_ARTIFACT_OVERLAP_V1,alias,CAP+GUARD);wipe(alias,CAP+GUARD);free(alias);
    }
    uint8_t *request_region=(uint8_t *)malloc(CAP+GUARD);need(request_region!=NULL,"request_overlap_allocate");memset(request_region,0xa5,CAP+GUARD);memcpy(request_region,&request,sizeof(request));
    layout_reject("output_request_overlap",(YNXDeploymentManifestRequestV2 *)(void *)request_region,request_region,CAP,&length,&cleanup,YNX_ARTIFACT_OVERLAP_V1,request_region,CAP+GUARD);free(request_region);
    memset(output,0xa5,CAP+GUARD);size_t *alias_length=(size_t *)(void *)output;*alias_length=777;
    layout_reject("length_output_overlap",&request,output,CAP,alias_length,&cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    memset(output,0xa5,CAP+GUARD);uint32_t *alias_cleanup=(uint32_t *)(void *)output;*alias_cleanup=999;
    layout_reject("cleanup_output_overlap",&request,output,CAP,&length,alias_cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    union{size_t length;uint32_t cleanup;}both;both.length=777;
    layout_reject("writable_scalars_overlap",&request,output,CAP,&both.length,&both.cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    changed=request;layout_reject("length_request_overlap",&changed,output,CAP,&changed.struct_size,&cleanup,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    changed=request;layout_reject("cleanup_request_overlap",&changed,output,CAP,&length,&changed.abi_version,YNX_ARTIFACT_OVERLAP_V1,output,CAP+GUARD);
    const char *variants[4]={"publisher-fullref","publisher-epoch","issuer-fullref","issuer-epoch"};
    for(size_t i=0;i<4;i++){
        char name[128];int n=snprintf(name,sizeof(name),"expected-%s.bin",variants[i]);need(n>0&&(size_t)n<sizeof(name),"variant_name");Blob expected=read_blob(argv[1],name,1,16384);
        n=snprintf(name,sizeof(name),"expected-%s-bind.bin",variants[i]);need(n>0&&(size_t)n<sizeof(name),"variant_bind_name");Blob bind=read_blob(argv[1],name,152,152);
        changed=request;changed.expected_payload_original=span(expected.bytes,expected.length);changed.expected_payload_bind=span(bind.bytes,bind.length);
        admitted_reject(variants[i],&changed,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);free(expected.bytes);free(bind.bytes);
    }
    payload_bind.bytes[payload_bind.length-1]^=1;admitted_reject("outer_payload_bind",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);payload_bind.bytes[payload_bind.length-1]^=1;
    artifact_bind.bytes[artifact_bind.length-1]^=1;admitted_reject("artifact_content_bind",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);artifact_bind.bytes[artifact_bind.length-1]^=1;
    artifact.bytes[0]^=1;admitted_reject("actual_artifact_capture",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);artifact.bytes[0]^=1;
    uint8_t *domain=find_bytes(payload,YNX_DEPLOYMENT_MANIFEST_DOMAIN_V2);uint8_t first=*domain;*domain='X';admitted_reject("exact_new_e11_domain",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);*domain=first;
    uint8_t old_count=payload.bytes[3];payload.bytes[3]=6;admitted_reject("old_six_field_is_not_e11",&request,output,YNX_ARTIFACT_PUBLIC_BINDING_V1,YNX_ARTIFACT_CLEANUP_NOT_REQUIRED_V1);payload.bytes[3]=old_count;
    uint8_t bad_a[2592],bad_b[64];memcpy(bad_a,pa.bytes,2592);memcpy(bad_b,pb.bytes,64);bad_a[0]^=1;bad_b[0]^=1;
    changed=request;changed.expected_pk_a=span(bad_a,sizeof(bad_a));admitted_reject("independent_expected_public_a",&changed,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    changed=request;changed.expected_pk_b=span(bad_b,sizeof(bad_b));admitted_reject("independent_expected_public_b",&changed,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    changed=request;changed.pk_a=span(bad_a,sizeof(bad_a));admitted_reject("borrowed_public_a",&changed,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    changed=request;changed.pk_b=span(bad_b,sizeof(bad_b));admitted_reject("borrowed_public_b",&changed,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    a.bytes[0]^=1;admitted_reject("ml_dsa_private_der",&request,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);a.bytes[0]^=1;
    b.bytes[b.length-1]^=1;admitted_reject("slh_complete_derived_root",&request,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);b.bytes[b.length-1]^=1;
    size_t n=successful("actual_dual_and_signature",&request,output,0,YNX_ARTIFACT_CLEANUP_UNKNOWN_V1);write_public(argv[2],"memberOriginal.bin",output,n);
    need(memcmp(a.bytes,saved_a,54)==0&&memcmp(b.bytes,saved_b,150)==0,"borrowed_private_modified");wipe(a.bytes,a.length);wipe(b.bytes,b.length);
    admitted_reject("no_retained_signer_after_borrow_wipe",&request,output,YNX_ARTIFACT_KEY_MATERIAL_V1,YNX_ARTIFACT_CLEANUP_LOGICAL_COMPLETE_V1);
    memcpy(a.bytes,saved_a,54);memcpy(b.bytes,saved_b,150);n=successful("admitted_dirty_scalars_reset",&request,output,777,999);write_public(argv[2],"memberOriginal-second.bin",output,n);
    Blob empty=read_blob(argv[1],"empty-payload.bin",1,16384),empty_bind=read_blob(argv[1],"empty-payload-bind.bin",152,152),empty_content=read_blob(argv[1],"empty-artifact-bind.bin",152,152);
    changed=request;changed.payload_original=span(empty.bytes,empty.length);changed.expected_payload_original=changed.payload_original;changed.actual_artifact=span(NULL,0);changed.expected_payload_bind=span(empty_bind.bytes,152);changed.expected_artifact_bind=span(empty_content.bytes,152);
    n=successful("zero_artifact_null_span",&changed,output,0,YNX_ARTIFACT_CLEANUP_UNKNOWN_V1);write_public(argv[2],"memberOriginal-empty.bin",output,n);
    need(cases==EXPECTED_CASES,"complete_c_controls_count");need(memcmp(a.bytes,saved_a,54)==0&&memcmp(b.bytes,saved_b,150)==0,"borrowed_private_modified_after_calls");
    wipe(a.bytes,a.length);wipe(b.bytes,b.length);wipe(saved_a,sizeof(saved_a));wipe(saved_b,sizeof(saved_b));wipe(output,CAP+GUARD);
    free(a.bytes);free(b.bytes);free(pa.bytes);free(pb.bytes);free(payload.bytes);free(artifact.bytes);free(payload_bind.bytes);free(artifact_bind.bytes);free(empty.bytes);free(empty_bind.bytes);free(empty_content.bytes);free(output);
    char result[256];int count=snprintf(result,sizeof(result),"{\"version\":\"YNX-DEPLOYMENT-V2-CABI-C-RESULT/v1\",\"cases\":%u,\"syntheticOnly\":true,\"logicalCleanupOnly\":true}\n",cases);need(count>0&&(size_t)count<sizeof(result),"public_result_bound");write_public(argv[2],"C-RESULT.json",result,(size_t)count);
    printf("YNX_DEPLOYMENT_MANIFEST_V2_C_BOUNDARY_PASS cases=%u physicalEraseClaimed=false\n",cases);return 0;
}
