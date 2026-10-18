#include "ynx_source_platform_qualified.h"
#include <openssl/evp.h>
#include <openssl/crypto.h>
#include <openssl/sha.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <limits.h>
static void put32(unsigned char *p,uint32_t x){for(int n=3;n>=0;n--){p[n]=(unsigned char)x;x>>=8;}}
static void put64(unsigned char *p,uint64_t x){for(int n=7;n>=0;n--){p[n]=(unsigned char)x;x>>=8;}}
static uint32_t get32(const unsigned char*p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];}
static veil_store_status initialization_header(const ynx_storage_expected*e,size_t plain,unsigned char out[688],size_t*size){
 const ynx_storage_initialization_aad_v1*a=e?e->initialization:NULL;
 if(!a||!size||e->container_class!=YNX_STORAGE_RECORD||e->kind!=7||!e->name.data||e->name.size!=64||
  plain<152||plain>65536||a->version!=1||a->size!=528||a->reserved||
  !a->generation||a->generation>UINT32_MAX||a->generation!=e->generation||
  a->base_version||a->next_version!=1||e->base_version!=a->base_version||e->next_version!=a->next_version||
  CRYPTO_memcmp(a->request_digest,e->request,32)||CRYPTO_memcmp(a->storage_nonce,e->storage_nonce,12)||
  get32(a->storage_nonce)!=(uint32_t)a->generation)return VEIL_STORE_MISMATCH;
 static const char hex[]="0123456789abcdef";
 for(unsigned i=0;i<32;i++)if(e->name.data[2*i]!=(unsigned char)hex[a->selector_digest[i]>>4]||e->name.data[2*i+1]!=(unsigned char)hex[a->selector_digest[i]&15])return VEIL_STORE_MISMATCH;
 memset(out,0,688);memcpy(out,"YNXREC1",7);out[9]=2;out[11]=1;*size=624;
 put32(out+12,624);put32(out+16,(uint32_t)plain);put32(out+20,(uint32_t)plain+16);put32(out+24,7);
 put32(out+32,a->version);put32(out+36,a->size);put64(out+40,a->generation);put64(out+48,a->base_version);put64(out+56,a->next_version);
 /* Fixed byte arrays are contiguous by the static private ABI assertions. */
 memcpy(out+64,a->approval_digest,480);memcpy(out+544,a->storage_nonce,12);memcpy(out+560,e->name.data,64);
 return VEIL_STORE_OK;
}
/* Private canonical serializer shared with same-resource pre-effect plan.
 * It returns authenticated-header bytes only; no key or authority output. */
