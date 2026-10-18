#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE
#define _DARWIN_C_SOURCE
#include "ynx_tpm2_esys_owner.h"
#include "ynx_source_sealed_role_launcher.h"
#include <tss2_tcti_device.h>
#include <tss2_mu.h>
#include <time.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/mman.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <openssl/sha.h>
#include <openssl/hmac.h>

struct ynx_tpm2_owner {
    pthread_t thread;struct ynx_tpm2_owner *inventory_next;
    ESYS_CONTEXT *esys;
    TSS2_TCTI_CONTEXT *tcti;
    ESYS_TR object, salt, ak, nv, session, counter_session, signed_public[2];
    TPM2B_TIMEOUT *signed_timeout[2]; TPMT_TK_AUTH *signed_ticket[2];
    ynx_tpm2_resource_selection selected;
    TSS2_RC first;
    unsigned ready, cancelled, entered, attempted, uncertain, borrowed, wrapping_custody, unsealed, raw_secret_denied, secret_retired, secret_locked;
    uint8_t *secret;
    size_t secret_size, secret_capacity;
};
static void wipe(void *p, size_t n) { volatile unsigned char *v=p; while(n--) *v++=0; }
static pthread_mutex_t primitive_inventory_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_tpm2_owner *primitive_inventory;
/* Membership before dereference; recognition is lifetime safety, not grant. */
static int same_thread(const ynx_tpm2_owner *o) {
    int found=0;pthread_mutex_lock(&primitive_inventory_lock);
    for(ynx_tpm2_owner*p=primitive_inventory;p;p=p->inventory_next)if(p==o){found=pthread_equal(p->thread,pthread_self());break;}
    pthread_mutex_unlock(&primitive_inventory_lock);return found;
}
static int budget_current(const ynx_tpm2_owner *o) {
    struct timespec t;
    if(clock_gettime(CLOCK_MONOTONIC,&t) || t.tv_sec<0 ||
       (uint64_t)t.tv_sec>UINT64_MAX/1000000000)return 0;
    uint64_t now=(uint64_t)t.tv_sec*1000000000+(uint64_t)t.tv_nsec;
    return o->selected.monotonic_deadline_ns && now<o->selected.monotonic_deadline_ns;
}
static int fail(ynx_tpm2_owner *o,TSS2_RC rc,int unknown) {
    if(!o->first) o->first=rc ? rc:TSS2_ESYS_RC_BAD_VALUE;
    if(unknown) o->uncertain=1;
    return o->uncertain?YNX_TPM2_UNKNOWN:YNX_TPM2_REFUSED;
}
/* A private mapping owns complete pages; it cannot alias an ESAPI heap page. */
static void retire_secret(ynx_tpm2_owner *o) {
    o->secret_retired=1;o->secret_size=0; /* irreversible BEFORE destruction */
    if(o->secret)wipe(o->secret,o->secret_capacity);
}
static int secret_available(const ynx_tpm2_owner *o) {
    return o->secret && o->secret_locked && o->secret_size &&
        !o->secret_retired && !o->borrowed;
}
static int allocate_secret(ynx_tpm2_owner *o,size_t needed) {
    if(o->secret || o->secret_retired || !needed)return YNX_TPM2_REFUSED;
    long page=sysconf(_SC_PAGESIZE);
    if(page<=0 || (size_t)page>1048576 || needed>1048576)return YNX_TPM2_RESOURCE;
    size_t pages=(needed-1)/(size_t)page+1;
    if(pages>1048576/(size_t)page)return YNX_TPM2_RESOURCE;
    size_t capacity=pages*(size_t)page;
    void *map=mmap(NULL,capacity,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
    if(map==MAP_FAILED)return YNX_TPM2_RESOURCE;
    /* Keep mapping custody even if locking fails; no failed allocation is usable. */
    o->secret=map;o->secret_capacity=capacity;
    if(mlock(map,capacity)){retire_secret(o);return YNX_TPM2_RESOURCE;}
    o->secret_locked=1;return YNX_TPM2_OK;
}
static int dispose_secret(ynx_tpm2_owner *o) {
    retire_secret(o);
    if(!o->secret)return YNX_TPM2_OK;
    if(o->secret_locked){
        if(munlock(o->secret,o->secret_capacity))return YNX_TPM2_RESOURCE;
        o->secret_locked=0;
    }
    if(munmap(o->secret,o->secret_capacity))return YNX_TPM2_RESOURCE;
    o->secret=NULL;o->secret_capacity=0;return YNX_TPM2_OK;
}
static int name_equal(const TPM2B_NAME *a,const TPM2B_NAME *b) {
    return a && b && a->size && a->size<=sizeof(a->name) &&
        a->size==b->size && !memcmp(a->name,b->name,a->size);
}
static int digest_equal(const TPM2B_DIGEST *a,const TPM2B_DIGEST *b) {
    return a && b && a->size==32 && b->size==32 &&
        !memcmp(a->buffer,b->buffer,32);
}
static int load_handle(ynx_tpm2_owner *o,TPM2_HANDLE h,ESYS_TR *out) {
    TSS2_RC rc=Esys_TR_FromTPMPublic(o->esys,h,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,out);
    return rc ? fail(o,rc,0):YNX_TPM2_OK;
}
static int object_public(ynx_tpm2_owner *o,ESYS_TR h,const TPM2B_NAME *expected,
                         const TPM2B_DIGEST *policy,unsigned kind) {
    TPM2B_PUBLIC *p=NULL; TPM2B_NAME *n=NULL,*q=NULL;
    TSS2_RC rc=Esys_ReadPublic(o->esys,h,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&p,&n,&q);
    int valid=!rc && p && name_equal(n,expected) && p->publicArea.nameAlg==TPM2_ALG_SHA256;
    if(valid && policy) valid=digest_equal(&p->publicArea.authPolicy,policy) &&
        p->publicArea.type==TPM2_ALG_KEYEDHASH &&
        (p->publicArea.objectAttributes & TPMA_OBJECT_ADMINWITHPOLICY) &&
        !(p->publicArea.objectAttributes & TPMA_OBJECT_USERWITHAUTH);
    if(valid && kind==1) valid=(p->publicArea.objectAttributes & TPMA_OBJECT_DECRYPT) &&
        (p->publicArea.objectAttributes & TPMA_OBJECT_RESTRICTED);
    if(valid && kind==2) valid=(p->publicArea.objectAttributes & TPMA_OBJECT_SIGN_ENCRYPT) &&
        (p->publicArea.objectAttributes & TPMA_OBJECT_RESTRICTED) &&
        name_equal(q,&o->selected.ak_qualified_name);
    Esys_Free(p);Esys_Free(n);Esys_Free(q);
    return valid?YNX_TPM2_OK:fail(o,rc,0);
}
static int nv_public(ynx_tpm2_owner *o) {
    TPM2B_NV_PUBLIC *p=NULL; TPM2B_NAME *n=NULL;
    TSS2_RC rc=Esys_NV_ReadPublic(o->esys,o->nv,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&p,&n);
    int valid=!rc && p && name_equal(n,&o->selected.counter_name) &&
        p->nvPublic.nameAlg==TPM2_ALG_SHA256 && p->nvPublic.dataSize==8 &&
        ((p->nvPublic.attributes & TPMA_NV_TPM2_NT_MASK)>>TPMA_NV_TPM2_NT_SHIFT)==TPM2_NT_COUNTER &&
        (p->nvPublic.attributes & TPMA_NV_POLICYWRITE) &&
        !(p->nvPublic.attributes & (TPMA_NV_AUTHWRITE|TPMA_NV_OWNERWRITE|TPMA_NV_PPWRITE)) &&
        digest_equal(&p->nvPublic.authPolicy,&o->selected.counter_policy);
    Esys_Free(p);Esys_Free(n);
    return valid?YNX_TPM2_OK:fail(o,rc,0);
}
static int read_counter(ynx_tpm2_owner *o,uint64_t *out) {
    TPM2B_MAX_NV_BUFFER *b=NULL;
    /* Empty index auth only. Any enrolled policy requiring other authorization
     * refuses here; never substitute owner hierarchy authorization. */
    TSS2_RC rc=Esys_NV_Read(o->esys,o->nv,o->nv,ESYS_TR_PASSWORD,ESYS_TR_NONE,
                          ESYS_TR_NONE,8,0,&b);
    int valid=!rc && b && b->size==8;uint64_t v=0;
    if(valid) for(unsigned i=0;i<8;i++) v=(v<<8)|b->buffer[i];
    Esys_Free(b);if(!valid)return fail(o,rc,o->entered);
    if(!budget_current(o))return fail(o,0,o->entered);
    *out=v;return YNX_TPM2_OK;
}
static int check_selection(const ynx_tpm2_resource_selection *s) {
    if(!s || !s->device || (strcmp(s->device,"/dev/tpmrm0") && strcmp(s->device,"/dev/tpm0")))return 0;
    if(!s->monotonic_deadline_ns || !s->sealed_object || !s->salt_key || !s->attestation_key || !s->counter ||
        s->sealed_object==s->salt_key || s->sealed_object==s->attestation_key ||
        s->salt_key==s->attestation_key || s->object_policy.size!=32 ||
        s->counter_policy.size!=32 || s->pcr_digest.size!=32 ||
        !s->pcrs.count || s->pcrs.count>sizeof(s->pcrs.pcrSelections)/sizeof(s->pcrs.pcrSelections[0]))return 0;
    if(s->ak_qualified_name.size!=34 || s->ak_qualified_name.name[0]!=0 ||
       s->ak_qualified_name.name[1]!=TPM2_ALG_SHA256)return 0;
    const TPM2B_NAME *names[]={&s->object_name,&s->salt_name,&s->ak_name,&s->counter_name};
    for(unsigned i=0;i<4;i++) if(names[i]->size!=34 || names[i]->name[0]!=0 || names[i]->name[1]!=TPM2_ALG_SHA256)return 0;
    for(unsigned i=0;i<s->pcrs.count;i++) if(s->pcrs.pcrSelections[i].hash!=TPM2_ALG_SHA256 ||
        !s->pcrs.pcrSelections[i].sizeofSelect || s->pcrs.pcrSelections[i].sizeofSelect>sizeof(s->pcrs.pcrSelections[i].pcrSelect))return 0;
    return 1;
}
int ynx_tpm2_owner_open(const ynx_tpm2_resource_selection *s,ynx_tpm2_owner **out) {
    if(!out || *out || !check_selection(s))return YNX_TPM2_REQUIRED;
    ynx_tpm2_owner *o=calloc(1,sizeof(*o));if(!o)return YNX_TPM2_RESOURCE;
    o->thread=pthread_self();o->selected=*s;o->selected.device=NULL;
    o->object=o->salt=o->ak=o->nv=o->session=o->counter_session=ESYS_TR_NONE;
    o->signed_public[0]=o->signed_public[1]=ESYS_TR_NONE;
    pthread_mutex_lock(&primitive_inventory_lock);o->inventory_next=primitive_inventory;primitive_inventory=o;pthread_mutex_unlock(&primitive_inventory_lock);*out=o;
    if(!budget_current(o))return fail(o,0,0);
    size_t size=0;TSS2_RC rc=Tss2_Tcti_Device_Init(NULL,&size,s->device);
    if(rc)return fail(o,rc,0);
    if(!size || size>1048576)return fail(o,TSS2_ESYS_RC_BAD_SIZE,0);
    o->tcti=calloc(1,size);if(!o->tcti)return YNX_TPM2_RESOURCE;
    rc=Tss2_Tcti_Device_Init(o->tcti,&size,s->device);if(rc){free(o->tcti);o->tcti=NULL;return fail(o,rc,0);}
    rc=Esys_Initialize(&o->esys,o->tcti,NULL);if(rc)return fail(o,rc,0);
    if(load_handle(o,s->sealed_object,&o->object) || load_handle(o,s->salt_key,&o->salt) ||
       load_handle(o,s->attestation_key,&o->ak) || load_handle(o,s->counter,&o->nv))return YNX_TPM2_REFUSED;
    if(object_public(o,o->object,&s->object_name,&s->object_policy,0) ||
       object_public(o,o->salt,&s->salt_name,NULL,1) ||
       object_public(o,o->ak,&s->ak_name,NULL,2) || nv_public(o))return YNX_TPM2_REFUSED;
    uint64_t counter=0;if(read_counter(o,&counter) || counter!=s->expected_counter)return fail(o,0,0);
    o->ready=1;return YNX_TPM2_OK;
}
int ynx_tpm2_owner_current(ynx_tpm2_owner *o) {
    if(!same_thread(o) || !o->ready)return YNX_TPM2_REFUSED;
    if(o->uncertain)return YNX_TPM2_UNKNOWN;
    if(o->cancelled || !budget_current(o))return fail(o,0,o->entered);
    if(object_public(o,o->object,&o->selected.object_name,&o->selected.object_policy,0) ||
       object_public(o,o->salt,&o->selected.salt_name,NULL,1) ||
       object_public(o,o->ak,&o->selected.ak_name,NULL,2) || nv_public(o))return fail(o,0,o->entered);
    uint64_t counter=0;int r=read_counter(o,&counter);if(r)return r;
    uint64_t expected=o->selected.expected_counter;
    if(o->attempted){if(expected==UINT64_MAX)return fail(o,0,1);expected++;}
    return counter==expected?YNX_TPM2_OK:fail(o,0,o->entered);
}
/* Deny-only containment, not admission or a cross-process enforcing fence.
 * No operation clears it. Existing partial custody remains cleanup-able. */
int ynx_tpm2_owner_deny_raw_secret(ynx_tpm2_owner *o) {
    if(!same_thread(o))return YNX_TPM2_REFUSED;
    o->raw_secret_denied=1;
    return YNX_TPM2_OK;
}
static int owner_unseal_internal(ynx_tpm2_owner *o,int protected_use) {
    if(!same_thread(o) || (o->raw_secret_denied&&!protected_use))return YNX_TPM2_REFUSED;
    int r=ynx_tpm2_owner_current(o);if(r)return r;
    if(o->unsealed || o->borrowed || o->session!=ESYS_TR_NONE)return YNX_TPM2_REFUSED;
    TPMT_SYM_DEF sym={.algorithm=TPM2_ALG_AES,.keyBits={.aes=128},.mode={.aes=TPM2_ALG_CFB}};
    TSS2_RC rc=Esys_StartAuthSession(o->esys,o->salt,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,
        ESYS_TR_NONE,NULL,TPM2_SE_POLICY,&sym,TPM2_ALG_SHA256,&o->session);
    if(rc)return fail(o,rc,0);
    rc=Esys_TRSess_SetAttributes(o->esys,o->session,TPMA_SESSION_ENCRYPT|TPMA_SESSION_CONTINUESESSION,
        TPMA_SESSION_ENCRYPT|TPMA_SESSION_CONTINUESESSION);
    if(!rc)rc=Esys_PolicyPCR(o->esys,o->session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,
        &o->selected.pcr_digest,&o->selected.pcrs);
    TPM2B_DIGEST *d=NULL;
    if(!rc)rc=Esys_PolicyGetDigest(o->esys,o->session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&d);
    int valid=!rc && digest_equal(d,&o->selected.object_policy);Esys_Free(d);
    if(!valid)return fail(o,rc,0);
    r=ynx_tpm2_owner_current(o);if(r)return r;
    /* The ESAPI response allocation is locked immediately, then wiped regardless
     * of copy/lock/current outcome. ESAPI allocator itself is not a locked allocator. */
    TPM2B_SENSITIVE_DATA *data=NULL;o->unsealed=1;
    rc=Esys_Unseal(o->esys,o->object,o->session,ESYS_TR_NONE,ESYS_TR_NONE,&data);
    if(rc){if(data){wipe(data,sizeof(*data));Esys_Free(data);}return fail(o,rc,0);}
    if(!data)return fail(o,0,0);
    int locked=mlock(data,sizeof(*data))==0;
    if(!locked || !data->size || data->size>sizeof(data->buffer)){
        wipe(data,sizeof(*data));if(locked)munlock(data,sizeof(*data));Esys_Free(data);return fail(o,0,0);}
    r=allocate_secret(o,data->size);
    if(r){wipe(data,sizeof(*data));munlock(data,sizeof(*data));Esys_Free(data);return fail(o,0,0);}
    o->secret_size=data->size;memcpy(o->secret,data->buffer,data->size);
    wipe(data,sizeof(*data));munlock(data,sizeof(*data));Esys_Free(data);
    r=ynx_tpm2_owner_current(o);if(r){retire_secret(o);return r;}return YNX_TPM2_OK;
}
int ynx_tpm2_owner_unseal(ynx_tpm2_owner *o) {
 return owner_unseal_internal(o,0);
}
int ynx_tpm2_owner_secret_borrow(ynx_tpm2_owner *o,const uint8_t **p,size_t *n) {
    if(!p || !n || *p || *n)return YNX_TPM2_REFUSED;
    int r=ynx_tpm2_owner_current(o);if(r)return r;
    if(o->raw_secret_denied || !secret_available(o))return YNX_TPM2_REFUSED;
    o->borrowed=1;*p=o->secret;*n=o->secret_size;return YNX_TPM2_OK;
}
int ynx_tpm2_owner_secret_release(ynx_tpm2_owner *o) {
    if(!same_thread(o) || !o->borrowed)return YNX_TPM2_REFUSED;
    o->borrowed=0;return YNX_TPM2_OK;
}
int ynx_tpm2_owner_cancel(ynx_tpm2_owner *o) {
    if(!same_thread(o))return YNX_TPM2_REFUSED;
    o->cancelled=1;if(o->entered)o->uncertain=1;return o->uncertain?YNX_TPM2_UNKNOWN:YNX_TPM2_REFUSED;
}
static int reserve_mutation(ynx_tpm2_owner *o) {
    if(!same_thread(o) || !o->ready || o->cancelled || o->uncertain || o->attempted ||
       o->borrowed || !budget_current(o) || o->selected.expected_counter==UINT64_MAX)return YNX_TPM2_REFUSED;
    o->attempted=1;o->entered=1;o->uncertain=1;return YNX_TPM2_OK;
}
int ynx_tpm2_owner_increment_once(ynx_tpm2_owner *o) {
    int r=ynx_tpm2_owner_current(o);if(r)return r;
    if(o->attempted || o->borrowed || o->counter_session!=ESYS_TR_NONE ||
       o->selected.expected_counter==UINT64_MAX)return YNX_TPM2_REFUSED;
    /* Authorization consumes the original enrolled PCR policy, never a password
     * fallback. Retain a partial session until explicit close on every failure. */
    TPMT_SYM_DEF sym={.algorithm=TPM2_ALG_AES,.keyBits={.aes=128},.mode={.aes=TPM2_ALG_CFB}};
    TSS2_RC rc=Esys_StartAuthSession(o->esys,o->salt,ESYS_TR_NONE,ESYS_TR_NONE,
        ESYS_TR_NONE,ESYS_TR_NONE,NULL,TPM2_SE_POLICY,&sym,TPM2_ALG_SHA256,&o->counter_session);
    if(rc || o->counter_session==ESYS_TR_NONE)return fail(o,rc,0);
    rc=Esys_TRSess_SetAttributes(o->esys,o->counter_session,TPMA_SESSION_CONTINUESESSION,
        TPMA_SESSION_CONTINUESESSION);
    if(!rc)rc=Esys_PolicyPCR(o->esys,o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE,
        ESYS_TR_NONE,&o->selected.pcr_digest,&o->selected.pcrs);
    TPM2B_DIGEST *digest=NULL;
    if(!rc)rc=Esys_PolicyGetDigest(o->esys,o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE,
        ESYS_TR_NONE,&digest);
    int valid=!rc && digest_equal(digest,&o->selected.counter_policy);Esys_Free(digest);
    if(!valid)return fail(o,rc,0);
    r=ynx_tpm2_owner_current(o);if(r)return r;
    /* Latch before the first persistent TPM call. Successful return does not
     * establish independently verified retirement and never clears uncertainty. */
    r=reserve_mutation(o);if(r)return r;
    rc=Esys_NV_Increment(o->esys,o->nv,o->nv,o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE);
    if(rc)return fail(o,rc,1);
    return YNX_TPM2_UNKNOWN;
}
int ynx_tpm2_owner_certify(ynx_tpm2_owner *o,const TPM2B_DATA *nonce,
                          TPM2B_ATTEST **att,TPMT_SIGNATURE **sig) {
    if(!same_thread(o) || !o->ready || o->cancelled || !nonce || nonce->size!=32 ||
       !att || !sig || *att || *sig || !budget_current(o))return YNX_TPM2_REFUSED;
    if(object_public(o,o->ak,&o->selected.ak_name,NULL,2) || nv_public(o))return fail(o,0,o->entered);
    /* Observation of this retained instance remains available after entered
     * UNKNOWN; no re-entry or mutation, no independent signature verification. */
    TPMT_SIG_SCHEME scheme={.scheme=TPM2_ALG_NULL};
    TSS2_RC rc=Esys_NV_Certify(o->esys,o->ak,o->nv,o->nv,ESYS_TR_PASSWORD,
        ESYS_TR_PASSWORD,ESYS_TR_NONE,nonce,&scheme,8,0,att,sig);
    if(rc)return fail(o,rc,o->entered);
    if(!*att || !*sig)return fail(o,0,o->entered);
    TPMS_ATTEST decoded;size_t offset=0;
    rc=Tss2_MU_TPMS_ATTEST_Unmarshal((*att)->attestationData,(*att)->size,&offset,&decoded);
    if(rc || offset!=(*att)->size || decoded.magic!=TPM2_GENERATED_VALUE ||
       decoded.type!=TPM2_ST_ATTEST_NV ||
       !name_equal(&decoded.qualifiedSigner,&o->selected.ak_qualified_name) ||
       decoded.extraData.size!=nonce->size || memcmp(decoded.extraData.buffer,nonce->buffer,nonce->size) ||
       !name_equal(&decoded.attested.nv.indexName,&o->selected.counter_name) ||
       decoded.attested.nv.offset!=0 || decoded.attested.nv.nvContents.size!=8 ||
       !budget_current(o))return fail(o,rc,o->entered);
    uint64_t observed=0,expected=o->selected.expected_counter;
    for(unsigned i=0;i<8;i++)observed=(observed<<8)|decoded.attested.nv.nvContents.buffer[i];
    if(o->attempted){if(expected==UINT64_MAX)return fail(o,0,1);expected++;}
    if(observed!=expected)return fail(o,0,o->entered);
    /* Signature authenticity and independent rollback adjudication are still
     * mandatory in the qualified enrolled backend. Parsing is not approval. */
    return o->uncertain?YNX_TPM2_UNKNOWN:YNX_TPM2_OK;
}
int ynx_tpm2_owner_close(ynx_tpm2_owner **p) {
    if(!p || !same_thread(*p))return YNX_TPM2_REFUSED;
    ynx_tpm2_owner *o=*p;if(o->borrowed||o->wrapping_custody)return YNX_TPM2_REFUSED;
    if(dispose_secret(o)!=YNX_TPM2_OK)return YNX_TPM2_RESOURCE;
    if(o->session!=ESYS_TR_NONE){TSS2_RC rc=Esys_FlushContext(o->esys,o->session);
        if(rc)return fail(o,rc,o->entered);
        o->session=ESYS_TR_NONE;}
    if(o->counter_session!=ESYS_TR_NONE){TSS2_RC rc=Esys_FlushContext(o->esys,o->counter_session);
        if(rc)return fail(o,rc,o->entered);
        o->counter_session=ESYS_TR_NONE;}
    for(unsigned i=0;i<2;i++){
        Esys_Free(o->signed_timeout[i]);o->signed_timeout[i]=NULL;
        Esys_Free(o->signed_ticket[i]);o->signed_ticket[i]=NULL;
        if(o->signed_public[i]!=ESYS_TR_NONE){TSS2_RC rc=Esys_FlushContext(o->esys,o->signed_public[i]);
            if(rc)return fail(o,rc,o->entered);
            o->signed_public[i]=ESYS_TR_NONE;}
    }
    ESYS_TR *handles[]={&o->object,&o->salt,&o->ak,&o->nv};
    for(unsigned i=0;i<4;i++)if(*handles[i]!=ESYS_TR_NONE){TSS2_RC rc=Esys_TR_Close(o->esys,handles[i]);
        if(rc)return fail(o,rc,o->entered);}
    if(o->esys)Esys_Finalize(&o->esys);
    if(o->tcti){Tss2_Tcti_Finalize(o->tcti);free(o->tcti);o->tcti=NULL;}
    int result=o->uncertain?YNX_TPM2_UNKNOWN:YNX_TPM2_OK;
    pthread_mutex_lock(&primitive_inventory_lock);ynx_tpm2_owner**slot=&primitive_inventory;while(*slot&&*slot!=o)slot=&(*slot)->inventory_next;if(*slot!=o)abort();*slot=o->inventory_next;pthread_mutex_unlock(&primitive_inventory_lock);
    wipe(o,sizeof(*o));free(o);*p=NULL;return result;
}
TSS2_RC ynx_tpm2_owner_first_cause(const ynx_tpm2_owner *o) {
    return same_thread(o)?o->first:TSS2_ESYS_RC_BAD_REFERENCE;
}

/* Private storage lifetime retain only; never qualification or effect authority. */
int ynx_tpm2_wrapping_custody_retain(ynx_tpm2_owner *o){
 if(!same_thread(o)||o->wrapping_custody)return YNX_TPM2_REFUSED;
 int rc=ynx_tpm2_owner_current(o);if(rc)return rc;
 o->wrapping_custody=1;return YNX_TPM2_OK;
}
int ynx_tpm2_wrapping_custody_release(ynx_tpm2_owner *o){
 if(!same_thread(o)||!o->wrapping_custody)return YNX_TPM2_REFUSED;
 o->wrapping_custody=0;return YNX_TPM2_OK;
}

int ynx_tpm2_owner_quote(ynx_tpm2_owner *o,const TPM2B_DATA *nonce,TPM2B_ATTEST **att,TPMT_SIGNATURE **sig){
 if(!same_thread(o)||!o->ready||o->cancelled||o->borrowed||!nonce||nonce->size!=32||!att||!sig||*att||*sig||!budget_current(o))return YNX_TPM2_REFUSED;
 if(object_public(o,o->ak,&o->selected.ak_name,NULL,2))return fail(o,0,o->entered);
 TPMT_SIG_SCHEME scheme={.scheme=TPM2_ALG_NULL};
 TSS2_RC rc=Esys_Quote(o->esys,o->ak,ESYS_TR_PASSWORD,ESYS_TR_NONE,ESYS_TR_NONE,nonce,&scheme,&o->selected.pcrs,att,sig);
 if(rc||!*att||!*sig)return fail(o,rc,o->entered);
 TPMS_ATTEST decoded;size_t end=0;uint8_t selected[256],observed[256];size_t sn=0,on=0;
 rc=Tss2_MU_TPMS_ATTEST_Unmarshal((*att)->attestationData,(*att)->size,&end,&decoded);
 if(rc||end!=(*att)->size||decoded.magic!=TPM2_GENERATED_VALUE||decoded.type!=TPM2_ST_ATTEST_QUOTE||!name_equal(&decoded.qualifiedSigner,&o->selected.ak_qualified_name)||decoded.extraData.size!=32||memcmp(decoded.extraData.buffer,nonce->buffer,32)||!digest_equal(&decoded.attested.quote.pcrDigest,&o->selected.pcr_digest)||Tss2_MU_TPML_PCR_SELECTION_Marshal(&o->selected.pcrs,selected,sizeof(selected),&sn)||Tss2_MU_TPML_PCR_SELECTION_Marshal(&decoded.attested.quote.pcrSelect,observed,sizeof(observed),&on)||sn!=on||memcmp(selected,observed,sn)||!budget_current(o))return fail(o,rc,o->entered);
 /* The signature and protected enrollment remain separately unverified. */
 return o->uncertain?YNX_TPM2_UNKNOWN:YNX_TPM2_OK;
}

/* Command authorizers are actual retained TPM objects, not signature DTOs.
 * Recognition is inventory membership BEFORE dereference. These primitive
 * owners still do not inhabit approved administration/exclusive authority. */
struct ynx_tpm2_command_authorizer{
 pthread_t thread;struct ynx_tpm2_command_authorizer *next;
 ynx_tpm2_command_authorizer_selection selected;
 ESYS_CONTEXT *esys;TSS2_TCTI_CONTEXT *tcti;ESYS_TR key,session;
 TPMT_SIGNATURE *signature;TSS2_RC first;unsigned ready,attempted,unknown;
 ynx_tpm2_owner *command_auth;TPM2B_AUTH *auth;size_t auth_pages;unsigned auth_locked,auth_borrowed;
};
static pthread_mutex_t authorizer_inventory_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_tpm2_command_authorizer *authorizer_inventory;
static int recognize_authorizer(const ynx_tpm2_command_authorizer*p){
 int found=0;pthread_mutex_lock(&authorizer_inventory_lock);
 for(ynx_tpm2_command_authorizer*a=authorizer_inventory;a;a=a->next)if(a==p){found=pthread_equal(a->thread,pthread_self());break;}
 pthread_mutex_unlock(&authorizer_inventory_lock);return found;
}
static int authorizer_fail(ynx_tpm2_command_authorizer*a,TSS2_RC rc,int unknown){
 if(!a->first)a->first=rc?rc:TSS2_ESYS_RC_BAD_VALUE;
 if(unknown)a->unknown=1;
 return a->unknown?YNX_TPM2_UNKNOWN:YNX_TPM2_REFUSED;
}
static int remaining_seconds(uint64_t deadline,INT32*out){
 struct timespec now;if(!out||clock_gettime(CLOCK_MONOTONIC,&now)||now.tv_sec<0||(uint64_t)now.tv_sec>UINT64_MAX/1000000000)return 0;
 uint64_t t=(uint64_t)now.tv_sec*1000000000+(uint64_t)now.tv_nsec;
 if(t>=deadline)return 0;
 uint64_t seconds=(deadline-t)/1000000000;
 /* Never round UP, renew, emit zero/unlimited, or reusable negative tickets. */
 if(!seconds||seconds>INT32_MAX)return 0;
 *out=(INT32)seconds;
 return 1;
}
static int authorizer_public_current(ynx_tpm2_command_authorizer*a){
 TPM2B_PUBLIC*p=NULL;TPM2B_NAME*n=NULL,*q=NULL;
 TSS2_RC rc=Esys_ReadPublic(a->esys,a->key,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&p,&n,&q);
 uint8_t actual[4096],expected[4096];size_t an=0,en=0;
 int valid=!rc&&p&&name_equal(n,&a->selected.original_name)&&
  !Tss2_MU_TPM2B_PUBLIC_Marshal(p,actual,sizeof(actual),&an)&&
  !Tss2_MU_TPM2B_PUBLIC_Marshal(&a->selected.original_public,expected,sizeof(expected),&en)&&an==en&&!memcmp(actual,expected,an);
 Esys_Free(p);Esys_Free(n);Esys_Free(q);wipe(actual,sizeof(actual));wipe(expected,sizeof(expected));
 return valid?YNX_TPM2_OK:authorizer_fail(a,rc,a->attempted);
}
static int authorizer_selection_valid(const ynx_tpm2_command_authorizer_selection*s){
 if(!s||!s->device||(strcmp(s->device,"/dev/tpm0")&&strcmp(s->device,"/dev/tpmrm0"))||s->key<0x81000000u||s->key>0x81ffffffu||!s->monotonic_deadline_ns||s->original_name.size!=34||s->original_name.name[0]||s->original_name.name[1]!=TPM2_ALG_SHA256||s->signing_policy.size!=32||s->pcr_digest.size!=32||!s->pcrs.count||s->pcrs.count>sizeof(s->pcrs.pcrSelections)/sizeof(s->pcrs.pcrSelections[0])||s->registered_policy_ref.size>sizeof(s->registered_policy_ref.buffer))return 0;
 unsigned domain=0;for(size_t i=0;i<32;i++)domain|=s->administration_domain[i];if(!domain)return 0;
 for(unsigned i=0;i<s->pcrs.count;i++)if(s->pcrs.pcrSelections[i].hash!=TPM2_ALG_SHA256||!s->pcrs.pcrSelections[i].sizeofSelect||s->pcrs.pcrSelections[i].sizeofSelect>sizeof(s->pcrs.pcrSelections[i].pcrSelect))return 0;
 const TPMT_PUBLIC*p=&s->original_public.publicArea;
 TPMA_OBJECT attrs=TPMA_OBJECT_FIXEDTPM|TPMA_OBJECT_FIXEDPARENT|TPMA_OBJECT_SENSITIVEDATAORIGIN|TPMA_OBJECT_SIGN_ENCRYPT|TPMA_OBJECT_ADMINWITHPOLICY;
 if(p->nameAlg!=TPM2_ALG_SHA256||(p->objectAttributes&attrs)!=attrs||(p->objectAttributes&(TPMA_OBJECT_USERWITHAUTH|TPMA_OBJECT_DECRYPT|TPMA_OBJECT_RESTRICTED))||!digest_equal(&p->authPolicy,&s->signing_policy))return 0;
 if(p->type==TPM2_ALG_RSA)return p->parameters.rsaDetail.scheme.scheme==TPM2_ALG_RSASSA&&p->parameters.rsaDetail.scheme.details.rsassa.hashAlg==TPM2_ALG_SHA256&&p->parameters.rsaDetail.keyBits>=2048;
 if(p->type==TPM2_ALG_ECC)return p->parameters.eccDetail.scheme.scheme==TPM2_ALG_ECDSA&&p->parameters.eccDetail.scheme.details.ecdsa.hashAlg==TPM2_ALG_SHA256&&p->parameters.eccDetail.curveID==TPM2_ECC_NIST_P256;
 return 0;
}
int ynx_tpm2_command_authorizer_open(const ynx_tpm2_command_authorizer_selection*s,ynx_tpm2_owner*command_auth,ynx_tpm2_command_authorizer**out){
 if(!out||*out||!authorizer_selection_valid(s)||!same_thread(command_auth))return YNX_TPM2_REQUIRED;
 /* A distinct recognized original is still primitive custody, not admission. */
 if(command_auth->selected.monotonic_deadline_ns!=s->monotonic_deadline_ns||name_equal(&command_auth->selected.object_name,&s->original_name)||name_equal(&command_auth->selected.ak_name,&s->original_name)||name_equal(&command_auth->selected.salt_name,&s->original_name)||name_equal(&command_auth->selected.counter_name,&s->original_name))return YNX_TPM2_REFUSED;
 if(ynx_source_dedicated_protection_enter()!=YNX_TPM2_OK)return YNX_TPM2_REQUIRED;
 ynx_tpm2_command_authorizer*a=calloc(1,sizeof(*a));if(!a)return YNX_TPM2_RESOURCE;
 a->thread=pthread_self();a->selected=*s;a->selected.device=NULL;a->key=a->session=ESYS_TR_NONE;a->command_auth=command_auth;
 pthread_mutex_lock(&authorizer_inventory_lock);a->next=authorizer_inventory;authorizer_inventory=a;pthread_mutex_unlock(&authorizer_inventory_lock);*out=a;
 INT32 seconds;if(!remaining_seconds(s->monotonic_deadline_ns,&seconds))return authorizer_fail(a,0,0);
 const uint8_t*secret=NULL;size_t secret_size=0;int custody=ynx_tpm2_owner_current(command_auth);if(custody)return authorizer_fail(a,ynx_tpm2_owner_first_cause(command_auth),custody==YNX_TPM2_UNKNOWN);
 custody=ynx_tpm2_owner_secret_borrow(command_auth,&secret,&secret_size);if(custody)return authorizer_fail(a,ynx_tpm2_owner_first_cause(command_auth),1);a->auth_borrowed=1;
 if(!secret||!secret_size||secret_size>sizeof(((TPM2B_AUTH*)0)->buffer))return authorizer_fail(a,0,1);
 long page=sysconf(_SC_PAGESIZE);if(page<(long)sizeof(TPM2B_AUTH))return authorizer_fail(a,0,1);a->auth_pages=(size_t)page;
 a->auth=mmap(NULL,a->auth_pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);if(a->auth==MAP_FAILED){a->auth=NULL;return authorizer_fail(a,0,1);}
 if(mlock(a->auth,a->auth_pages))return authorizer_fail(a,0,1);
 a->auth_locked=1;
 a->auth->size=(UINT16)secret_size;memcpy(a->auth->buffer,secret,secret_size);
 custody=ynx_tpm2_owner_current(command_auth);if(custody)return authorizer_fail(a,ynx_tpm2_owner_first_cause(command_auth),1);
 size_t size=0;TSS2_RC rc=Tss2_Tcti_Device_Init(NULL,&size,s->device);if(rc||!size||size>1048576)return authorizer_fail(a,rc,0);
 a->tcti=calloc(1,size);if(!a->tcti)return YNX_TPM2_RESOURCE;
 rc=Tss2_Tcti_Device_Init(a->tcti,&size,s->device);if(rc){free(a->tcti);a->tcti=NULL;return authorizer_fail(a,rc,0);}
 rc=Esys_Initialize(&a->esys,a->tcti,NULL);if(rc)return authorizer_fail(a,rc,0);
 rc=Esys_TR_FromTPMPublic(a->esys,s->key,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&a->key);if(rc)return authorizer_fail(a,rc,0);
 if(authorizer_public_current(a))return authorizer_fail(a,0,0);
 rc=Esys_TR_SetAuth(a->esys,a->key,a->auth);if(rc)return authorizer_fail(a,rc,1);
 a->ready=1;return ynx_tpm2_command_authorizer_current(a);
}
int ynx_tpm2_command_authorizer_current(ynx_tpm2_command_authorizer*a){
 if(!recognize_authorizer(a))return YNX_TPM2_REFUSED;
 if(a->unknown)return YNX_TPM2_UNKNOWN;
 if(!a->ready)return YNX_TPM2_REFUSED;
 INT32 seconds;if(!remaining_seconds(a->selected.monotonic_deadline_ns,&seconds))return authorizer_fail(a,0,a->attempted);
 if(!a->command_auth||!a->auth||!a->auth_locked||!a->auth_borrowed||!a->auth->size)return authorizer_fail(a,0,1);
 int r=ynx_tpm2_owner_current(a->command_auth);if(r)return authorizer_fail(a,ynx_tpm2_owner_first_cause(a->command_auth),1);
 r=authorizer_public_current(a);if(r)return r;
 r=ynx_tpm2_owner_current(a->command_auth);if(r)return authorizer_fail(a,ynx_tpm2_owner_first_cause(a->command_auth),1);
 return remaining_seconds(a->selected.monotonic_deadline_ns,&seconds)?YNX_TPM2_OK:authorizer_fail(a,0,a->attempted);
}
static int authorizer_sign_command(ynx_tpm2_command_authorizer*a,const TPM2B_DIGEST*digest,const TPMT_SIGNATURE**out){
 if(!out||*out||!digest||digest->size!=32)return YNX_TPM2_REFUSED;
 int r=ynx_tpm2_command_authorizer_current(a);if(r)return r;
 if(a->attempted||a->session!=ESYS_TR_NONE||a->signature)return YNX_TPM2_REFUSED;
 TPMT_SYM_DEF sym={.algorithm=TPM2_ALG_NULL};TSS2_RC rc=Esys_StartAuthSession(a->esys,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,NULL,TPM2_SE_POLICY,&sym,TPM2_ALG_SHA256,&a->session);
 if(rc||a->session==ESYS_TR_NONE)return authorizer_fail(a,rc,0);
 /* This original session remains owned until explicit cleanup, including a
  * partial Sign failure. Do not rely on loader defaults/automatic disposal. */
 rc=Esys_TRSess_SetAttributes(a->esys,a->session,TPMA_SESSION_CONTINUESESSION,TPMA_SESSION_CONTINUESESSION);
 if(rc)return authorizer_fail(a,rc,0);
 rc=Esys_PolicyPCR(a->esys,a->session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&a->selected.pcr_digest,&a->selected.pcrs);
 /* Policy-only private use gate, never ESYS_TR_PASSWORD. PCR-only old keys
  * cannot match this complete registered policy and remain refused. */
 if(!rc)rc=Esys_PolicyAuthValue(a->esys,a->session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE);
 TPM2B_DIGEST*policy=NULL;if(!rc)rc=Esys_PolicyGetDigest(a->esys,a->session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&policy);
 int valid=!rc&&digest_equal(policy,&a->selected.signing_policy);Esys_Free(policy);if(!valid)return authorizer_fail(a,rc,0);
 r=ynx_tpm2_command_authorizer_current(a);if(r)return r;
 TPMT_SIG_SCHEME scheme={.scheme=TPM2_ALG_NULL};TPMT_TK_HASHCHECK ticket={.tag=TPM2_ST_HASHCHECK,.hierarchy=TPM2_RH_NULL,.digest={.size=0}};
 a->attempted=1;rc=Esys_Sign(a->esys,a->key,a->session,ESYS_TR_NONE,ESYS_TR_NONE,digest,&scheme,&ticket,&a->signature);
 /* A partial real signature stays in this ORIGINAL owner, even on failure. */
 if(rc||!a->signature)return authorizer_fail(a,rc,1);
 r=ynx_tpm2_command_authorizer_current(a);if(r)return authorizer_fail(a,0,1);*out=a->signature;return YNX_TPM2_OK;
}
static int command_cp_hash(ynx_tpm2_owner*o,TPM2B_DIGEST*out){
 TPM2B_NAME*actual=NULL;TSS2_RC rc=Esys_TR_GetName(o->esys,o->nv,&actual);
 if(rc||!name_equal(actual,&o->selected.counter_name)){Esys_Free(actual);return fail(o,rc,0);}
 uint8_t raw[4+2*sizeof(actual->name)];size_t n=0;
 rc=Tss2_MU_TPM2_CC_Marshal(TPM2_CC_NV_Increment,raw,sizeof(raw),&n);
 if(!rc){memcpy(raw+n,actual->name,actual->size);n+=actual->size;memcpy(raw+n,actual->name,actual->size);n+=actual->size;}
 Esys_Free(actual);out->size=32;int valid=!rc&&SHA256(raw,n,out->buffer);wipe(raw,sizeof(raw));return valid?YNX_TPM2_OK:fail(o,rc,0);
}
static int policy_signed_one(ynx_tpm2_owner*o,ynx_tpm2_command_authorizer*a,unsigned index,const TPM2B_DIGEST*cp){
 int r=ynx_tpm2_command_authorizer_current(a);if(r)return r;
 if(a->selected.monotonic_deadline_ns!=o->selected.monotonic_deadline_ns)return fail(o,0,0);
 TSS2_RC rc=Esys_LoadExternal(o->esys,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,NULL,&a->selected.original_public,TPM2_RH_NULL,&o->signed_public[index]);
 if(rc||o->signed_public[index]==ESYS_TR_NONE)return fail(o,rc,0);
 TPM2B_NAME*name=NULL;rc=Esys_TR_GetName(o->esys,o->signed_public[index],&name);
 int valid=!rc&&name_equal(name,&a->selected.original_name);Esys_Free(name);if(!valid)return fail(o,rc,0);
 /* Nonce is read after EACH policy command, never reused from the first role. */
 TPM2B_NONCE*nonce=NULL;rc=Esys_TRSess_GetNonceTPM(o->esys,o->counter_session,&nonce);
 INT32 expiration=0;if(rc||!nonce||!nonce->size||nonce->size>sizeof(nonce->buffer)||!remaining_seconds(o->selected.monotonic_deadline_ns,&expiration)){Esys_Free(nonce);return fail(o,rc,0);}
 uint8_t preimage[sizeof(nonce->buffer)+4+32+sizeof(a->selected.registered_policy_ref.buffer)];size_t n=0;
 memcpy(preimage,nonce->buffer,nonce->size);n=nonce->size;rc=Tss2_MU_INT32_Marshal(expiration,preimage,sizeof(preimage),&n);
 if(!rc){memcpy(preimage+n,cp->buffer,cp->size);n+=cp->size;memcpy(preimage+n,a->selected.registered_policy_ref.buffer,a->selected.registered_policy_ref.size);n+=a->selected.registered_policy_ref.size;}
 TPM2B_DIGEST digest={.size=32};valid=!rc&&SHA256(preimage,n,digest.buffer);wipe(preimage,sizeof(preimage));
 const TPMT_SIGNATURE*signature=NULL;if(!valid){Esys_Free(nonce);return fail(o,rc,0);}
 r=authorizer_sign_command(a,&digest,&signature);wipe(&digest,sizeof(digest));if(r){Esys_Free(nonce);return r;}
 /* Signing may cross a whole-second budget boundary. Never keep an earlier
  * expiration that now exceeds the remaining original budget, nor re-sign
  * with a fresh/renewed expiry to make this same attempt pass. */
 INT32 remaining=0;
 if(!remaining_seconds(o->selected.monotonic_deadline_ns,&remaining)||expiration>remaining){Esys_Free(nonce);return authorizer_fail(a,0,1);}
 rc=Esys_PolicySigned(o->esys,o->signed_public[index],o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,nonce,cp,&a->selected.registered_policy_ref,expiration,signature,&o->signed_timeout[index],&o->signed_ticket[index]);
 Esys_Free(nonce);if(rc)return fail(o,rc,0);return ynx_tpm2_command_authorizer_current(a);
}
int ynx_tpm2_owner_increment_signed_once(ynx_tpm2_owner*o,ynx_tpm2_command_authorizer*a,ynx_tpm2_command_authorizer*b){
 int r=ynx_tpm2_owner_current(o);if(r)return r;
 if(!recognize_authorizer(a)||!recognize_authorizer(b)||a==b||!memcmp(a->selected.administration_domain,b->selected.administration_domain,32)||name_equal(&a->selected.original_name,&b->selected.original_name)||o->attempted||o->borrowed||o->counter_session!=ESYS_TR_NONE||o->selected.expected_counter==UINT64_MAX)return fail(o,0,0);
 const TPM2B_NAME*forbidden[]={&o->selected.object_name,&o->selected.salt_name,&o->selected.ak_name};
 for(unsigned i=0;i<3;i++)if(name_equal(&a->selected.original_name,forbidden[i])||name_equal(&b->selected.original_name,forbidden[i]))return fail(o,0,0);
 TPMT_SYM_DEF sym={.algorithm=TPM2_ALG_AES,.keyBits={.aes=128},.mode={.aes=TPM2_ALG_CFB}};
 TSS2_RC rc=Esys_StartAuthSession(o->esys,o->salt,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,NULL,TPM2_SE_POLICY,&sym,TPM2_ALG_SHA256,&o->counter_session);
 if(rc||o->counter_session==ESYS_TR_NONE)return fail(o,rc,0);
 rc=Esys_TRSess_SetAttributes(o->esys,o->counter_session,TPMA_SESSION_CONTINUESESSION,TPMA_SESSION_CONTINUESESSION);
 if(!rc)rc=Esys_PolicyPCR(o->esys,o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&o->selected.pcr_digest,&o->selected.pcrs);
 if(rc)return fail(o,rc,0);
 TPM2B_DIGEST cp={0};r=command_cp_hash(o,&cp);if(r)return r;
 r=policy_signed_one(o,a,0,&cp);
 if(!r)r=policy_signed_one(o,b,1,&cp);
 wipe(&cp,sizeof(cp));
 /* A command-signing custody uncertainty belongs to this same counter
  * attempt as well. Do not expose ordinary refusal on a later invocation. */
 if(r)return r==YNX_TPM2_UNKNOWN?fail(o,0,1):r;
 TPM2B_DIGEST*policy=NULL;rc=Esys_PolicyGetDigest(o->esys,o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,&policy);
 int valid=!rc&&digest_equal(policy,&o->selected.counter_policy);Esys_Free(policy);if(!valid)return fail(o,rc,0);
 r=ynx_tpm2_command_authorizer_current(a);if(!r)r=ynx_tpm2_command_authorizer_current(b);
 if(r)return r==YNX_TPM2_UNKNOWN?fail(o,0,1):r;
 r=ynx_tpm2_owner_current(o);if(r)return r;
 r=reserve_mutation(o);if(r)return r;rc=Esys_NV_Increment(o->esys,o->nv,o->nv,o->counter_session,ESYS_TR_NONE,ESYS_TR_NONE);
 if(rc)return fail(o,rc,1);
 return YNX_TPM2_UNKNOWN;
}
int ynx_tpm2_command_authorizer_close(ynx_tpm2_command_authorizer**out){
 if(!out||!recognize_authorizer(*out))return YNX_TPM2_REFUSED;
 ynx_tpm2_command_authorizer*a=*out;
 Esys_Free(a->signature);a->signature=NULL;
 if(a->session!=ESYS_TR_NONE){TSS2_RC rc=Esys_FlushContext(a->esys,a->session);if(rc)return authorizer_fail(a,rc,a->attempted);a->session=ESYS_TR_NONE;}
 if(a->key!=ESYS_TR_NONE){TSS2_RC rc=Esys_TR_Close(a->esys,&a->key);if(rc)return authorizer_fail(a,rc,a->attempted);}
 if(a->esys)Esys_Finalize(&a->esys);
 if(a->tcti){Tss2_Tcti_Finalize(a->tcti);free(a->tcti);a->tcti=NULL;}
 /* Retire before wipe: failed unlock/unmap never permits an all-zero borrow.
  * ESAPI/context references are gone BEFORE the original auth page is wiped. */
 a->ready=0;
 if(a->auth){wipe(a->auth,a->auth_pages);if(a->auth_locked){if(munlock(a->auth,a->auth_pages))return authorizer_fail(a,0,1);a->auth_locked=0;}if(munmap(a->auth,a->auth_pages))return authorizer_fail(a,0,1);a->auth=NULL;}
 if(a->auth_borrowed){int r=ynx_tpm2_owner_secret_release(a->command_auth);if(r)return authorizer_fail(a,ynx_tpm2_owner_first_cause(a->command_auth),1);a->auth_borrowed=0;}a->command_auth=NULL;
 pthread_mutex_lock(&authorizer_inventory_lock);ynx_tpm2_command_authorizer**p=&authorizer_inventory;while(*p&&*p!=a)p=&(*p)->next;if(*p!=a)abort();*p=a->next;pthread_mutex_unlock(&authorizer_inventory_lock);
 int status=a->unknown?YNX_TPM2_UNKNOWN:YNX_TPM2_OK;wipe(a,sizeof(*a));free(a);*out=NULL;return status;
}

/* Do not clear uncertain/attempted. Only the qualified joint owner can decide
 * what this same original observation means for its frozen intent. */
int ynx_tpm2_owner_increment_observed_current(ynx_tpm2_owner*o,
 const unsigned char challenge[32],TPM2B_ATTEST**att,TPMT_SIGNATURE**sig){
 if(!same_thread(o)||!o->ready||!o->attempted||!o->entered||o->cancelled||
  o->first||!challenge||!att||!sig||!budget_current(o))return YNX_TPM2_REFUSED;
 if(!*att&&!*sig){
  TPM2B_DATA nonce={.size=32};memcpy(nonce.buffer,challenge,32);
  int z=ynx_tpm2_owner_certify(o,&nonce,att,sig);
  if(z!=YNX_TPM2_UNKNOWN&&z!=YNX_TPM2_OK)return z;
 }
 if(!*att||!*sig||o->first||(*att)->size>sizeof((*att)->attestationData))
  return fail(o,0,1);
 TPMS_ATTEST decoded={0};size_t offset=0;
 TSS2_RC rc=Tss2_MU_TPMS_ATTEST_Unmarshal((*att)->attestationData,(*att)->size,&offset,&decoded);
 if(rc||offset!=(*att)->size||decoded.magic!=TPM2_GENERATED_VALUE||
  decoded.type!=TPM2_ST_ATTEST_NV||!name_equal(&decoded.qualifiedSigner,&o->selected.ak_qualified_name)||
  decoded.extraData.size!=32||memcmp(decoded.extraData.buffer,challenge,32)||
  !name_equal(&decoded.attested.nv.indexName,&o->selected.counter_name)||
  decoded.attested.nv.offset||decoded.attested.nv.nvContents.size!=8||
  o->selected.expected_counter==UINT64_MAX)return fail(o,rc,1);
 uint64_t proof=0,actual=0;for(unsigned i=0;i<8;i++)proof=(proof<<8)|decoded.attested.nv.nvContents.buffer[i];
 if(proof!=o->selected.expected_counter+1)return fail(o,0,1);
 if(object_public(o,o->ak,&o->selected.ak_name,NULL,2)||nv_public(o))return fail(o,0,1);
 TPM2B_DIGEST digest={.size=32};
 if(!SHA256((*att)->attestationData,(*att)->size,digest.buffer))return fail(o,0,1);
 TPMT_TK_VERIFIED*ticket=NULL;
 rc=Esys_VerifySignature(o->esys,o->ak,ESYS_TR_NONE,ESYS_TR_NONE,ESYS_TR_NONE,
  &digest,*sig,&ticket);
 int valid=!rc&&ticket&&ticket->tag==TPM2_ST_VERIFIED;
 Esys_Free(ticket);wipe(&digest,sizeof(digest));
 if(!valid)return fail(o,rc,1);
 int z=read_counter(o,&actual);if(z||actual!=proof||!budget_current(o))return fail(o,0,1);
 return YNX_TPM2_OK; /* verified observation only; o->uncertain stays set */
}

#include "ynx_server_completed_current_private.inc"

#include "ynx_source_platform_qualified.h"
/* The storage owner executes AES-GCM internally; no raw-key borrowed pointer is
 * returned. raw_secret_denied remains irreversible, including after success.
 * Controlled driver must first durably reserve/adjudicate the actual nonce. */
int ynx_tpm2_owner_storage_seal(ynx_tpm2_owner*o,const unsigned char identity[32],
 const struct ynx_storage_expected*expected,const unsigned char*plain,size_t n,
 struct ynx_storage_ciphertext*out){
 if(!same_thread(o)||!o->raw_secret_denied||!identity||!expected||!plain||!n||
  !out||out->bytes||out->size||o->borrowed||o->wrapping_custody)return YNX_TPM2_REFUSED;
 int z=ynx_tpm2_owner_current(o);if(z)return z;
 if(!o->unsealed){z=owner_unseal_internal(o,1);if(z)return z;}
 if(!secret_available(o)||o->secret_size!=32)return YNX_TPM2_REFUSED;
 unsigned char actual[32];if(!SHA256(o->secret,o->secret_size,actual))return fail(o,0,0);
 int same=!memcmp(actual,identity,32);wipe(actual,sizeof(actual));
 if(!same)return fail(o,0,0);
 /* Prevent nested signing/unseal/borrow while the original key is in use. */
 o->borrowed=1;
 veil_store_status s=ynx_storage_seal(o->secret,expected,(ynx_original_bytes){plain,n},out);
 o->borrowed=0;
 if(s)return fail(o,0,1);
 z=ynx_tpm2_owner_current(o);
 if(z)return z; /* exact partial ciphertext stays in caller custody */
 return YNX_TPM2_OK;
}

/* A data-index domain, NOT a signing/authorization domain. Keyed selectors
 * avoid publishing offline hashes of predictable local record IDs. Retained
 * original key never leaves this recognized storage owner. */
int ynx_tpm2_owner_product_selector_v1(ynx_tpm2_owner*o,const unsigned char identity[32],
 const unsigned char store[32],uint64_t generation,uint32_t namespace_id,
 const unsigned char*id,size_t id_size,unsigned char out[32]){
 if(!same_thread(o)||!o->raw_secret_denied||!identity||!store||!generation||
  (namespace_id!=1&&namespace_id!=2)||!id||!id_size||id_size>1024||!out||o->borrowed||o->wrapping_custody)return YNX_TPM2_REFUSED;
 int z=ynx_tpm2_owner_current(o);if(z)return z;
 if(!o->unsealed){z=owner_unseal_internal(o,1);if(z)return z;}
 if(!secret_available(o)||o->secret_size!=32)return YNX_TPM2_REFUSED;
 unsigned char identity_digest[32];if(!SHA256(o->secret,32,identity_digest))return fail(o,0,0);
 int same=!memcmp(identity_digest,identity,32);wipe(identity_digest,sizeof(identity_digest));
 if(!same)return fail(o,0,0);
 static const unsigned char domain[]="YNX/PRODUCT/STORE-SELECTOR/V1";
 unsigned char message[sizeof(domain)+32+8+4+4+1024],digest[32];size_t n=0;
 memcpy(message,domain,sizeof(domain));n+=sizeof(domain);memcpy(message+n,store,32);n+=32;
 for(unsigned i=0;i<8;i++)message[n+7-i]=(unsigned char)(generation>>(8*i));
 n+=8;
 for(unsigned i=0;i<4;i++)message[n+3-i]=(unsigned char)(namespace_id>>(8*i));
 n+=4;
 for(unsigned i=0;i<4;i++)message[n+3-i]=(unsigned char)(id_size>>(8*i));
 n+=4;
 memcpy(message+n,id,id_size);n+=id_size;
 o->borrowed=1;unsigned got=0;int ok=HMAC(EVP_sha256(),o->secret,32,message,n,digest,&got)!=NULL&&got==32;o->borrowed=0;
 wipe(message,sizeof(message));
 if(!ok){wipe(digest,sizeof(digest));return fail(o,0,1);}
 z=ynx_tpm2_owner_current(o);if(!z)memcpy(out,digest,32);
 wipe(digest,sizeof(digest));return z;
}

#include "ynx_native_product_cipher_private.h"
int ynx_tpm2_owner_product_seal_v1(ynx_tpm2_owner*o,const unsigned char identity[32],
 const ynx_product_cipher_expected_v1*expected,const unsigned char*plain,size_t size,ynx_storage_ciphertext*out){
 if(!same_thread(o)||!o->raw_secret_denied||!identity||!expected||!plain||!size||!out||out->bytes||out->size||o->borrowed||o->wrapping_custody)return YNX_TPM2_REFUSED;
 int z=ynx_tpm2_owner_current(o);if(z)return z;if(!o->unsealed){z=owner_unseal_internal(o,1);if(z)return z;}
 if(!secret_available(o)||o->secret_size!=32)return YNX_TPM2_REFUSED;
 unsigned char actual[32];if(!SHA256(o->secret,32,actual))return fail(o,0,0);int same=!memcmp(actual,identity,32);wipe(actual,sizeof(actual));if(!same)return fail(o,0,0);
 o->borrowed=1;veil_store_status s=ynx_product_cipher_seal_v1(o->secret,expected,(ynx_original_bytes){plain,size},out);o->borrowed=0;
 if(s)return fail(o,0,1);
 return ynx_tpm2_owner_current(o); /* partial ciphertext stays owned on late error */
}

/* Private product read only. Caller is the same recognized registered-store
 * transaction; historical AAD is data, never a new policy/grant. Secret stays
 * in this actual original owner. Any late failure wipes the entire sink. */
int ynx_tpm2_owner_product_open_v1(ynx_tpm2_owner*o,const unsigned char identity[32],
 const ynx_product_cipher_expected_v1*expected,const unsigned char*blob,size_t size,
 unsigned char*sink,size_t capacity,size_t*written){
 if(!sink||!capacity||capacity>YNX_PRODUCT_ROW_PLAIN_MAX||!written)return YNX_TPM2_REFUSED;
 *written=0;int z=YNX_TPM2_REFUSED;
 if(!same_thread(o)||!o->raw_secret_denied||!identity||!expected||!blob||!size||o->borrowed||o->wrapping_custody)goto reject;
 z=ynx_tpm2_owner_current(o);if(z)goto reject;
 if(!o->unsealed){z=owner_unseal_internal(o,1);if(z)goto reject;}
 if(!secret_available(o)||o->secret_size!=32){z=YNX_TPM2_REFUSED;goto reject;}
 unsigned char actual[32];if(!SHA256(o->secret,32,actual)){z=fail(o,0,0);goto reject;}
 int same=!memcmp(actual,identity,32);wipe(actual,sizeof(actual));if(!same){z=fail(o,0,0);goto reject;}
 size_t n=0;o->borrowed=1;
 veil_store_status s=ynx_product_cipher_open_v1(o->secret,expected,(ynx_original_bytes){blob,size},sink,capacity,&n);
 o->borrowed=0;if(s){z=fail(o,0,1);goto reject;}
 z=ynx_tpm2_owner_current(o);if(z)goto reject;
 *written=n;return YNX_TPM2_OK;
reject:wipe(sink,capacity);return z;
}


