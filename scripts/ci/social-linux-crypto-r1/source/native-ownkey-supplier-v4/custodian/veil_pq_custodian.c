#include "veil_pq_custodian.h"
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
/* EXACT original primitive body, renamed to avoid duplicate existing symbols.
 * No change to original source, algorithm, signature mode/context or RNG.
 * Struct access is confined to ORIGINAL C OWNER in this translation unit.
 */
#define veil_pq_key_generate own_selected_generate
#define veil_pq_key_destroy own_selected_destroy
#define veil_pq_public own_selected_public
#define veil_pq_sign own_selected_sign
#define veil_pq_verify own_selected_verify
#include "../veil_pq_auth.c"
#include "sign.h"
_Static_assert(MLD_CONFIG_PARAMETER_SET == 87, "selected MLDSA87");
_Static_assert(MLDSA_CRYPTO_SECRETKEYBYTES == VEIL_OWN_SECRET, "selected secret");
_Static_assert(MLDSA_CRYPTO_PUBLICKEYBYTES == VEIL_OWN_PUBLIC, "selected public");
static const uint8_t domain[]="YNX/SOCIAL/OWN-PQ-STORAGE/V1";
static const char alias_prefix[]="ynx.social.ownkey.v1.";
static const uint8_t magic[8]={'Y','N','X','P','Q','K','0','1'};
static pthread_mutex_t budget_gate=PTHREAD_MUTEX_INITIALIZER;
static unsigned occupied;
struct veil_pq_custodian { pthread_t thread; veil_pq_key *key; int sealed; };
static void b32(uint8_t *p,uint32_t n){p[0]=n>>24;p[1]=n>>16;p[2]=n>>8;p[3]=n;}
static uint32_t u32(const uint8_t *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static void b64(uint8_t *p,uint64_t n){for(unsigned i=0;i<8;i++)p[i]=(uint8_t)(n>>(56-8*i));}
static int binding_valid(const veil_own_binding *b){
 if(!b||!b->alias||!b->generation||!b->classic_public||b->classic_public[0]!=5||
    !b->owner_binding||!b->owner_binding_size||b->owner_binding_size>VEIL_OWN_BINDING_MAX)return 0;
 size_t prefix=sizeof(alias_prefix)-1;
 if(strncmp(b->alias,alias_prefix,prefix))return 0;
 for(size_t i=0;i<32;i++){char c=b->alias[prefix+i];if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return 0;}
 return b->alias[prefix+32]==0;
}
veil_own_result veil_own_aad(const veil_own_binding *b,const uint8_t pk[2592],uint8_t out[VEIL_OWN_AAD_MAX],size_t *written){
 if(written)*written=0;if(!out||!written||!pk||!binding_valid(b))return VEIL_OWN_INVALID;
 size_t n=0,alias_n=(sizeof(alias_prefix)-1)+32;
 memcpy(out,domain,sizeof(domain)-1);n+=sizeof(domain)-1;
 b32(out+n,1);n+=4;b32(out+n,87);n+=4;b64(out+n,b->generation);n+=8;
 b32(out+n,(uint32_t)alias_n);n+=4;memcpy(out+n,b->alias,alias_n);n+=alias_n;
 memcpy(out+n,b->classic_public,33);n+=33;memcpy(out+n,pk,2592);n+=2592;
 b32(out+n,(uint32_t)b->owner_binding_size);n+=4;memcpy(out+n,b->owner_binding,b->owner_binding_size);n+=b->owner_binding_size;
 if(n>VEIL_OWN_AAD_MAX){sodium_memzero(out,VEIL_OWN_AAD_MAX);return VEIL_OWN_INVALID;}*written=n;return VEIL_OWN_OK;
}
veil_own_result veil_own_record_encode(const veil_own_record *r,uint8_t *out,size_t cap,size_t *written){
 if(written)*written=0;if(!r||!out||!written||r->version!=1||!r->aad_size||r->aad_size>VEIL_OWN_AAD_MAX)return VEIL_OWN_INVALID;
 size_t n=16+r->aad_size+12+4912;if(cap<n)return VEIL_OWN_INVALID;
 memcpy(out,magic,8);b32(out+8,1);b32(out+12,r->aad_size);memcpy(out+16,r->aad,r->aad_size);
 memcpy(out+16+r->aad_size,r->nonce,12);memcpy(out+28+r->aad_size,r->ciphertext,4912);*written=n;return VEIL_OWN_OK;
}
veil_own_result veil_own_record_decode(const uint8_t *in,size_t n,veil_own_record *r){
 if(!r)return VEIL_OWN_INVALID;memset(r,0,sizeof(*r));
 if(!in||n<16||memcmp(in,magic,8)||u32(in+8)!=1)return VEIL_OWN_INVALID;
 uint32_t a=u32(in+12);if(!a||a>VEIL_OWN_AAD_MAX||n!=16+(size_t)a+12+4912)return VEIL_OWN_INVALID;
 r->version=1;r->aad_size=a;memcpy(r->aad,in+16,a);memcpy(r->nonce,in+16+a,12);memcpy(r->ciphertext,in+28+a,4912);return VEIL_OWN_OK;
}
static veil_pq_custodian *reserve(void){
 if(sodium_init()<0)return NULL;
 pthread_mutex_lock(&budget_gate);if(occupied==32){pthread_mutex_unlock(&budget_gate);return NULL;}occupied++;pthread_mutex_unlock(&budget_gate);
 veil_pq_custodian *c=calloc(1,sizeof(*c));if(!c){pthread_mutex_lock(&budget_gate);occupied--;pthread_mutex_unlock(&budget_gate);return NULL;}c->thread=pthread_self();return c;
}
static void dispose(veil_pq_custodian *c){if(!c)return;if(c->key&&c->key->secret)sodium_memzero(c->key->secret,VEIL_OWN_SECRET);own_selected_destroy(c->key);sodium_memzero(c,sizeof(*c));free(c);pthread_mutex_lock(&budget_gate);occupied--;pthread_mutex_unlock(&budget_gate);}
static int owner(const veil_pq_custodian *c){return c&&pthread_equal(c->thread,pthread_self());}
static veil_pq_key *blank(void){
 veil_pq_key *k=sodium_malloc(sizeof(*k));if(!k)return NULL;memset(k,0,sizeof(*k));k->algorithm=algorithm();
 if(!k->algorithm){own_selected_destroy(k);return NULL;}k->secret=sodium_malloc(VEIL_OWN_SECRET);
 if(!k->secret){own_selected_destroy(k);return NULL;}
 if(sodium_mlock(k->secret,VEIL_OWN_SECRET)!=0){own_selected_destroy(k);return NULL;}
 sodium_memzero(k->secret,VEIL_OWN_SECRET);return k;
}
veil_own_result veil_own_create_sealed(const veil_own_binding *b,const veil_own_protector *p,veil_pq_custodian **out,veil_own_record *r){
 if(!out||*out||!r||!p||!p->seal||!binding_valid(b))return VEIL_OWN_INVALID;memset(r,0,sizeof(*r));
 veil_pq_custodian *c=reserve();if(!c)return VEIL_OWN_MEMORY;c->key=own_selected_generate();
 if(!c->key){dispose(c);return VEIL_OWN_UNAVAILABLE;}*out=c;
 size_t a=0;veil_own_result v=veil_own_aad(b,c->key->public_key,r->aad,&a);
 if(v!=VEIL_OWN_OK){c->sealed=-1;sodium_memzero(r,sizeof(*r));return v;}
 r->version=1;r->aad_size=(uint32_t)a;size_t written=0;
 v=p->seal(p->context,r->aad,a,c->key->secret,VEIL_OWN_SECRET,r->nonce,r->ciphertext,&written);
 if(v!=VEIL_OWN_OK||written!=VEIL_OWN_CIPHER){c->sealed=-1;sodium_memzero(r,sizeof(*r));return v==VEIL_OWN_OK?VEIL_OWN_UNKNOWN:v;}
 c->sealed=1;return VEIL_OWN_OK; /* No disk-commit or trust claim. */
}
veil_own_result veil_own_reload(const veil_own_binding *b,const uint8_t expected[2592],const veil_own_record *r,const veil_own_protector *p,veil_pq_custodian **out){
 if(!out||*out||!r||!p||!p->unseal||!expected||!binding_valid(b)||r->version!=1||r->aad_size>VEIL_OWN_AAD_MAX)return VEIL_OWN_INVALID;
 uint8_t aad[VEIL_OWN_AAD_MAX];size_t a=0;veil_own_result v=veil_own_aad(b,expected,aad,&a);
 if(v!=VEIL_OWN_OK||a!=r->aad_size||sodium_memcmp(aad,r->aad,a)!=0){sodium_memzero(aad,sizeof(aad));return VEIL_OWN_INVALID;}sodium_memzero(aad,sizeof(aad));
 veil_pq_custodian *c=reserve();if(!c)return VEIL_OWN_MEMORY;c->key=blank();if(!c->key){dispose(c);return VEIL_OWN_MEMORY;}
 size_t written=0;v=p->unseal(p->context,r->aad,r->aad_size,r->nonce,r->ciphertext,c->key->secret,VEIL_OWN_SECRET,&written);
 if(v!=VEIL_OWN_OK||written!=VEIL_OWN_SECRET){dispose(c);return v==VEIL_OWN_OK?VEIL_OWN_UNKNOWN:v;}
 uint8_t derived[VEIL_OWN_PUBLIC];memset(derived,0,sizeof(derived));
 int valid=mld_sign_pk_from_sk(derived,c->key->secret,NULL)==0&&sodium_memcmp(derived,expected,VEIL_OWN_PUBLIC)==0;
 if(valid)memcpy(c->key->public_key,expected,VEIL_OWN_PUBLIC);sodium_memzero(derived,sizeof(derived));
 if(!valid){dispose(c);return VEIL_OWN_CONSISTENCY_FAILED;}c->sealed=1;*out=c;return VEIL_OWN_OK;
}
veil_own_result veil_own_public(const veil_pq_custodian *c,uint8_t out[2592]){
 if(!owner(c))return c?VEIL_OWN_WRONG_THREAD:VEIL_OWN_INVALID;if(c->sealed!=1)return VEIL_OWN_NO_RETRY;
 return own_selected_public(c->key,out,2592)?VEIL_OWN_OK:VEIL_OWN_INVALID;
}
veil_own_result veil_own_sign_public_proof(const veil_pq_custodian *c,const uint8_t *m,size_t n,uint8_t sig[4627],size_t *written){
 if(written)*written=0;if(!owner(c))return c?VEIL_OWN_WRONG_THREAD:VEIL_OWN_INVALID;if(c->sealed!=1)return VEIL_OWN_NO_RETRY;
 return own_selected_sign(c->key,m,n,sig,4627,written)?VEIL_OWN_OK:VEIL_OWN_INVALID;
}
veil_own_result veil_own_close(veil_pq_custodian **c){if(!c||!*c)return VEIL_OWN_INVALID;if(!owner(*c))return VEIL_OWN_WRONG_THREAD;dispose(*c);*c=NULL;return VEIL_OWN_OK;}
