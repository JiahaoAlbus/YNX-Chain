#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE 1
#endif
/* Keep the normal selected SQLite namespace active before transitive headers. */
#define sqlite3_open_v2 veil_sqlite3500400_sqlite3_open_v2
#define sqlite3_close veil_sqlite3500400_sqlite3_close
#define sqlite3_exec veil_sqlite3500400_sqlite3_exec
#define sqlite3_get_autocommit veil_sqlite3500400_sqlite3_get_autocommit
#include "ynx_source_original_resource_owner.h"
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <openssl/crypto.h>
#include <openssl/sha.h>
#include "ynx_source_independent_reservation.h"
#include "../android/ynx_native_core_binding.h"
typedef struct core_domain_driver core_domain_driver;
struct ynx_original_executor {
 pthread_t thread;ynx_administration_owner *administration;
 ynx_administration_execution_loan *loan;
 unsigned char *original;size_t original_size;unsigned char digest[32];
 uint64_t deadline;ynx_executor_phase phase;
 veil_store_status first;int unknown,entered;
 struct ynx_original_executor *next;
};
static pthread_mutex_t executor_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_original_executor *executors;
static ynx_original_executor *recognized(ynx_original_executor*p){pthread_mutex_lock(&executor_lock);ynx_original_executor*q=executors;while(q&&q!=p)q=q->next;pthread_mutex_unlock(&executor_lock);return q;}
static veil_store_status uncertain(ynx_original_executor*p,veil_store_status s){if(!p->first)p->first=s;if(p->entered||s!=VEIL_STORE_REQUIRED)p->unknown=1;return p->unknown?VEIL_STORE_UNKNOWN:s;}
static int budget(ynx_original_executor*p){struct timespec t;if(clock_gettime(CLOCK_MONOTONIC,&t)||t.tv_sec<0)return 0;uint64_t n=(uint64_t)t.tv_sec*1000000000u+(uint64_t)t.tv_nsec;return n<p->deadline;}
veil_store_status ynx_original_executor_current(ynx_original_executor*p){
 ynx_original_executor*q=recognized(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;if(q->unknown)return VEIL_STORE_UNKNOWN;
 if(!budget(q))return uncertain(q,VEIL_STORE_LIFETIME);
 veil_store_status s=ynx_administration_execution_current(q->loan);return s?uncertain(q,s):VEIL_STORE_OK;
}
veil_store_status ynx_original_executor_acquire(ynx_administration_owner*a,ynx_original_bytes raw,uint64_t deadline,ynx_original_executor**out){
 if(!out||*out||!raw.data||!raw.size||raw.size>4194384||!deadline)return VEIL_STORE_BOUND;
 veil_store_status s=ynx_administration_current(a);if(s)return s;
 ynx_original_executor*q=calloc(1,sizeof(*q));if(!q)return VEIL_STORE_SQL;q->original=malloc(raw.size);if(!q->original){free(q);return VEIL_STORE_SQL;}
 memcpy(q->original,raw.data,raw.size);q->original_size=raw.size;q->administration=a;q->deadline=deadline;q->thread=pthread_self();
 if(!SHA256(q->original,q->original_size,q->digest)){OPENSSL_cleanse(q->original,q->original_size);free(q->original);free(q);return VEIL_STORE_UNKNOWN;}
 pthread_mutex_lock(&executor_lock);q->next=executors;executors=q;*out=q;pthread_mutex_unlock(&executor_lock);
 /* Adopt partial before domain reservations. Existing durable pending state
  * belongs to this intent even if late acquisition/current reports refusal. */
 s=ynx_administration_execution_acquire(a,(ynx_original_bytes){q->original,q->original_size},deadline,&q->loan);
 if(s)return uncertain(q,s);
 q->phase=YNX_EXEC_RESERVED;
 return ynx_original_executor_current(q);
}
veil_store_status ynx_original_executor_advance(ynx_original_executor*p,ynx_executor_phase phase,ynx_original_bytes evidence){
 ynx_original_executor*q=recognized(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 veil_store_status s=ynx_original_executor_current(q);if(s)return s;
 if(phase<YNX_EXEC_ENTERED||phase>YNX_EXEC_TERMINAL||phase!=q->phase+1)return VEIL_STORE_MISMATCH;
 /* This latch precedes invocation. A late nonOK never permits repeating a
  * burn/seal/CAS/terminal operation from this same executor. */
 q->entered=1;s=ynx_administration_execution_advance(q->loan,(uint32_t)phase,evidence);
 if(s)return uncertain(q,s);
 q->phase=phase;
 return ynx_original_executor_current(q);
}
veil_store_status ynx_original_executor_original(ynx_original_executor*p,ynx_original_bytes*out,ynx_executor_phase*phase){
 if(!out||!phase)return VEIL_STORE_BOUND;
 *out=(ynx_original_bytes){0};
 *phase=0;
 ynx_original_executor*q=recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 *out=(ynx_original_bytes){q->original,q->original_size};*phase=q->phase;return VEIL_STORE_OK;/* recovery facts, not a capability */
}
veil_store_status ynx_original_executor_observe(ynx_original_executor*p,ynx_executor_phase*phase){
 if(!phase)return VEIL_STORE_BOUND;
 *phase=0;
 ynx_original_executor*q=recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 uint32_t original=0;veil_store_status s=ynx_administration_execution_observe(q->loan,&original);
 /* Adopt a bounded original phase BEFORE reporting its late refusal. It is
  * observation only, never updates the runnable phase or clears UNKNOWN. */
 if(original){if(original<q->phase||original>YNX_EXEC_TERMINAL)return uncertain(q,VEIL_STORE_MISMATCH);*phase=(ynx_executor_phase)original;}
 if(s)return uncertain(q,s);
 if(!original)return uncertain(q,VEIL_STORE_MISMATCH);
 return q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_original_executor_close(ynx_original_executor**p){
 if(!p)return VEIL_STORE_BOUND;
 if(!*p)return VEIL_STORE_OK;
 ynx_original_executor*q=recognized(*p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->loan){ynx_administration_execution_loan*original=q->loan;veil_store_status s=ynx_administration_execution_close(&q->loan);if(q->loan&&q->loan!=original)abort();if(s&&!q->loan&&s!=VEIL_STORE_UNKNOWN)abort();if(s)uncertain(q,s);if(q->loan)return uncertain(q,s?s:VEIL_STORE_UNKNOWN);}
 pthread_mutex_lock(&executor_lock);ynx_original_executor**link=&executors;while(*link&&*link!=q)link=&(*link)->next;if(*link!=q){pthread_mutex_unlock(&executor_lock);abort();}*link=q->next;pthread_mutex_unlock(&executor_lock);
 int unresolved=q->unknown;OPENSSL_cleanse(q->original,q->original_size);free(q->original);OPENSSL_cleanse(q,sizeof(*q));free(q);*p=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}

#include "ynx_tpm2_esys_owner.h"
#include "../../c/src/veil_store_custody.h"
#include <sys/stat.h>
#include <unistd.h>
extern int32_t ynx_sdk_native_core_policy_current_v1(void *);
extern int32_t ynx_sdk_native_core_resource_retain_v1(void *);
extern int32_t ynx_sdk_native_core_deadline_borrow_v1(void *,uint64_t *);
extern int32_t ynx_sdk_native_core_resource_release_v1(void *);
extern int32_t ynx_sdk_native_core_association_matches_v1(void *,const unsigned char *,size_t);
extern int32_t ynx_sdk_native_core_rights_current_v2(void *);
extern int32_t ynx_sdk_native_core_gate_v2(void *,uint32_t);
extern int32_t ynx_sdk_native_core_resource_retain_v2(void *);
extern int32_t ynx_sdk_native_core_resource_release_v2(void *);
extern int32_t ynx_sdk_native_core_deadline_borrow_v2(void *,uint64_t *);
extern int32_t ynx_sdk_native_core_association_matches_v2(void *,const unsigned char *,size_t);
/* NativeCore participant ORIGINAL custody, obtained only from the retained
 * authenticated M0 operation loan. It never substitutes for the missing real
 * registered joint enforcing resource owner. The normal resource caller owns
 * this object even when later resource selection refuses. */
extern int32_t ynx_sdk_native_core_participant_originals_v2(void *,ynx_native_core_participant_originals_v2 *);
struct ynx_native_core_participant{
 pthread_t thread;void*policy;ynx_native_core_participant_originals_v2 originals;
 unsigned char*storage;size_t size;unsigned enforcing_borrows;int borrowed,unknown;veil_store_status first;
 struct ynx_native_core_participant*next;
};
static pthread_mutex_t participant_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_native_core_participant*participants;static size_t participant_count;
static ynx_native_core_participant*participant_recognized(ynx_native_core_participant*p){pthread_mutex_lock(&participant_lock);ynx_native_core_participant*q=participants;while(q&&q!=p)q=q->next;pthread_mutex_unlock(&participant_lock);return q;}
static veil_store_status participant_fail(ynx_native_core_participant*p,veil_store_status s){if(!p->first)p->first=s;if(s!=VEIL_STORE_REQUIRED)p->unknown=1;return p->unknown?VEIL_STORE_UNKNOWN:s;}
static veil_store_status participant_spans(ynx_native_core_participant_originals_v2*v,ynx_original_bytes**parts,size_t*total){
 if(v->version!=2||(v->purpose!=1&&v->purpose!=2)||!v->storage_generation||!v->deadline)return VEIL_STORE_MISMATCH;
 size_t n=0;parts[n++]=&v->approval;parts[n++]=&v->issuer_current;parts[n++]=&v->anchor_current;parts[n++]=&v->association;parts[n++]=&v->account;parts[n++]=&v->operation;
 for(unsigned i=0;i<6;i++)parts[n++]=&v->origin[i];
 parts[n++]=&v->accepted_relation;
 *total=0;for(size_t i=0;i<13;i++){
  size_t bound=(i==4||i==6||i==7||i==8)?16384:(i==9||i==10)?393216:i==5||i==11?1048576:65536;
  if(i==12&&!parts[i]->size){if(parts[i]->data||v->purpose==2)return VEIL_STORE_MISMATCH;continue;}
  uintptr_t a=(uintptr_t)parts[i]->data;if(!a||!parts[i]->size||parts[i]->size>bound||a>UINTPTR_MAX-parts[i]->size||parts[i]->size>1048576-*total)return VEIL_STORE_BOUND;*total+=parts[i]->size;
 }
 unsigned char digest[32];if(!SHA256(v->operation.data,v->operation.size,digest))return VEIL_STORE_UNKNOWN;
 return CRYPTO_memcmp(digest,v->intent_digest,32)?VEIL_STORE_MISMATCH:VEIL_STORE_OK;
}
veil_store_status ynx_native_core_participant_current(ynx_native_core_participant*p){
 ynx_native_core_participant*q=participant_recognized(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;if(q->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status st=(veil_store_status)ynx_sdk_native_core_rights_current_v2(q->policy);if(st)return participant_fail(q,st);if(!q->borrowed||!q->storage)return VEIL_STORE_REQUIRED;
 ynx_native_core_participant_originals_v2 now={0};st=(veil_store_status)ynx_sdk_native_core_participant_originals_v2(q->policy,&now);if(st)return participant_fail(q,st);
 ynx_original_bytes*a[13],*b[13];size_t an=0,bn=0;st=participant_spans(&now,a,&an);if(st)return participant_fail(q,st);st=participant_spans(&q->originals,b,&bn);if(st)return participant_fail(q,st);
 if(now.purpose!=q->originals.purpose||now.storage_generation!=q->originals.storage_generation||now.deadline!=q->originals.deadline||CRYPTO_memcmp(now.intent_digest,q->originals.intent_digest,32)||an!=bn)return participant_fail(q,VEIL_STORE_MISMATCH);
 for(unsigned i=0;i<13;i++)if(a[i]->size!=b[i]->size||(a[i]->size&&CRYPTO_memcmp(a[i]->data,b[i]->data,a[i]->size)))return participant_fail(q,VEIL_STORE_MISMATCH);
 st=(veil_store_status)ynx_sdk_native_core_rights_current_v2(q->policy);return st?participant_fail(q,st):VEIL_STORE_OK;
}
veil_store_status ynx_native_core_participant_acquire_v2(void*policy,ynx_native_core_participant**out){
 if(!out||*out||!policy)return VEIL_STORE_BOUND;
 veil_store_status st=(veil_store_status)ynx_sdk_native_core_rights_current_v2(policy);
 if(st)return st;
 pthread_mutex_lock(&participant_lock);if(participant_count>=32){pthread_mutex_unlock(&participant_lock);return VEIL_STORE_BOUND;}participant_count++;pthread_mutex_unlock(&participant_lock);
 ynx_native_core_participant*q=calloc(1,sizeof(*q));if(!q){pthread_mutex_lock(&participant_lock);participant_count--;pthread_mutex_unlock(&participant_lock);return VEIL_STORE_SQL;}q->policy=policy;q->thread=pthread_self();
 pthread_mutex_lock(&participant_lock);q->next=participants;participants=q;*out=q;pthread_mutex_unlock(&participant_lock);
 st=(veil_store_status)ynx_sdk_native_core_resource_retain_v2(policy);if(st)return participant_fail(q,st);q->borrowed=1;
 ynx_native_core_participant_originals_v2 raw={0};st=(veil_store_status)ynx_sdk_native_core_participant_originals_v2(policy,&raw);if(st)return participant_fail(q,st);
 ynx_original_bytes*parts[13];size_t total=0;st=participant_spans(&raw,parts,&total);if(st)return participant_fail(q,st);q->storage=malloc(total);if(!q->storage)return participant_fail(q,VEIL_STORE_SQL);q->size=total;q->originals=raw;
 ynx_original_bytes*owned[13];size_t ignored=0;st=participant_spans(&q->originals,owned,&ignored);if(st)return participant_fail(q,st);
 size_t at=0;for(unsigned i=0;i<13;i++){if(!parts[i]->size){*owned[i]=(ynx_original_bytes){0};continue;}memcpy(q->storage+at,parts[i]->data,parts[i]->size);owned[i]->data=q->storage+at;at+=parts[i]->size;}
 return ynx_native_core_participant_current(q);
}
/* Same-operation borrowed custody; not resource admission. */
veil_store_status ynx_native_core_participant_retain_for_policy(ynx_native_core_participant*p,void*policy){
 ynx_native_core_participant*q=participant_recognized(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!policy||q->policy!=policy)return VEIL_STORE_MISMATCH;
 veil_store_status s=ynx_native_core_participant_current(q);if(s)return s;
 if(q->enforcing_borrows>=32)return VEIL_STORE_BOUND;
 q->enforcing_borrows++;return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_participant_release_borrow(ynx_native_core_participant*p){
 ynx_native_core_participant*q=participant_recognized(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!q->enforcing_borrows)return VEIL_STORE_BOUND;
 q->enforcing_borrows--;return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_participant_close(ynx_native_core_participant**slot){
 if(!slot)return VEIL_STORE_BOUND;
 if(!*slot)return VEIL_STORE_OK;
 ynx_native_core_participant*q=participant_recognized(*slot);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->enforcing_borrows)return VEIL_STORE_BOUND;
 if(q->borrowed){veil_store_status st=(veil_store_status)ynx_sdk_native_core_resource_release_v2(q->policy);if(st)return participant_fail(q,st);q->borrowed=0;}
 if(q->storage){OPENSSL_cleanse(q->storage,q->size);free(q->storage);q->storage=NULL;}
 pthread_mutex_lock(&participant_lock);ynx_native_core_participant**p=&participants;while(*p&&*p!=q)p=&(*p)->next;if(!*p)abort();*p=q->next;participant_count--;pthread_mutex_unlock(&participant_lock);int unresolved=q->unknown;OPENSSL_cleanse(q,sizeof(*q));free(q);*slot=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}

/* This release-private row is location/original custody, NOT approval. Missing
 * registered rows stay empty. No ENV/JNI/raw-pointer/callback installation. */
typedef struct native_core_registered_row {
 ynx_original_bytes complete_association;
 ynx_tpm2_resource_selection storage,allocator_integrity,allocator_counter;
 ynx_tpm2_resource_selection domain_integrity[2],domain_floor[2];
 const char *store;uint64_t store_device,store_inode;
 /* Release-private original resource locations, never caller selection. */
 const char *coordinator;uint64_t coordinator_device,coordinator_inode;
 const char *domain_store[2];uint64_t domain_device[2],domain_inode[2];
 ynx_domain_state domain_original[2];
 unsigned char storage_key_identity[32];
 /* Legal commissioning selects exact command-key originals for allocator and
  * two independent floor counters. NOT Source role signing keys/admin loans. */
 ynx_tpm2_resource_selection command_auth[3][2];
 ynx_tpm2_command_authorizer_selection command_authorizer[3][2];
} native_core_registered_row;
static const native_core_registered_row *native_core_registered_rows(size_t*n){*n=0;return NULL;}
struct ynx_native_core_resource_loan {
 pthread_t thread;void *policy;const native_core_registered_row *row;
 ynx_tpm2_owner *objects[7];veil_custody_watch *watch;ynx_native_core_participant*participant;
 core_domain_driver *driver;
 uint64_t deadline;veil_store_status first;int unknown,policy_borrowed,v2,active,participant_external_borrowed;unsigned final_borrows,prepared_borrows,product_sql_borrows;struct ynx_native_core_resource_loan *next;
};
static pthread_mutex_t core_resource_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_native_core_resource_loan *core_resources;
static ynx_native_core_resource_loan *core_resource_recognized(ynx_native_core_resource_loan*p){pthread_mutex_lock(&core_resource_lock);ynx_native_core_resource_loan*q=core_resources;while(q&&q!=p)q=q->next;pthread_mutex_unlock(&core_resource_lock);return q;}
static veil_store_status core_resource_primitive(int s){switch(s){case YNX_TPM2_OK:return VEIL_STORE_OK;case YNX_TPM2_REQUIRED:return VEIL_STORE_REQUIRED;case YNX_TPM2_REFUSED:return VEIL_STORE_MISMATCH;case YNX_TPM2_RESOURCE:return VEIL_STORE_SQL;default:return VEIL_STORE_UNKNOWN;}}
static veil_store_status core_resource_fail(ynx_native_core_resource_loan*q,veil_store_status s){if(!q->first)q->first=q->participant&&q->participant->first?q->participant->first:s;if(s!=VEIL_STORE_REQUIRED)q->unknown=1;return q->unknown?VEIL_STORE_UNKNOWN:s;}
static veil_store_status core_resource_observe_current(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;if(q->unknown)return VEIL_STORE_UNKNOWN;
 if(q->v2){veil_store_status p=ynx_native_core_participant_current(q->participant);if(p)return core_resource_fail(q,p);}
 veil_store_status s=(veil_store_status)(q->v2?ynx_sdk_native_core_rights_current_v2(q->policy):ynx_sdk_native_core_policy_current_v1(q->policy));if(s)return core_resource_fail(q,s);
 for(unsigned i=0;i<7;i++){if(!q->objects[i])return VEIL_STORE_REQUIRED;s=core_resource_primitive(ynx_tpm2_owner_current(q->objects[i]));if(s)return core_resource_fail(q,s);}
 struct stat st;if(!q->watch||lstat(q->row->store,&st)||!S_ISREG(st.st_mode)||(uint64_t)st.st_dev!=q->row->store_device||(uint64_t)st.st_ino!=q->row->store_inode)return core_resource_fail(q,VEIL_STORE_MISMATCH);
 s=(veil_store_status)(q->v2?ynx_sdk_native_core_association_matches_v2(q->policy,q->row->complete_association.data,q->row->complete_association.size):ynx_sdk_native_core_association_matches_v1(q->policy,q->row->complete_association.data,q->row->complete_association.size));return s?core_resource_fail(q,s):VEIL_STORE_OK;
 /* OK here is only all original object observations, never a Core grant. */
}
veil_store_status ynx_native_core_resource_observe_current(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->active)return core_resource_fail(q,VEIL_STORE_FROZEN);
 q->active=1;
 veil_store_status s=core_resource_observe_current(q);q->active=0;return q->unknown?VEIL_STORE_UNKNOWN:s;
}
static veil_store_status core_resource_acquire_inner(void*policy,int v2,ynx_native_core_participant*supplied,ynx_native_core_resource_loan**out){
 if(!out||*out||!policy)return VEIL_STORE_BOUND;
 veil_store_status s=(veil_store_status)(v2?ynx_sdk_native_core_gate_v2(policy,3):ynx_sdk_native_core_policy_current_v1(policy));if(s)return s;
 ynx_native_core_resource_loan*q=NULL;
 if(v2){q=calloc(1,sizeof(*q));if(!q)return VEIL_STORE_SQL;q->thread=pthread_self();q->policy=policy;q->v2=1;q->active=1;
  pthread_mutex_lock(&core_resource_lock);q->next=core_resources;core_resources=q;*out=q;pthread_mutex_unlock(&core_resource_lock);
  if(supplied){
   q->participant=supplied;
   s=ynx_native_core_participant_retain_for_policy(supplied,policy);
   if(s){q->participant=NULL;return core_resource_fail(q,s);}
   q->participant_external_borrowed=1;
  }else{s=ynx_native_core_participant_acquire_v2(policy,&q->participant);if(s)return core_resource_fail(q,s);}
 }
 size_t n=0;const native_core_registered_row*rows=native_core_registered_rows(&n),*selected=NULL;
 for(size_t i=0;i<n;i++){
  if(!rows[i].complete_association.data||!rows[i].complete_association.size||rows[i].complete_association.size>65536)return VEIL_STORE_BOUND;
  s=(veil_store_status)(v2?ynx_sdk_native_core_association_matches_v2(policy,rows[i].complete_association.data,rows[i].complete_association.size):ynx_sdk_native_core_association_matches_v1(policy,rows[i].complete_association.data,rows[i].complete_association.size));
  if(s==VEIL_STORE_MISMATCH)continue;
  if(s)return s;
  if(selected)return VEIL_STORE_DUPLICATE;
  selected=&rows[i];
 }
 if(!selected)return VEIL_STORE_REQUIRED;
 uint64_t deadline=0;s=(veil_store_status)(v2?ynx_sdk_native_core_deadline_borrow_v2(policy,&deadline):ynx_sdk_native_core_deadline_borrow_v1(policy,&deadline));if(s)return s;if(!deadline)return VEIL_STORE_UNKNOWN;
 const ynx_tpm2_resource_selection*objects[]={&selected->storage,&selected->allocator_integrity,&selected->allocator_counter,&selected->domain_integrity[0],&selected->domain_integrity[1],&selected->domain_floor[0],&selected->domain_floor[1]};
 for(unsigned i=0;i<7;i++){if(!objects[i]->device||objects[i]->object_name.size!=34)return VEIL_STORE_REQUIRED;for(unsigned j=0;j<i;j++)if(!CRYPTO_memcmp(objects[i]->object_name.name,objects[j]->object_name.name,34))return VEIL_STORE_MISMATCH;}
 if(!selected->store||selected->store[0]!='/'||strnlen(selected->store,4097)>4096)return VEIL_STORE_BOUND;
 if(!q){q=calloc(1,sizeof(*q));if(!q)return VEIL_STORE_SQL;q->thread=pthread_self();q->policy=policy;q->v2=v2;q->active=1;
  pthread_mutex_lock(&core_resource_lock);q->next=core_resources;core_resources=q;*out=q;pthread_mutex_unlock(&core_resource_lock);
  s=(veil_store_status)ynx_sdk_native_core_resource_retain_v1(policy);if(s)return core_resource_fail(q,s);q->policy_borrowed=1;
 }q->row=selected;q->deadline=deadline;
 for(unsigned i=0;i<7;i++){
  s=(veil_store_status)(v2?ynx_sdk_native_core_gate_v2(policy,3):ynx_sdk_native_core_policy_current_v1(policy));if(s)return core_resource_fail(q,s);
  ynx_tpm2_resource_selection original=*objects[i];if(!original.monotonic_deadline_ns)return core_resource_fail(q,VEIL_STORE_REQUIRED);if(original.monotonic_deadline_ns>q->deadline)original.monotonic_deadline_ns=q->deadline;
  s=core_resource_primitive(ynx_tpm2_owner_open(&original,&q->objects[i]));if(s)return core_resource_fail(q,s);
  /* Only selected storage: no raw Unseal/borrow can escape the partial Core
   * loan while authenticated shared NativeCore acquisition is unavailable. */
  if(i==0){s=core_resource_primitive(ynx_tpm2_owner_deny_raw_secret(q->objects[i]));if(s)return core_resource_fail(q,s);}
 }
 struct stat st;if(lstat(selected->store,&st)||!S_ISREG(st.st_mode)||(uint64_t)st.st_dev!=selected->store_device||(uint64_t)st.st_ino!=selected->store_inode)return core_resource_fail(q,VEIL_STORE_MISMATCH);
 s=veil_custody_watch_open(selected->store,&q->watch);if(s)return core_resource_fail(q,s);
 s=core_resource_observe_current(q);if(s)return s;
 /* Do not Unseal or open a writable store before the TRUE shared independent
  * current/revoke/head/floor/enforcing loan exists. The selected TPM primitive
  * only provides object/counter observations and cannot produce that loan. */
 return VEIL_STORE_REQUIRED;
}
static veil_store_status core_resource_acquire(void*policy,int v2,ynx_native_core_resource_loan**out){
 if(!out||*out||!policy)return VEIL_STORE_BOUND;
 veil_store_status s=core_resource_acquire_inner(policy,v2,NULL,out);
 if(out&&*out){ynx_native_core_resource_loan*q=core_resource_recognized(*out);
  if(!q||!pthread_equal(q->thread,pthread_self()))return s;
  /* The exact partial was visible before Native acquisition. A swallowed
   * nested refusal cannot turn its lifetime failure back into REQUIRED/OK. */
  q->active=0;if(q->unknown)return VEIL_STORE_UNKNOWN;
 }return s;
}
static veil_store_status core_driver_close(ynx_native_core_resource_loan*);
static veil_store_status core_initialization_finish_drain_internal(ynx_native_core_resource_loan*);
static veil_store_status core_resource_close(ynx_native_core_resource_loan**p){
 if(!p)return VEIL_STORE_BOUND;
 if(!*p)return VEIL_STORE_OK;
 ynx_native_core_resource_loan*q=core_resource_recognized(*p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 veil_store_status initialization_cleanup=core_initialization_finish_drain_internal(q);if(initialization_cleanup)return initialization_cleanup;
 if(q->final_borrows||q->prepared_borrows||q->product_sql_borrows)return VEIL_STORE_BOUND;
 if(q->driver){veil_store_status st=core_driver_close(q);if(st)core_resource_fail(q,st);if(q->driver)return st?st:VEIL_STORE_UNKNOWN;}
 for(unsigned j=7;j>0;j--){unsigned i=j-1;if(!q->objects[i])continue;ynx_tpm2_owner*before=q->objects[i];veil_store_status s=core_resource_primitive(ynx_tpm2_owner_close(&q->objects[i]));if(q->objects[i]&&q->objects[i]!=before)abort();if(s&&!q->objects[i]&&s!=VEIL_STORE_UNKNOWN)abort();if(s){core_resource_fail(q,s);q->unknown=1;}if(q->objects[i]){q->unknown=1;return core_resource_fail(q,s?s:VEIL_STORE_UNKNOWN);}}
 if(q->watch){veil_custody_watch*before=q->watch;veil_store_status s=veil_custody_watch_drop(&q->watch);if(q->watch&&q->watch!=before)abort();if(s&&!q->watch&&s!=VEIL_STORE_UNKNOWN)abort();if(s){core_resource_fail(q,s);q->unknown=1;}if(q->watch){q->unknown=1;return core_resource_fail(q,s?s:VEIL_STORE_UNKNOWN);}}
 if(q->participant_external_borrowed){
  veil_store_status st=ynx_native_core_participant_release_borrow(q->participant);
  if(st)return core_resource_fail(q,st);
  q->participant_external_borrowed=0;q->participant=NULL;
 }
 if(q->participant){ynx_native_core_participant*before=q->participant;veil_store_status st=ynx_native_core_participant_close(&q->participant);if(q->participant&&q->participant!=before)abort();if(st&&!q->participant&&st!=VEIL_STORE_UNKNOWN)abort();if(st)core_resource_fail(q,st);if(q->participant)return core_resource_fail(q,st?st:VEIL_STORE_UNKNOWN);}
 if(q->policy_borrowed){veil_store_status s=(veil_store_status)(q->v2?ynx_sdk_native_core_resource_release_v2(q->policy):ynx_sdk_native_core_resource_release_v1(q->policy));if(s)return core_resource_fail(q,s);q->policy_borrowed=0;}
 pthread_mutex_lock(&core_resource_lock);ynx_native_core_resource_loan**link=&core_resources;while(*link&&*link!=q)link=&(*link)->next;if(*link!=q){pthread_mutex_unlock(&core_resource_lock);abort();}*link=q->next;pthread_mutex_unlock(&core_resource_lock);int unknown=q->unknown;OPENSSL_cleanse(q,sizeof(*q));free(q);*p=NULL;return unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_close(ynx_native_core_resource_loan**p){
 if(!p)return VEIL_STORE_BOUND;
 if(!*p)return VEIL_STORE_OK;
 ynx_native_core_resource_loan*q=core_resource_recognized(*p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->active)return core_resource_fail(q,VEIL_STORE_FROZEN);
 q->active=1;
 veil_store_status s=core_resource_close(p);
 /* A successfully drained object is gone; never dereference it again. A
  * failed close leaves the original non-null owner for explicit cleanup. */
 if(*p){if(*p!=q)abort();q->active=0;}return s;
}

veil_store_status ynx_native_core_resource_acquire(void*p,ynx_native_core_resource_loan**out){return core_resource_acquire(p,0,out);}
veil_store_status ynx_native_core_resource_acquire_v2(void*p,ynx_native_core_resource_loan**out){return core_resource_acquire(p,1,out);}

veil_store_status ynx_native_core_resource_first_cause(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);if(!q||!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_OK;return q->first;
}

#include "ynx_native_core_pending.inc"

#include "ynx_native_core_domain_driver.inc"

/* Qualified final custody is implemented in the same concrete driver TU. */
#include "ynx_native_core_final_custody.inc"

#include "ynx_native_core_preguard_originals.inc"