veil_store_status ynx_storage_initialization_header_exact_v1(
 const ynx_storage_expected*e,size_t plain,unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;if(!e||e->kind!=7||!out||!written||cap<624)return VEIL_STORE_BOUND;
 unsigned char header_bytes[688];size_t n=0;veil_store_status s=initialization_header(e,plain,header_bytes,&n);
 if(s)return s;if(n!=624)return VEIL_STORE_MISMATCH;memcpy(out,header_bytes,n);*written=n;return VEIL_STORE_OK;
}
static veil_store_status header(const ynx_storage_expected *e,size_t plain,unsigned char out[688],size_t *size){
 if(e&&e->kind==7)return initialization_header(e,plain,out,size);
 if(e&&e->initialization)return VEIL_STORE_MISMATCH;
 if(!e||!size||(e->container_class!=YNX_STORAGE_RECORD&&e->container_class!=YNX_STORAGE_QUEUE)||plain>(e&&e->container_class==YNX_STORAGE_QUEUE?1048576u:65536u)||e->name.size>128||(e->name.size&&!e->name.data)||e->generation>UINT32_MAX||e->next_version<=e->base_version||e->kind<1||e->kind>6||(e->direction!=1&&e->direction!=2)||get32(e->storage_nonce)!=(uint32_t)e->generation)return VEIL_STORE_BOUND;
 memset(out,0,540);memcpy(out,e->container_class==YNX_STORAGE_QUEUE?"YNXQUE1":"YNXREC1",7);out[9]=1;out[11]=1;
 *size=YNX_STORAGE_FIXED+e->name.size;put32(out+12,(uint32_t)*size);put32(out+16,(uint32_t)plain);put32(out+20,(uint32_t)plain+16);
 put64(out+24,e->generation);put64(out+32,e->base_version);put64(out+40,e->next_version);
 put32(out+48,e->kind);put32(out+52,e->id);put32(out+56,e->extra_id);put32(out+60,e->device);put32(out+64,(uint32_t)e->name.size);put32(out+68,e->direction);
 for(size_t n=0;n<11;n++)put64(out+72+8*n,e->binding[n]);
 memcpy(out+160,e->source_abi,32);memcpy(out+192,e->root,32);memcpy(out+224,e->device_final,32);memcpy(out+256,e->session,32);memcpy(out+288,e->purpose,32);memcpy(out+320,e->request,32);memcpy(out+352,e->operation_nonce,32);memcpy(out+384,e->logical,16);memcpy(out+400,e->storage_nonce,12);
 if(e->name.size)memcpy(out+412,e->name.data,e->name.size);return VEIL_STORE_OK;
}
void ynx_storage_ciphertext_free(ynx_storage_ciphertext *p){if(p){free(p->bytes);memset(p,0,sizeof(*p));}}
veil_store_status ynx_storage_seal(const unsigned char key[32],const ynx_storage_expected *e,ynx_original_bytes plain,ynx_storage_ciphertext *out){
 if(!out||out->bytes||!key||(plain.size&&!plain.data))return VEIL_STORE_BOUND;
 unsigned char aad[688];size_t hn=0;veil_store_status st=header(e,plain.size,aad,&hn);if(st)return st;
 if(e->kind==7){unsigned char actual[32];if(!SHA256(plain.data,plain.size,actual)||CRYPTO_memcmp(actual,e->initialization->plaintext_digest,32))return VEIL_STORE_MISMATCH;}
 size_t total=hn+plain.size+16;unsigned char *b=malloc(total);if(!b)return VEIL_STORE_SQL;memcpy(b,aad,hn);
 EVP_CIPHER_CTX *ctx=EVP_CIPHER_CTX_new();int n=0,written=0,tail=0;
 int ok=ctx&&EVP_EncryptInit_ex(ctx,EVP_aes_256_gcm(),NULL,NULL,NULL)==1&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_IVLEN,12,NULL)==1&&EVP_EncryptInit_ex(ctx,NULL,NULL,key,e->storage_nonce)==1&&EVP_EncryptUpdate(ctx,NULL,&n,aad,(int)hn)==1;
 if(ok&&plain.size){ok=EVP_EncryptUpdate(ctx,b+hn,&written,plain.data,(int)plain.size)==1;}
 if(ok)ok=EVP_EncryptFinal_ex(ctx,b+hn+written,&tail)==1&&(size_t)(written+tail)==plain.size&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_GET_TAG,16,b+hn+plain.size)==1;
 EVP_CIPHER_CTX_free(ctx);if(!ok){OPENSSL_cleanse(b,total);free(b);return VEIL_STORE_UNKNOWN;}out->bytes=b;out->size=total;return VEIL_STORE_OK;
}
veil_store_status ynx_storage_open(const unsigned char key[32],const ynx_storage_expected *expected,ynx_original_bytes blob,unsigned char *sink,size_t cap,size_t *out_size){
 if(out_size)*out_size=0;if(!out_size||!key||!sink||cap>1048576)return VEIL_STORE_BOUND;if(!blob.data||blob.size<YNX_STORAGE_FIXED+16||blob.size>YNX_STORAGE_QUEUE_MAX){OPENSSL_cleanse(sink,cap);return VEIL_STORE_BOUND;}
 const unsigned char *b=blob.data;uint32_t plain=get32(b+16);unsigned char aad[688];size_t hn=0;veil_store_status st=header(expected,plain,aad,&hn);
 if(st||cap<plain||blob.size!=hn+(size_t)plain+16||CRYPTO_memcmp(b,aad,hn)){OPENSSL_cleanse(sink,cap);return st?st:VEIL_STORE_MISMATCH;}
 EVP_CIPHER_CTX *ctx=EVP_CIPHER_CTX_new();int n=0,written=0,tail=0;
 int ok=ctx&&EVP_DecryptInit_ex(ctx,EVP_aes_256_gcm(),NULL,NULL,NULL)==1&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_IVLEN,12,NULL)==1&&EVP_DecryptInit_ex(ctx,NULL,NULL,key,expected->storage_nonce)==1&&EVP_DecryptUpdate(ctx,NULL,&n,b,(int)hn)==1;
 if(ok&&plain)ok=EVP_DecryptUpdate(ctx,sink,&written,b+hn,(int)plain)==1;
 if(ok)ok=EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_TAG,16,(void*)(b+hn+plain))==1&&EVP_DecryptFinal_ex(ctx,sink+written,&tail)==1&&(size_t)(written+tail)==plain;
 EVP_CIPHER_CTX_free(ctx);if(ok&&expected->kind==7){unsigned char actual[32];ok=SHA256(sink,plain,actual)&&!CRYPTO_memcmp(actual,expected->initialization->plaintext_digest,32);}
 if(!ok){OPENSSL_cleanse(sink,cap);return VEIL_STORE_MISMATCH;}*out_size=plain;return VEIL_STORE_OK;
}
struct ynx_storage_attempt{enum ynx_execution_stage stage;const veil_native_intent_handle *original_intent;pthread_t thread;ynx_platform_storage_hold *resource;ynx_storage_ciphertext rows[33];size_t count,validated_count;struct ynx_storage_attempt *next;veil_checked_store *store;const veil_verified_native_operation_lease *lease;veil_native_lookup_result *lookup;int recovery_published;veil_native_pending_handle *pending;veil_checked_write_handle *write;veil_native_finish_result *finish;veil_native_cleanup_handle *cleanup;int attempted,unknown,active,validating,interrupted;veil_store_status primary;};
/* The registry protects only the actual original attempt/ciphertext lifetime.
 * A recognized row still needs the original protected resource AND genuine
 * guard/current/pin validation; membership is never a capability. */
static pthread_mutex_t attempt_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_storage_attempt *attempt_inventory;
static size_t attempt_slots;
static void attempt_register(ynx_storage_attempt *a){pthread_mutex_lock(&attempt_lock);a->next=attempt_inventory;attempt_inventory=a;pthread_mutex_unlock(&attempt_lock);}
static void attempt_remove(ynx_storage_attempt *a){pthread_mutex_lock(&attempt_lock);ynx_storage_attempt **p=&attempt_inventory;while(*p&&*p!=a)p=&(*p)->next;if(!*p)abort();*p=a->next;attempt_slots--;pthread_mutex_unlock(&attempt_lock);}
static veil_store_status attempt_fail(ynx_storage_attempt *a,veil_store_status s){
 if(!a->primary)a->primary=s;a->unknown=1;a->stage=YNX_EXEC_UNKNOWN;return VEIL_STORE_UNKNOWN;
}
/* Inventory recognizes custody only. Same-thread callbacks must not dispose,
 * recover or recursively validate an attempt while its original call runs. */
static veil_store_status attempt_enter(ynx_storage_attempt *a){
 pthread_mutex_lock(&attempt_lock);ynx_storage_attempt *p=attempt_inventory;
 while(p&&p!=a)p=p->next;
 veil_store_status s=!p?VEIL_STORE_REQUIRED:!pthread_equal(p->thread,pthread_self())?VEIL_STORE_THREAD:VEIL_STORE_OK;
 if(!s){if(p->active){p->interrupted=1;s=attempt_fail(p,VEIL_STORE_FROZEN);}else{p->active=1;p->interrupted=0;}}
 pthread_mutex_unlock(&attempt_lock);return s;
}
static veil_store_status attempt_leave(ynx_storage_attempt *a,veil_store_status s){
 a->active=0;return s?s:(a->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK);
}
static veil_store_status current(ynx_storage_attempt*a){
 if(!pthread_equal(a->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(a->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status s=ynx_platform_storage_current(a->resource);
 if(s)attempt_fail(a,s);
 /* A callback may swallow a refused nested close. It cannot restore current. */
 return a->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
/* Raw material is confined to these normal resource calls. The resource
 * provider must already own the genuine purpose/intent fence; these calls do
 * not manufacture it. Metadata carries no raw key into the commit loop. */
static veil_store_status storage_metadata(ynx_storage_attempt *a,ynx_storage_material *out){
 ynx_storage_material raw={0};veil_store_status s=current(a);
 if(!s)s=ynx_platform_storage_material(a->resource,&raw);
 if(!s&&(!raw.key||raw.key_size!=32))s=VEIL_STORE_BOUND;
 if(!s){*out=raw;out->key=NULL;out->key_size=0;}
 OPENSSL_cleanse(&raw,sizeof(raw));
 if(!s)s=current(a);return s;
}
static veil_store_status storage_seal_row(ynx_storage_attempt *a,const ynx_storage_material *metadata,size_t index,ynx_original_bytes plain,ynx_storage_ciphertext *out){
 ynx_storage_material raw={0};veil_store_status s=current(a);
 if(!s)s=ynx_platform_storage_material(a->resource,&raw);
 if(!s&&(!raw.key||raw.key_size!=32||raw.key_generation!=metadata->key_generation||raw.count!=metadata->count||raw.expected!=metadata->expected||raw.kinds!=metadata->kinds||raw.ids!=metadata->ids||index>=raw.count))s=VEIL_STORE_MISMATCH;
 if(!s)s=current(a);
 if(!s)s=ynx_storage_seal(raw.key,&raw.expected[index],plain,out);
 /* Adopt ciphertext before the late fence: failures never discard or reseal
  * original output. Clear only the borrowed pointer, never the owner key. */
 OPENSSL_cleanse(&raw,sizeof(raw));
 if(!s)s=current(a);return s;
}
veil_store_status ynx_qualified_snapshot_commit(ynx_platform_snapshot_hold*h,const veil_native_intent_handle*original_intent,const ynx_native_computed_step*steps,size_t count,uint32_t queue,ynx_original_bytes wire,ynx_storage_attempt **held,veil_native_verified_commit **out){
 if(!held||*held||!out||*out||!original_intent||count>32||(count&&!steps)||(queue!=1&&queue!=2)||wire.size>1048576||(wire.size&&!wire.data))return VEIL_STORE_BOUND;
 pthread_mutex_lock(&attempt_lock);if(attempt_slots>=32){pthread_mutex_unlock(&attempt_lock);return VEIL_STORE_BOUND;}attempt_slots++;pthread_mutex_unlock(&attempt_lock);
 ynx_storage_attempt*a=calloc(1,sizeof(*a));if(!a){pthread_mutex_lock(&attempt_lock);attempt_slots--;pthread_mutex_unlock(&attempt_lock);return VEIL_STORE_SQL;}a->thread=pthread_self();a->stage=YNX_EXEC_ACQUIRING;a->original_intent=original_intent;
 veil_store_status s=ynx_platform_snapshot_storage_acquire(h,steps,count,queue,wire,&a->resource);
 if(!a->resource){pthread_mutex_lock(&attempt_lock);attempt_slots--;pthread_mutex_unlock(&attempt_lock);free(a);return s?s:VEIL_STORE_UNKNOWN;}a->active=1;attempt_register(a);*held=a;if(s){attempt_fail(a,s);return attempt_leave(a,VEIL_STORE_UNKNOWN);}a->stage=YNX_EXEC_RESOURCE;
 ynx_native_snapshot_projection original={0};ynx_storage_material m={0};s=current(a);if(!s)s=ynx_platform_snapshot_projection(h,&original);if(!s&&(original.intent!=original_intent||original.queue!=queue||!original.lease))s=VEIL_STORE_MISMATCH;if(!s)s=storage_metadata(a,&m);
 if(!s&&(m.key||m.key_size||m.key_generation>UINT32_MAX||!m.expected||m.count!=count+1||!m.kinds||!m.ids))s=VEIL_STORE_BOUND;
 size_t quota=0;
 for(size_t n=0;!s&&n<count+1;n++){
  const ynx_storage_expected*e=&m.expected[n];
  if(memcmp(e->binding,original.binding,sizeof(e->binding))||memcmp(e->source_abi,original.source_abi,32)||e->direction!=queue||e->container_class!=(n<count?YNX_STORAGE_RECORD:YNX_STORAGE_QUEUE)||e->generation!=m.key_generation||e->name.size>128||(e->name.size&&!e->name.data)||!m.kinds[n]||!m.ids[n]||(n==count&&e->direction!=queue))s=VEIL_STORE_BOUND;
  if(!s&&n<count&&(e->kind!=steps[n].kind||e->id!=steps[n].id||e->extra_id!=steps[n].extra_id||e->device!=steps[n].device||e->name.size!=steps[n].name.size||(e->name.size&&(!steps[n].name.data||memcmp(e->name.data,steps[n].name.data,e->name.size)))))s=VEIL_STORE_MISMATCH;
  /* Key-global reservations must be distinct even for repeated same row. */
  for(size_t j=0;!s&&j<n;j++)if(!memcmp(e->storage_nonce,m.expected[j].storage_nonce,12))s=VEIL_STORE_DUPLICATE;
  if(!s){size_t payload=n<count?steps[n].body.size:wire.size;if(payload>(n<count?65536u:1048576u)||e->name.size>128||payload+e->name.size+YNX_STORAGE_FIXED+16>4194304u-quota)s=VEIL_STORE_BOUND;else quota+=payload+e->name.size+YNX_STORAGE_FIXED+16;}
  if(!s)s=storage_seal_row(a,&m,n,n<count?steps[n].body:wire,&a->rows[n]);
  if(a->rows[n].bytes){a->rows[n].kind=m.kinds[n];a->rows[n].id=m.ids[n];a->count++;}
 }
 if(!s)a->stage=YNX_EXEC_SEALED;
 const veil_verified_native_operation_lease*l=NULL;const veil_native_intent_handle*i=NULL;
 if(!s)s=current(a);if(!s)s=ynx_platform_storage_bind_ciphertext(a->resource,a->rows,a->count,&a->store,&l,&i);
 if(!s&&(!a->store||l!=original.lease||i!=a->original_intent))s=VEIL_STORE_UNKNOWN;
 if(!s){a->lease=l;a->stage=YNX_EXEC_BOUND;}
 /* Exactly this ciphertext is made durable; ambiguity never re-seals it.
  * Binding may invoke Native callbacks; reject any swallowed reentry BEFORE
  * the first durable intent or write, not after the effect. */
 if(!s)s=current(a);
 if(!s){a->attempted=1;s=veil_native_prepare_intent(a->store,l,i,&a->pending);}
 if(!s){a->stage=YNX_EXEC_INTENT_DURABLE;s=veil_native_pending_drop(&a->pending);}
 if(!s)s=current(a);if(!s)s=veil_native_begin_checked_write(a->store,l,i,&a->write);if(!s)a->stage=YNX_EXEC_WRITE_ENTERED;
 for(size_t n=0;!s&&n<a->count;n++)s=veil_private_apply_ciphertext(a->write,a->resource,n,&a->rows[n],n==count);
 if(!s&&a->validated_count!=a->count)s=VEIL_STORE_UNKNOWN;
 if(!s)s=current(a);if(!s)s=veil_native_finish_commit(&a->write,&a->finish);if(!s)a->stage=YNX_EXEC_LOCAL_COMMITTED;
 if(!s)s=current(a);if(!s)s=veil_native_finish_publish_once(a->finish,out);if(!s)a->stage=YNX_EXEC_TERMINAL_RETURNED;
 if(!s)s=current(a);if(s){attempt_fail(a,s);if(a->store)(void)veil_native_take_cleanup(a->store,&a->cleanup);return attempt_leave(a,VEIL_STORE_UNKNOWN);}return attempt_leave(a,VEIL_STORE_OK);
}
/* Normal checked SQL calls this before each write. Compare the retained
 * same-source ciphertext, then validate the real held guard/resource/pin under
 * the SAME fence. No table marker, pointer or local comparison grants a write. */
veil_store_status ynx_qualified_validate_ciphertext(ynx_platform_storage_hold *resource,veil_private_effect_guard *guard,veil_private_intent_pin *pin,size_t index,const ynx_storage_ciphertext *row){
 if(!resource)return VEIL_STORE_REQUIRED;
 pthread_mutex_lock(&attempt_lock);ynx_storage_attempt *a=attempt_inventory;while(a&&a->resource!=resource)a=a->next;
 veil_store_status s=!a?VEIL_STORE_REQUIRED:!pthread_equal(a->thread,pthread_self())?VEIL_STORE_THREAD:VEIL_STORE_OK;pthread_mutex_unlock(&attempt_lock);if(s)return s;
 if(a->unknown)return VEIL_STORE_UNKNOWN;
 if(!a->active||a->validating){a->interrupted=1;return attempt_fail(a,VEIL_STORE_FROZEN);}
 a->validating=1;
 if(!guard||!pin||!row||a->stage!=YNX_EXEC_WRITE_ENTERED||index!=a->validated_count||index>=a->count)s=VEIL_STORE_MISMATCH;
 if(!s){const ynx_storage_ciphertext *expected=&a->rows[index];if(!row->bytes||row->size!=expected->size||!row->kind||!row->id||strcmp(row->kind,expected->kind)||strcmp(row->id,expected->id)||CRYPTO_memcmp(row->bytes,expected->bytes,row->size))s=VEIL_STORE_MISMATCH;}
 if(!s)s=current(a);if(!s)s=veil_private_guard_validate(guard);
 if(!s)s=ynx_platform_storage_validate_ciphertext(resource,guard,pin,index,row);
 if(!s)s=current(a);
 a->validating=0;
 if(s)return attempt_fail(a,s);
 a->validated_count++;return VEIL_STORE_OK;
}
/* Observation uses the retained exact original ciphertext/intent. It never
 * calls prepare, seal, CAS or NV mutation, and never clears uncertainty. */
veil_store_status ynx_qualified_storage_lookup(ynx_storage_attempt *a,veil_native_verified_commit **out){
 if(!out||*out)return VEIL_STORE_BOUND;
 veil_store_status s=attempt_enter(a);if(s)return s;
 if(!a->attempted||!a->store||!a->lease||!a->original_intent)return attempt_leave(a,VEIL_STORE_REQUIRED);
 if(a->recovery_published)return attempt_leave(a,VEIL_STORE_UNKNOWN);
 /* Recovery may inspect an already UNKNOWN original, but no nested callback
  * may publish or dispose it. interrupted is per-call; unknown stays sticky. */
 s=ynx_platform_storage_current(a->resource);
 if(!s&&a->interrupted)s=VEIL_STORE_UNKNOWN;
 if(!s&&!a->lookup)s=veil_native_lookup_operation(a->store,a->lease,a->original_intent,&a->lookup);
 if(!s&&a->interrupted)s=VEIL_STORE_UNKNOWN;
 /* Any partial lookup already belongs to a, even if its status is UNKNOWN. */
 if(!s)s=veil_native_lookup_publish_once(a->lookup,out);
 if(*out)a->recovery_published=1;
 if(!s&&a->interrupted)s=VEIL_STORE_UNKNOWN;
 if(!s)s=ynx_platform_storage_current(a->resource);
 if(!s&&a->interrupted)s=VEIL_STORE_UNKNOWN;
 if(s){attempt_fail(a,s);if(!a->cleanup)(void)veil_native_take_cleanup(a->store,&a->cleanup);}
 return attempt_leave(a,(s||a->unknown)?VEIL_STORE_UNKNOWN:VEIL_STORE_OK);
}
veil_store_status ynx_qualified_storage_close(ynx_storage_attempt **p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;
 ynx_storage_attempt*a=*p;veil_store_status s=attempt_enter(a);if(s)return s;
 /* A successful child status is not disposal while its original pointer is
  * still present. Retain the parent and every remaining borrower in that case. */
#define YNX_DRAIN_CHILD(field,drop) do{if(!s&&a->field){s=drop(&a->field);if(!s&&a->field)s=VEIL_STORE_UNKNOWN;}}while(0)
 YNX_DRAIN_CHILD(cleanup,veil_native_cleanup_drop);
 YNX_DRAIN_CHILD(pending,veil_native_pending_drop);
 YNX_DRAIN_CHILD(write,veil_native_checked_write_drop);
 YNX_DRAIN_CHILD(finish,veil_native_finish_result_drop);
 YNX_DRAIN_CHILD(lookup,veil_native_lookup_result_drop);
#undef YNX_DRAIN_CHILD
 ynx_platform_storage_hold *original=a->resource;
 if(!s){s=ynx_platform_storage_close(&a->resource);if((s||a->resource)&&a->resource!=original)abort();}
 if(s||a->resource){s=s?s:VEIL_STORE_UNKNOWN;attempt_fail(a,s);return attempt_leave(a,s);}
 attempt_remove(a);for(size_t n=0;n<a->count;n++)ynx_storage_ciphertext_free(&a->rows[n]);
 memset(a,0,sizeof(*a));free(a);*p=NULL;
 /* Disposal only. Durable uncertainty/retirement is never cleared here. */
 return VEIL_STORE_OK;
}

/* Fixed private transport for the original independent execution domains.
 * Nothing here inhabits a qualified storage owner or accepts a public grant. */
#include "ynx_source_sealed_role_launcher.h"
#include <openssl/ssl.h>
#include <openssl/x509.h>
#include <poll.h>
#include <fcntl.h>
#include <stdio.h>
#include <errno.h>
#include <time.h>
#define YNX_EXEC_BODY_MAX (4194304u+84u)
#define YNX_EXEC_HEADER_MAX 16384u
struct ynx_private_execution_client {
 pthread_t thread;ynx_source_sealed_role_owner *sealed;SSL_CTX *ctx;SSL *tls;
 unsigned char *response;size_t response_size;int first,unknown,active;
};
static veil_store_status client_status(int st){
 if(st==YNX_TPM2_OK)return VEIL_STORE_OK;
 if(st==YNX_TPM2_REQUIRED)return VEIL_STORE_REQUIRED;
 return st==YNX_TPM2_UNKNOWN?VEIL_STORE_UNKNOWN:VEIL_STORE_MISMATCH;
}
static veil_store_status client_fail(ynx_private_execution_client *p,veil_store_status st){
 if(!p->first)p->first=st;p->unknown=1;return st;
}
static int client_thread(ynx_private_execution_client *p){return p&&pthread_equal(p->thread,pthread_self());}
veil_store_status ynx_private_execution_client_current(ynx_private_execution_client *p){
 if(!client_thread(p))return VEIL_STORE_THREAD;
 if(p->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status st=client_status(ynx_source_sealed_role_current(p->sealed));
 return st?client_fail(p,st):VEIL_STORE_OK;
}
veil_store_status ynx_private_execution_client_open(const ynx_message_sealed_raw_input *selected,ynx_original_bytes certificate,const unsigned char expected[32],ynx_private_execution_client **out){
 if(!out||*out||!selected||!certificate.data||!certificate.size||certificate.size>65536||!expected)return VEIL_STORE_BOUND;
 ynx_private_execution_client *p=calloc(1,sizeof(*p));if(!p)return VEIL_STORE_SQL;
 p->thread=pthread_self();*out=p; /* adopt before ANY resource acquisition */
 veil_store_status st=client_status(ynx_source_message_sealed_open_raw(selected,&p->sealed));
 if(st){if(!p->first)p->first=st;return st;}
 if(!p->sealed)return client_fail(p,VEIL_STORE_UNKNOWN);
 /* dedicated_protect has run before secret/TLS allocations. Fixed system CA,
  * no ENV-selected trust path, arbitrary root installer or SSL_VERIFY_NONE. */
 p->ctx=SSL_CTX_new(TLS_client_method());
 if(!p->ctx||SSL_CTX_set_min_proto_version(p->ctx,TLS1_3_VERSION)!=1||SSL_CTX_set_max_proto_version(p->ctx,TLS1_3_VERSION)!=1||SSL_CTX_load_verify_locations(p->ctx,"/etc/ssl/certs/ca-certificates.crt",NULL)!=1)return client_fail(p,VEIL_STORE_REQUIRED);
 SSL_CTX_set_verify(p->ctx,SSL_VERIFY_PEER,NULL);
 unsigned char digest[32];unsigned int n=0;
 if(EVP_Digest(certificate.data,certificate.size,digest,&n,EVP_sha256(),NULL)!=1||n!=32||CRYPTO_memcmp(digest,expected,32))return client_fail(p,VEIL_STORE_MISMATCH);
 const unsigned char *cursor=certificate.data;X509 *cert=d2i_X509(NULL,&cursor,(long)certificate.size);
 int ok=cert&&cursor==certificate.data+certificate.size&&SSL_CTX_use_certificate(p->ctx,cert)==1;
 X509_free(cert);if(!ok)return client_fail(p,VEIL_STORE_MISMATCH);
 st=client_status(ynx_source_sealed_client_context_key(p->sealed,p->ctx));
 if(st)return client_fail(p,st);
 return ynx_private_execution_client_current(p);
}
static veil_store_status client_window(ynx_private_execution_client *p,uint64_t deadline){
 uint64_t now=0;veil_store_status st=ynx_private_execution_client_current(p);if(st)return st;
 if(!deadline||ynx_source_sealed_role_monotonic_ns(&now)||now>=deadline)return client_fail(p,VEIL_STORE_LIFETIME);
 return VEIL_STORE_OK;
}
static veil_store_status client_wait(ynx_private_execution_client *p,int fd,int ssl_error,uint64_t deadline){
 if(ssl_error!=SSL_ERROR_WANT_READ&&ssl_error!=SSL_ERROR_WANT_WRITE)return client_fail(p,VEIL_STORE_UNKNOWN);
 for(;;){
  veil_store_status st=client_window(p,deadline);if(st)return st;
  uint64_t now=0;if(ynx_source_sealed_role_monotonic_ns(&now)||now>=deadline)return client_fail(p,VEIL_STORE_LIFETIME);
  uint64_t ms=(deadline-now)/1000000;int timeout=ms>50?50:(int)ms;
  /* Never round beyond the half-open budget. Even sub-ms time polls, then
   * rechecks actual monotonic time; no window is restarted by WANT_* or EINTR. */
  struct pollfd pollfd={fd,ssl_error==SSL_ERROR_WANT_READ?POLLIN:POLLOUT,0};
  int rc=poll(&pollfd,1,timeout);if(rc<0&&errno==EINTR)continue;
  if(rc<0||pollfd.revents&(POLLERR|POLLNVAL))return client_fail(p,VEIL_STORE_UNKNOWN);
  if(rc>0)return client_window(p,deadline);
 }
}
static veil_store_status client_write(ynx_private_execution_client *p,int fd,uint64_t deadline,const unsigned char *raw,size_t size){
 size_t at=0;while(at<size){veil_store_status st=client_window(p,deadline);if(st)return st;
  size_t n=0;int rc=SSL_write_ex(p->tls,raw+at,size-at,&n);
  if(rc==1){if(!n||n>size-at)return client_fail(p,VEIL_STORE_UNKNOWN);at+=n;continue;}
  st=client_wait(p,fd,SSL_get_error(p->tls,rc),deadline);if(st)return st;
 }return client_window(p,deadline);
}
/* Strict Content-Length only, no chunking/redirect/ambiguous duplicate header.
 * Header bytes are transport observations, not operation status or permission. */
static int response_header(const unsigned char *raw,size_t size,size_t *header,size_t *body){
 size_t end=0;for(size_t i=3;i<size&&i<YNX_EXEC_HEADER_MAX;i++)if(!memcmp(raw+i-3,"\r\n\r\n",4)){end=i+1;break;}
 if(!end)return size>=YNX_EXEC_HEADER_MAX?-1:0;
 if(end<19||memcmp(raw,"HTTP/1.1 200 ",13))return -1;
 size_t line=0;while(line+1<end&&memcmp(raw+line,"\r\n",2))line++;if(line+1>=end)return -1;line+=2;
 int found=0;size_t length=0;
 while(line+2<end){size_t next=line;while(next+1<end&&memcmp(raw+next,"\r\n",2))next++;
  if(next+1>=end||next==line||raw[line]==' '||raw[line]=='\t')return -1;
  size_t colon=line;while(colon<next&&raw[colon]!=':')colon++;if(colon==next)return -1;
  char key[64];size_t keyn=colon-line;if(!keyn||keyn>=sizeof(key))return -1;
  for(size_t n=0;n<keyn;n++){unsigned char c=raw[line+n];if(c>='A'&&c<='Z')c+=32;key[n]=(char)c;}key[keyn]=0;
  if(!strcmp(key,"transfer-encoding"))return -1;
  if(!strcmp(key,"content-length")){
   if(found++)return -1;size_t v=colon+1;while(v<next&&(raw[v]==' '||raw[v]=='\t'))v++;
   if(v==next||(raw[v]=='0'&&v+1<next))return -1;
   for(;v<next;v++){if(raw[v]<'0'||raw[v]>'9'||length>(YNX_EXEC_BODY_MAX-(raw[v]-'0'))/10)return -1;length=length*10+raw[v]-'0';}
  }
  line=next+2;
 }
 if(found!=1||length<84||length>YNX_EXEC_BODY_MAX)return -1;*header=end;*body=length;return 1;
}
static int original_host_path(const char *host,const char *path){
 if(!host||!path||!host[0]||path[0]!='/'||strlen(host)>253||strlen(path)>2048)return 0;
 for(const unsigned char *c=(const unsigned char*)host;*c;c++)if(!((*c>='a'&&*c<='z')||(*c>='0'&&*c<='9')||*c=='.'||*c=='-'))return 0;
 for(const unsigned char *c=(const unsigned char*)path;*c;c++)if(*c<=32||*c>=127||*c=='#')return 0;
 return 1;
}
veil_store_status ynx_private_execution_client_exchange(ynx_private_execution_client *p,int fd,const char *host,const char *path,const unsigned char spki[32],uint64_t deadline,ynx_original_bytes request,unsigned char *sink,size_t cap,size_t *written){
 if(written)*written=0;
 if(!client_thread(p))return VEIL_STORE_THREAD;
 if(!written||!sink||cap<84||cap>YNX_EXEC_BODY_MAX||fd<0||!spki||!original_host_path(host,path)||!request.data||request.size<80||request.size>4194304+80)return VEIL_STORE_BOUND;
 if(p->active||p->tls||p->response)return client_fail(p,VEIL_STORE_UNKNOWN);
 veil_store_status st=client_window(p,deadline);if(st)return st;
 int flags=fcntl(fd,F_GETFL);if(flags<0||!(flags&O_NONBLOCK))return VEIL_STORE_BOUND;
 p->active=1; /* before TLS/network: any ambiguity prohibits another exchange */
 p->tls=SSL_new(p->ctx);
 if(!p->tls||SSL_set_fd(p->tls,fd)!=1||SSL_set_tlsext_host_name(p->tls,host)!=1||SSL_set1_host(p->tls,host)!=1)return client_fail(p,VEIL_STORE_UNKNOWN);
 for(;;){st=client_window(p,deadline);if(st)return st;int rc=SSL_connect(p->tls);if(rc==1)break;st=client_wait(p,fd,SSL_get_error(p->tls,rc),deadline);if(st)return st;}
 X509 *peer=SSL_get1_peer_certificate(p->tls);unsigned char *der=NULL;int dern=peer?i2d_X509_PUBKEY(X509_get_X509_PUBKEY(peer),&der):0;
 unsigned char digest[32];unsigned int dn=0;int verified=peer&&SSL_get_verify_result(p->tls)==X509_V_OK&&SSL_version(p->tls)==TLS1_3_VERSION&&dern>0&&EVP_Digest(der,(size_t)dern,digest,&dn,EVP_sha256(),NULL)==1&&dn==32&&!CRYPTO_memcmp(digest,spki,32);
 OPENSSL_free(der);X509_free(peer);if(!verified)return client_fail(p,VEIL_STORE_MISMATCH);
 char header[2600];int hn=snprintf(header,sizeof(header),"POST %s HTTP/1.1\r\nHost: %s\r\nContent-Type: application/octet-stream\r\nContent-Length: %zu\r\nConnection: close\r\n\r\n",path,host,request.size);
 if(hn<0||(size_t)hn>=sizeof(header))return client_fail(p,VEIL_STORE_BOUND);
 st=client_write(p,fd,deadline,(unsigned char*)header,(size_t)hn);if(st)return st;
 st=client_write(p,fd,deadline,request.data,request.size);if(st)return st;
 p->response=malloc(YNX_EXEC_HEADER_MAX+YNX_EXEC_BODY_MAX);if(!p->response)return client_fail(p,VEIL_STORE_SQL);
 size_t headers=0,body=0;
 for(;;){
  /* Adopt partial body before ANY late-current/fixed-budget rejection. */
  if(headers&&p->response_size>=headers){size_t n=p->response_size-headers;if(n>body||n>cap)return client_fail(p,VEIL_STORE_BOUND);memcpy(sink,p->response+headers,n);*written=n;if(n==body)break;}
  st=client_window(p,deadline);if(st)return st;
  size_t limit=headers?headers+body:YNX_EXEC_HEADER_MAX;size_t n=0;
  if(p->response_size>=limit)return client_fail(p,VEIL_STORE_BOUND);
  int rc=SSL_read_ex(p->tls,p->response+p->response_size,limit-p->response_size,&n);
  if(rc==1){if(!n||n>limit-p->response_size)return client_fail(p,VEIL_STORE_UNKNOWN);p->response_size+=n;
   if(!headers){int parsed=response_header(p->response,p->response_size,&headers,&body);if(parsed<0)return client_fail(p,VEIL_STORE_BOUND);if(parsed&&body>cap)return client_fail(p,VEIL_STORE_BOUND);}continue;
  }
  st=client_wait(p,fd,SSL_get_error(p->tls,rc),deadline);if(st)return st;
 }
 st=client_window(p,deadline);if(st)return st;
 /* Raw response remains retained until the Rust caller adopts it and closes
  * this per-exchange transport. No implicit reuse/retry or business retirement. */
 return VEIL_STORE_OK;
}
veil_store_status ynx_private_execution_client_complete_response(ynx_private_execution_client *p){
 if(!client_thread(p))return VEIL_STORE_THREAD;
 veil_store_status st=ynx_private_execution_client_current(p);if(st)return st;
 if(!p->active||!p->tls||!p->response)return VEIL_STORE_MISMATCH;
 SSL_free(p->tls);p->tls=NULL;
 OPENSSL_cleanse(p->response,p->response_size);free(p->response);p->response=NULL;p->response_size=0;p->active=0;
 return VEIL_STORE_OK; /* only exchange cleanup, not once/floor/retirement */
}
veil_store_status ynx_private_execution_client_close(ynx_private_execution_client **owner){
 if(!owner)return VEIL_STORE_BOUND;if(!*owner)return VEIL_STORE_OK;
 ynx_private_execution_client *p=*owner;if(!client_thread(p))return VEIL_STORE_THREAD;
 SSL_free(p->tls);p->tls=NULL;SSL_CTX_free(p->ctx);p->ctx=NULL;
 int rc=ynx_source_sealed_role_close(&p->sealed);
 if(p->sealed)return client_fail(p,rc?client_status(rc):VEIL_STORE_UNKNOWN);
 if(p->response){OPENSSL_cleanse(p->response,p->response_size);free(p->response);}
 free(p);*owner=NULL;
 /* Disposed cleanup says nothing about unresolved operation classification. */
 return rc&&rc!=YNX_TPM2_UNKNOWN?client_status(rc):VEIL_STORE_OK;
}

#include "ynx_native_product_cipher.inc"
