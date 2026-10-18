#include "ynx_source_administration_owner.h"
#include "ynx_source_server_resource_owner.h"
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <openssl/crypto.h>
#include <openssl/sha.h>
#include <sys/mman.h>
#include <unistd.h>
#include <sys/stat.h>
/* Exactly the already selected bundled SQLite namespace, not system SQLite. */
#define sqlite3_open_v2 veil_sqlite3500400_sqlite3_open_v2
#define sqlite3_close veil_sqlite3500400_sqlite3_close
#define sqlite3_prepare_v2 veil_sqlite3500400_sqlite3_prepare_v2
#define sqlite3_step veil_sqlite3500400_sqlite3_step
#define sqlite3_finalize veil_sqlite3500400_sqlite3_finalize
#define sqlite3_column_blob veil_sqlite3500400_sqlite3_column_blob
#define sqlite3_column_bytes veil_sqlite3500400_sqlite3_column_bytes
#define sqlite3_column_type veil_sqlite3500400_sqlite3_column_type
#define sqlite3_exec veil_sqlite3500400_sqlite3_exec
#define sqlite3_get_autocommit veil_sqlite3500400_sqlite3_get_autocommit
#define sqlite3_bind_blob veil_sqlite3500400_sqlite3_bind_blob
#define sqlite3_bind_int64 veil_sqlite3500400_sqlite3_bind_int64
#define sqlite3_changes veil_sqlite3500400_sqlite3_changes
#include <sqlite3.h>
#include "../../c/src/veil_store_custody.h"
#include "ynx_source_sealed_role_launcher.h"
#include "ynx_source_independent_reservation.h"
#include "ynx_source_original_resource_owner.h"
#include <tss2_mu.h>
extern int32_t ynx_sdk_server_startup_recognize_v1(void *,uint32_t);
extern int32_t ynx_sdk_server_startup_current_v1(void *,uint32_t);
extern int32_t ynx_sdk_server_administration_policy_current_v1(void *,uint32_t,ynx_administration_head_expectation *);
extern int32_t ynx_sdk_server_registered_originals_borrow_v1(void *,ynx_server_registered_original_borrow *);
/* Release-private object locations are NOT a policy. This separate binding is
 * usable only after independently selected administration policy and full row
 * matching. No ENV/JNI/receiver installer. Missing admitted instances are empty.
 * TLS/storage/state objects and counters never alias either wrapping family. */
typedef struct registry_resource_binding{
 unsigned char row_digest[32];ynx_administration_head_expectation expected;
 ynx_tpm2_resource_selection objects[3];uint64_t storage_generation;
 /* Location/inode are custody observations only. The actual state is opened
  * with the DISTINCT protected registry key and exact original envelope AAD.
  * A missing database is NOT created or initialized from expected metadata. */
 const char *registry_store;uint64_t store_device,store_inode;
 ynx_storage_expected head_envelope;
 /* Actual private registered integrity object, DISTINCT from all three keys.
  * Full expected original comes from the independent registered current-head
  * owner, not fields decoded from SQLite/certification. Empty binding refuses.
  * This never reinterprets wrapping enrollment as an allocator permission. */
 ynx_tpm2_resource_selection allocator_integrity;
 ynx_tpm2_resource_selection allocator_counter;
 /* DISTINCT original domain command custodians; these selections locate
  * actual objects, never establish administration or exclusive authority. */
 ynx_tpm2_command_authorizer_selection allocator_authorizers[2];
 /* DISTINCT policy-auth secret objects, one per original administration domain.
  * Private registered policy must cover these mappings; no raw secret/config. */
 ynx_tpm2_resource_selection command_auth[2];
 ynx_allocator_journal allocator_original;
 /* Release-private DISTINCT domain resources. The selected administration
  * policy must cover the full association containing these original objects;
  * paths and table entries are locations, not capabilities. Empty table stays
  * unprovisioned. No CREATE/migration or caller key/SQLite handle installation. */
 ynx_tpm2_resource_selection domain_integrity[2],domain_floor[2];
 const char *domain_store[2];uint64_t domain_device[2],domain_inode[2];
 ynx_domain_state domain_original[2];
 const ynx_message_enrollment_public_input *allocator_enrollment;
} registry_resource_binding;
typedef struct registry_allocation_owner{
 ynx_tpm2_owner *integrity,*counter;unsigned char *key;size_t pages;int locked,borrowed;
 ynx_tpm2_command_authorizer *authorizers[2];ynx_tpm2_owner *command_auth[2];
 ynx_allocator_journal original,prepared,entered_original;unsigned char request[32];
 veil_store_status first;int unknown,prepared_durable,entered;
 TPM2B_ATTEST *burn_attestation;TPMT_SIGNATURE *burn_signature;int observation_entered,journal_observed,entered_original_retained;
}registry_allocation_owner;
typedef struct registry_joint_fence{
 pthread_t thread;void*startup;uint32_t role;
 ynx_administration_head_expectation expected;unsigned char row[32];
}registry_joint_fence;
static const registry_resource_binding *registered_resource_bindings(size_t *count){*count=0;return NULL;}
typedef struct registry_resource_owner{
 const registry_resource_binding *binding;ynx_tpm2_owner *objects[3];
 unsigned char *keys;size_t key_pages;int keys_locked;unsigned borrowed[3];veil_store_status first;int unknown;
 sqlite3 *registry;veil_custody_watch *store_watch;int transaction,authority_locked,source_locked;
 int intent_entered,intent_durable;
 ynx_storage_expected active_head;
 registry_allocation_owner *allocation;
 registry_joint_fence *fence;
} registry_resource_owner;
/* Ordering/serialization mechanics ONLY, never independent admission. All
 * administration mutations enter these in authority -> source-CAS -> SQL
 * order after the actual policy/current/key/floor owners have been acquired. */
static pthread_mutex_t registry_authority_lock=PTHREAD_MUTEX_INITIALIZER;
static pthread_mutex_t registry_source_lock=PTHREAD_MUTEX_INITIALIZER;
static uint64_t registry_u64(const unsigned char *p){uint64_t n=0;for(unsigned i=0;i<8;i++)n=(n<<8)|p[i];return n;}
/* This authenticated original is a head observation, not final adjudication.
 * Its key/expected fields originate only in selected policy + real resource
 * custody; no unsigned DB metadata selects a new key/Root/floor/generation. */
static veil_store_status registry_head_read(registry_resource_owner *r){
 if(!r||!r->registry||!r->keys||!r->keys_locked)return VEIL_STORE_REQUIRED;
 veil_store_status custody=veil_custody_watch_check(r->registry,r->store_watch);if(custody)return custody;
 sqlite3_stmt *st=NULL;if(sqlite3_prepare_v2(r->registry,"SELECT sealed FROM registry_head WHERE slot=1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status status=VEIL_STORE_MISMATCH;
 if(sqlite3_step(st)==SQLITE_ROW&&sqlite3_column_type(st,0)==SQLITE_BLOB){
  int size=sqlite3_column_bytes(st,0);const unsigned char *blob=sqlite3_column_blob(st,0);
  if(size>0&&size<=YNX_STORAGE_MAX&&blob){
   size_t written=0;unsigned char *sink=r->keys+64;
   status=ynx_storage_open(r->keys+32,&r->active_head,(ynx_original_bytes){blob,(size_t)size},sink,r->key_pages-64,&written);
   if(!status&&(written!=96||memcmp(sink,"YNXADM1\0",8)||registry_u64(sink+8)!=r->binding->expected.generation||CRYPTO_memcmp(sink+16,r->binding->expected.head,32)||registry_u64(sink+48)!=r->binding->objects[2].expected_counter||CRYPTO_memcmp(sink+56,r->binding->row_digest,32)||registry_u64(sink+88)!=r->binding->storage_generation))status=VEIL_STORE_MISMATCH;
   OPENSSL_cleanse(sink,r->key_pages-64);
  }
  if(sqlite3_step(st)!=SQLITE_DONE)status=VEIL_STORE_MISMATCH;
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&status==VEIL_STORE_OK)status=VEIL_STORE_SQL;
 if(status==VEIL_STORE_OK){custody=veil_custody_watch_check(r->registry,r->store_watch);if(custody)status=custody;}
 return status;
}
static veil_store_status registry_open(registry_resource_owner *r){
 const registry_resource_binding *b=r->binding;struct stat actual;
 if(!b->registry_store||b->registry_store[0]!='/'||strnlen(b->registry_store,4097)>4096)return VEIL_STORE_REQUIRED;
 if(lstat(b->registry_store,&actual)||!S_ISREG(actual.st_mode)||(uint64_t)actual.st_dev!=b->store_device||(uint64_t)actual.st_ino!=b->store_inode)return VEIL_STORE_MISMATCH;
 veil_store_status custody=veil_custody_watch_open(b->registry_store,&r->store_watch);if(custody)return custody;
 int raw=sqlite3_open_v2(b->registry_store,&r->registry,SQLITE_OPEN_READWRITE|SQLITE_OPEN_FULLMUTEX|SQLITE_OPEN_NOFOLLOW,NULL);
 if(raw!=SQLITE_OK)return VEIL_STORE_SQL;
 /* No CREATE, migration, hidden durability downgrade or automatic retry. */
 if(sqlite3_exec(r->registry,"PRAGMA synchronous=FULL; PRAGMA busy_timeout=0",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 struct stat after;if(lstat(b->registry_store,&after)||after.st_dev!=actual.st_dev||after.st_ino!=actual.st_ino)return VEIL_STORE_MISMATCH;
 return registry_head_read(r);
}
static veil_store_status primitive_status(int s){switch(s){case YNX_TPM2_OK:return VEIL_STORE_OK;case YNX_TPM2_REQUIRED:return VEIL_STORE_REQUIRED;case YNX_TPM2_REFUSED:return VEIL_STORE_MISMATCH;case YNX_TPM2_RESOURCE:return VEIL_STORE_SQL;default:return VEIL_STORE_UNKNOWN;}}
static veil_store_status resource_fail(registry_resource_owner *r,veil_store_status s){if(!r->first)r->first=s;if(s!=VEIL_STORE_REQUIRED)r->unknown=1;return r->unknown?VEIL_STORE_UNKNOWN:s;}
static veil_store_status resource_current(registry_resource_owner *r){
 if(!r)return VEIL_STORE_REQUIRED;if(r->unknown)return VEIL_STORE_UNKNOWN;
 for(size_t i=0;i<3;i++){if(!r->objects[i])return VEIL_STORE_REQUIRED;veil_store_status s=primitive_status(ynx_tpm2_owner_current(r->objects[i]));if(s)return resource_fail(r,s);}
 veil_store_status head=registry_head_read(r);if(head)return resource_fail(r,head);
 for(size_t i=0;i<3;i++){veil_store_status late=primitive_status(ynx_tpm2_owner_current(r->objects[i]));if(late)return resource_fail(r,late);}
 return VEIL_STORE_OK;
}
static veil_store_status registry_fence_current(registry_resource_owner*r){
 registry_joint_fence*f=r?r->fence:NULL;if(!f)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(f->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* Selected administration policy AND independently keyed original head/floor
  * owners remain current. Neither mutex/SQL locks nor a MAC alone publish it. */
 veil_store_status s=(veil_store_status)ynx_sdk_server_startup_current_v1(f->startup,f->role);if(s)return s;
 ynx_administration_head_expectation observed={0};s=(veil_store_status)ynx_sdk_server_administration_policy_current_v1(f->startup,f->role,&observed);if(s)return s;
 if(observed.generation!=f->expected.generation||CRYPTO_memcmp(observed.head,f->expected.head,32)||CRYPTO_memcmp(f->row,r->binding->row_digest,32))return VEIL_STORE_MISMATCH;
 s=resource_current(r);if(s)return s;
 return (veil_store_status)ynx_sdk_server_startup_current_v1(f->startup,f->role);
}
static veil_store_status registry_fence_acquire(registry_resource_owner*r,void*startup,uint32_t role){
 if(!r||!r->binding||!r->registry)return VEIL_STORE_REQUIRED;
 if(r->fence){if(r->fence->startup!=startup||r->fence->role!=role)return VEIL_STORE_MISMATCH;return registry_fence_current(r);}
 veil_store_status s=(veil_store_status)ynx_sdk_server_startup_recognize_v1(startup,role);if(s)return s;
 registry_joint_fence*f=calloc(1,sizeof(*f));if(!f)return VEIL_STORE_SQL;
 f->thread=pthread_self();f->startup=startup;f->role=role;f->expected=r->binding->expected;memcpy(f->row,r->binding->row_digest,32);
 r->fence=f;/* original partial loan BEFORE late policy/resource checks */
 return registry_fence_current(r);
}
static veil_store_status registry_compare_begin(registry_resource_owner *r){
 if(!r||!r->registry)return VEIL_STORE_REQUIRED;
 if(r->transaction||r->authority_locked!=r->source_locked)return VEIL_STORE_FROZEN;
 /* No waits/renewed budget. Acquiring a process lock alone never publishes
  * this transaction: real resource current and authenticated head follow. */
 if(!r->authority_locked){if(pthread_mutex_trylock(&registry_authority_lock))return VEIL_STORE_FROZEN;r->authority_locked=1;
 if(pthread_mutex_trylock(&registry_source_lock))return VEIL_STORE_FROZEN;r->source_locked=1;}
 veil_store_status status=registry_fence_current(r);if(status)return status;
 if(!sqlite3_get_autocommit(r->registry))return VEIL_STORE_LIFETIME;
 if(sqlite3_exec(r->registry,"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 /* Adopt the original transaction before any current/readback failure. */
 r->transaction=1;if(sqlite3_get_autocommit(r->registry))return resource_fail(r,VEIL_STORE_UNKNOWN);
 status=registry_fence_current(r);if(status)return status;
 return VEIL_STORE_OK;
}
/* A durable local original-intent witness is NOT an independent reservation,
 * nonce allocator or admission receipt. The database/table must already belong
 * to the selected protected store. No CREATE, rollover, replace or migration.
 * All values are original public provisioning intent; no key/plaintext row is
 * persisted here. The unique key is provisioned as (key_generation, request).
 * This stage precedes sealing and any registration effect. */
static veil_store_status registry_intent_read(registry_resource_owner *r,ynx_original_bytes original,const unsigned char digest[32],int *found){
 *found=0;sqlite3_stmt *st=NULL;
 if(r->binding->storage_generation>INT64_MAX)return VEIL_STORE_BOUND;
 if(sqlite3_prepare_v2(r->registry,"SELECT original FROM registry_intent WHERE key_generation=?1 AND request=?2",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status status=VEIL_STORE_SQL;
 if(sqlite3_bind_int64(st,1,(sqlite3_int64)r->binding->storage_generation)==SQLITE_OK&&sqlite3_bind_blob(st,2,digest,32,SQLITE_STATIC)==SQLITE_OK){
  int step=sqlite3_step(st);if(step==SQLITE_DONE)status=VEIL_STORE_OK;
  else if(step==SQLITE_ROW){
   int n=sqlite3_column_bytes(st,0);const unsigned char *raw=sqlite3_column_blob(st,0);
   status=sqlite3_column_type(st,0)==SQLITE_BLOB&&n==(int)original.size&&raw&&!CRYPTO_memcmp(raw,original.data,original.size)?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
   if(sqlite3_step(st)!=SQLITE_DONE)status=VEIL_STORE_MISMATCH;
   if(!status)*found=1;
  }
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!status)status=VEIL_STORE_SQL;
 return status;
}
static veil_store_status registry_intent_persist(registry_resource_owner *r,ynx_original_bytes original){
 /* Only the Native-produced versioned public registration intent is eligible.
  * An arbitrary caller blob must never be written as a purported public row. */
 if(original.size!=88||memcmp(original.data,"YNXARE1\0",8)||original.data[8]||original.data[9]!=1||original.data[10]||original.data[11]!=1)return VEIL_STORE_MISMATCH;
 if(r->intent_entered&&!r->intent_durable)return resource_fail(r,VEIL_STORE_UNKNOWN);
 unsigned char digest[32];if(!SHA256(original.data,original.size,digest))return resource_fail(r,VEIL_STORE_UNKNOWN);
 int found=0;veil_store_status status=registry_intent_read(r,original,digest,&found);if(status)return status;
 if(found){r->intent_durable=1;return resource_current(r);}
 if(r->intent_durable)return resource_fail(r,VEIL_STORE_MISMATCH);
 if(!r->transaction||sqlite3_get_autocommit(r->registry))return VEIL_STORE_LIFETIME;
 sqlite3_stmt *st=NULL;
 if(sqlite3_prepare_v2(r->registry,"INSERT INTO registry_intent(key_generation,request,original) VALUES(?1,?2,?3)",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 status=VEIL_STORE_SQL;
 if(sqlite3_bind_int64(st,1,(sqlite3_int64)r->binding->storage_generation)==SQLITE_OK&&sqlite3_bind_blob(st,2,digest,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_blob(st,3,original.data,(int)original.size,SQLITE_STATIC)==SQLITE_OK){
  /* Entered before the first write; every ambiguous result forbids re-entry.
   * This latches a LOCAL intent effect, never an independent nonce grant. */
  r->intent_entered=1;
  if(sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(r->registry)==1)status=VEIL_STORE_OK;
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!status)status=VEIL_STORE_SQL;
 if(status)return resource_fail(r,status);
 status=resource_current(r);if(status)return resource_fail(r,status);
 /* FULL synchronous durability was fixed when the original store was opened.
  * COMMIT failure retains the original owner and transaction/uncertainty. */
 if(sqlite3_exec(r->registry,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(r->registry))return resource_fail(r,VEIL_STORE_UNKNOWN);
 r->transaction=0;r->intent_durable=1;
 found=0;status=registry_intent_read(r,original,digest,&found);
 if(status||!found)return resource_fail(r,status?status:VEIL_STORE_UNKNOWN);
 status=resource_current(r);if(status)return resource_fail(r,status);
 return VEIL_STORE_OK;
}
static veil_store_status allocation_fail(registry_allocation_owner*a,veil_store_status s){if(!a->first)a->first=s;if(a->entered||s!=VEIL_STORE_REQUIRED)a->unknown=1;return a->unknown?VEIL_STORE_UNKNOWN:s;}
static veil_store_status allocation_read_originals(registry_resource_owner*r,registry_allocation_owner*a,const ynx_allocator_journal*expected,const ynx_allocator_journal*alternate){
 sqlite3_stmt*st=NULL;if(sqlite3_prepare_v2(r->registry,"SELECT original FROM allocator_journal WHERE key_generation=?1 AND allocator=?2",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_SQL;
 if(expected->key_generation<=INT64_MAX&&sqlite3_bind_int64(st,1,(sqlite3_int64)expected->key_generation)==SQLITE_OK&&sqlite3_bind_blob(st,2,expected->allocator,32,SQLITE_STATIC)==SQLITE_OK){
  if(sqlite3_step(st)==SQLITE_ROW&&sqlite3_column_type(st,0)==SQLITE_BLOB){int n=sqlite3_column_bytes(st,0);const unsigned char*raw=sqlite3_column_blob(st,0);ynx_allocator_journal observed={0};
   s=n==YNX_ALLOCATOR_JOURNAL_BYTES&&raw?ynx_allocator_journal_decode(a->key,(ynx_original_bytes){raw,(size_t)n},expected,&observed):VEIL_STORE_MISMATCH;
   /* The SAME captured row may match either exact retained write outcome.
    * No response field becomes Expected, no second query races this choice. */
   OPENSSL_cleanse(&observed,sizeof(observed));
   if(s==VEIL_STORE_MISMATCH&&alternate&&n==YNX_ALLOCATOR_JOURNAL_BYTES&&raw){s=ynx_allocator_journal_decode(a->key,(ynx_original_bytes){raw,(size_t)n},alternate,&observed);OPENSSL_cleanse(&observed,sizeof(observed));}
   if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
  }
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
static veil_store_status allocation_read(registry_resource_owner*r,registry_allocation_owner*a,const ynx_allocator_journal*expected){return allocation_read_originals(r,a,expected,NULL);}
static veil_store_status allocation_current(registry_resource_owner*r,registry_allocation_owner*a){
 if(!a||!a->integrity||!a->counter||!a->authorizers[0]||!a->authorizers[1]||!a->key||!a->locked)return VEIL_STORE_REQUIRED;if(a->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status s=primitive_status(ynx_tpm2_owner_current(a->integrity));if(s)return allocation_fail(a,s);
 s=primitive_status(ynx_tpm2_owner_current(a->counter));if(s)return allocation_fail(a,s);
 for(unsigned i=0;i<2;i++){s=primitive_status(ynx_tpm2_command_authorizer_current(a->authorizers[i]));if(s)return allocation_fail(a,s);}
 s=registry_fence_current(r);if(s)return allocation_fail(a,s);
 s=allocation_read(r,a,a->prepared_durable?&a->prepared:&a->original);if(s)return allocation_fail(a,s);
 for(unsigned i=0;i<2;i++){s=primitive_status(ynx_tpm2_command_authorizer_current(a->authorizers[i]));if(s)return allocation_fail(a,s);}
 s=primitive_status(ynx_tpm2_owner_current(a->integrity));return s?allocation_fail(a,s):VEIL_STORE_OK;
}
static veil_store_status allocation_acquire(registry_resource_owner*r){
 if(r->allocation)return allocation_current(r,r->allocation);
 const registry_resource_binding*b=r->binding;const ynx_allocator_journal*original=&b->allocator_original;
 /* An unprovisioned selection is not synthesized from counter/head metadata. */
 if(!original->epoch||!original->key_generation||original->phase!=3||!original->deadline||b->allocator_integrity.object_name.size!=34||b->allocator_counter.counter_name.size!=34)return VEIL_STORE_REQUIRED;
 if(original->key_generation!=b->storage_generation||original->deadline!=b->allocator_integrity.monotonic_deadline_ns||original->floor!=b->objects[2].expected_counter||CRYPTO_memcmp(original->head,b->expected.head,32)||CRYPTO_memcmp(original->registration,b->row_digest,32))return VEIL_STORE_MISMATCH;
 for(size_t i=0;i<3;i++)if(b->objects[i].object_name.size==b->allocator_integrity.object_name.size&&!CRYPTO_memcmp(b->objects[i].object_name.name,b->allocator_integrity.object_name.name,34))return VEIL_STORE_MISMATCH;
 if(original->ordinal!=b->allocator_counter.expected_counter||original->deadline!=b->allocator_counter.monotonic_deadline_ns)return VEIL_STORE_MISMATCH;
 for(size_t i=0;i<3;i++)if(b->objects[i].counter_name.size==34&&!CRYPTO_memcmp(b->objects[i].counter_name.name,b->allocator_counter.counter_name.name,34))return VEIL_STORE_MISMATCH;
 for(unsigned i=0;i<2;i++){
  const ynx_tpm2_command_authorizer_selection*c=&b->allocator_authorizers[i];
  if(!c->device||c->original_name.size!=34)return VEIL_STORE_REQUIRED;
  if(c->monotonic_deadline_ns!=original->deadline)return VEIL_STORE_MISMATCH;
  const TPM2B_NAME*distinct[]={&b->allocator_integrity.object_name,&b->allocator_counter.object_name,&b->allocator_counter.ak_name,&b->allocator_counter.salt_name,&b->allocator_counter.counter_name};
  for(size_t j=0;j<sizeof(distinct)/sizeof(distinct[0]);j++)if(distinct[j]->size==34&&!CRYPTO_memcmp(c->original_name.name,distinct[j]->name,34))return VEIL_STORE_MISMATCH;
  for(unsigned j=0;j<3;j++)if(b->objects[j].object_name.size==34&&!CRYPTO_memcmp(c->original_name.name,b->objects[j].object_name.name,34))return VEIL_STORE_MISMATCH;
 }
 if(!CRYPTO_memcmp(b->allocator_authorizers[0].administration_domain,b->allocator_authorizers[1].administration_domain,32)||!CRYPTO_memcmp(b->allocator_authorizers[0].original_name.name,b->allocator_authorizers[1].original_name.name,34))return VEIL_STORE_MISMATCH;
 for(unsigned i=0;i<2;i++){
  const ynx_tpm2_resource_selection*q=&b->command_auth[i];
  if(!q->device||q->object_name.size!=34)return VEIL_STORE_REQUIRED;
  if(q->monotonic_deadline_ns!=original->deadline)return VEIL_STORE_MISMATCH;
  const TPM2B_NAME*distinct[]={&b->allocator_integrity.object_name,&b->allocator_counter.object_name,&b->allocator_counter.ak_name,&b->allocator_counter.salt_name,&b->allocator_counter.counter_name,&b->allocator_authorizers[0].original_name,&b->allocator_authorizers[1].original_name};
  for(size_t j=0;j<sizeof(distinct)/sizeof(distinct[0]);j++)if(distinct[j]->size==34&&!CRYPTO_memcmp(q->object_name.name,distinct[j]->name,34))return VEIL_STORE_MISMATCH;
  for(unsigned j=0;j<3;j++)if(b->objects[j].object_name.size==34&&!CRYPTO_memcmp(q->object_name.name,b->objects[j].object_name.name,34))return VEIL_STORE_MISMATCH;
 }
 if(!CRYPTO_memcmp(b->command_auth[0].object_name.name,b->command_auth[1].object_name.name,34))return VEIL_STORE_MISMATCH;
 registry_allocation_owner*a=calloc(1,sizeof(*a));if(!a)return VEIL_STORE_SQL;a->original=*original;r->allocation=a;/* partial before first private resource call */
 veil_store_status s=primitive_status(ynx_tpm2_owner_open(&b->allocator_integrity,&a->integrity));if(s)return allocation_fail(a,s);
 s=primitive_status(ynx_tpm2_owner_open(&b->allocator_counter,&a->counter));if(s)return allocation_fail(a,s);
 for(unsigned i=0;i<2;i++){
  s=primitive_status(ynx_tpm2_owner_open(&b->command_auth[i],&a->command_auth[i]));if(s)return allocation_fail(a,s);
  s=primitive_status(ynx_tpm2_owner_unseal(a->command_auth[i]));if(s)return allocation_fail(a,s);
  s=primitive_status(ynx_tpm2_command_authorizer_open(&b->allocator_authorizers[i],a->command_auth[i],&a->authorizers[i]));if(s)return allocation_fail(a,s);
 }
 long page=sysconf(_SC_PAGESIZE);if(page<32)return allocation_fail(a,VEIL_STORE_SQL);a->pages=(size_t)page;a->key=mmap(NULL,a->pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);if(a->key==MAP_FAILED){a->key=NULL;return allocation_fail(a,VEIL_STORE_SQL);}
 if(mlock(a->key,a->pages))return allocation_fail(a,VEIL_STORE_UNKNOWN);a->locked=1;
 s=primitive_status(ynx_tpm2_owner_unseal(a->integrity));if(s)return allocation_fail(a,s);const uint8_t*borrow=NULL;size_t n=0;s=primitive_status(ynx_tpm2_owner_secret_borrow(a->integrity,&borrow,&n));if(s)return allocation_fail(a,s);a->borrowed=1;
 if(n!=32)return allocation_fail(a,VEIL_STORE_BOUND);memcpy(a->key,borrow,32);s=primitive_status(ynx_tpm2_owner_secret_release(a->integrity));if(s)return allocation_fail(a,s);a->borrowed=0;
 return allocation_current(r,a);
}
/* Exact authenticated compare/update of the pre-existing allocator row, never
 * INSERT/REPLACE, initialization from a counter, or a callback provider. */
static veil_store_status allocation_persist(registry_resource_owner*r,registry_allocation_owner*a,const ynx_allocator_journal*previous,const ynx_allocator_journal*next){
 unsigned char old[YNX_ALLOCATOR_JOURNAL_BYTES],raw[YNX_ALLOCATOR_JOURNAL_BYTES];veil_store_status s=ynx_allocator_journal_encode(a->key,previous,old);if(s)return s;s=ynx_allocator_journal_encode(a->key,next,raw);if(s){OPENSSL_cleanse(old,sizeof(old));return s;}
 sqlite3_stmt*st=NULL;if(sqlite3_prepare_v2(r->registry,"UPDATE allocator_journal SET original=?1 WHERE key_generation=?2 AND allocator=?3 AND original=?4",-1,&st,NULL)!=SQLITE_OK){s=VEIL_STORE_SQL;goto done;}
 if(sqlite3_bind_blob(st,1,raw,sizeof(raw),SQLITE_STATIC)!=SQLITE_OK||sqlite3_bind_int64(st,2,(sqlite3_int64)next->key_generation)!=SQLITE_OK||sqlite3_bind_blob(st,3,next->allocator,32,SQLITE_STATIC)!=SQLITE_OK||sqlite3_bind_blob(st,4,old,sizeof(old),SQLITE_STATIC)!=SQLITE_OK){s=VEIL_STORE_SQL;goto finalize;}
 s=sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(r->registry)==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
finalize:if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
done:OPENSSL_cleanse(old,sizeof(old));OPENSSL_cleanse(raw,sizeof(raw));return s;
}
static veil_store_status execution_prepare_ordinal(ynx_administration_execution_loan*,registry_resource_owner*,ynx_original_bytes,uint64_t*);
static veil_store_status allocation_prepare(registry_resource_owner*r,ynx_original_bytes intent,ynx_administration_execution_loan*decision){
 veil_store_status s=allocation_acquire(r);if(s)return s;registry_allocation_owner*a=r->allocation;
 if(a->unknown||a->entered)return VEIL_STORE_UNKNOWN;
 uint64_t reserved=0;s=execution_prepare_ordinal(decision,r,intent,&reserved);if(s)return s;
 unsigned char digest[32];memcpy(digest,intent.data,32);
 if(a->original.ordinal==UINT64_MAX||reserved!=a->original.ordinal+1)return VEIL_STORE_MISMATCH;
 if(a->prepared_durable)return CRYPTO_memcmp(digest,a->request,32)?VEIL_STORE_MISMATCH:allocation_current(r,a);
 /* Independent original ordinal is retained, NOT incremented/predicted here.
  * PREPARED is no allocation proof. GCM is unreachable at this phase. */
 unsigned char old[YNX_ALLOCATOR_JOURNAL_BYTES];s=ynx_allocator_journal_encode(a->key,&a->original,old);if(s)return s;
 ynx_allocator_journal prepared={0};s=ynx_allocator_journal_transition(a->key,(ynx_original_bytes){old,sizeof(old)},&a->original,digest,1,&prepared);OPENSSL_cleanse(old,sizeof(old));
 if(s)return allocation_fail(a,s);
 /* The ordinal is taken from the same protected domain decision, not the
  * NV response. The arithmetic above only checks continuity against the
  * separately authenticated previous allocator original. */
 prepared.ordinal=reserved;a->prepared=prepared;OPENSSL_cleanse(&prepared,sizeof(prepared));memcpy(a->request,digest,32);
 s=registry_compare_begin(r);if(s)return allocation_fail(a,s);
 s=allocation_current(r,a);if(s)return s;
 s=allocation_persist(r,a,&a->original,&a->prepared);if(s)return allocation_fail(a,s);
 if(sqlite3_exec(r->registry,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(r->registry))return allocation_fail(a,VEIL_STORE_UNKNOWN);
 r->transaction=0;a->prepared_durable=1;s=allocation_current(r,a);return s;
}
static void allocation_observe_entered(registry_resource_owner*r){
 registry_allocation_owner*a=r->allocation;if(!a||!a->entered||a->observation_entered||!a->counter)return;
 /* Same retained counter only; no reopen, increment or newly selected budget.
  * Partial TPM allocations are adopted into this child BEFORE interpreting the
  * return. Observation remains unverified and does not clear UNKNOWN. */
 unsigned char journal[YNX_ALLOCATOR_JOURNAL_BYTES],preimage[sizeof("YNX/PRIVATE/ALLOCATOR/BURN-OBSERVATION/V1")+32+32];
 veil_store_status s=ynx_allocator_journal_encode(a->key,&a->prepared,journal);if(s){allocation_fail(a,s);return;}
 static const unsigned char label[]="YNX/PRIVATE/ALLOCATOR/BURN-OBSERVATION/V1";
 memcpy(preimage,label,sizeof(label));memcpy(preimage+sizeof(label),a->request,32);
 if(!SHA256(journal,sizeof(journal),preimage+sizeof(label)+32)){OPENSSL_cleanse(journal,sizeof(journal));OPENSSL_cleanse(preimage,sizeof(preimage));allocation_fail(a,VEIL_STORE_UNKNOWN);return;}
 TPM2B_DATA challenge={.size=32};if(!SHA256(preimage,sizeof(preimage),challenge.buffer)){OPENSSL_cleanse(journal,sizeof(journal));OPENSSL_cleanse(preimage,sizeof(preimage));allocation_fail(a,VEIL_STORE_UNKNOWN);return;}
 OPENSSL_cleanse(journal,sizeof(journal));OPENSSL_cleanse(preimage,sizeof(preimage));a->observation_entered=1;
 s=primitive_status(ynx_tpm2_owner_certify(a->counter,&challenge,&a->burn_attestation,&a->burn_signature));
 if(s)allocation_fail(a,s);
 /* No ordinal is extracted/published here. Real independent signature/current
  * and original-head/floor adjudication must consume these exact originals. */
}
static void allocation_observe_journal(registry_resource_owner*r){
 registry_allocation_owner*a=r?r->allocation:NULL;if(!a||!a->entered||!a->prepared_durable||!a->key||!a->locked)return;
 /* UNKNOWN permits same-original read-only adjudication inputs, not current
  * readiness. The original deadline/policy/resource fences still apply. No
  * mutation, reopen, nonce extraction, phase reset or new request is possible. */
 veil_store_status s=registry_fence_current(r);if(s){allocation_fail(a,s);return;}
 s=primitive_status(ynx_tpm2_owner_current(a->integrity));if(s){allocation_fail(a,s);return;}
 s=allocation_read_originals(r,a,&a->prepared,a->entered_original_retained?&a->entered_original:NULL);if(s){allocation_fail(a,s);return;}
 s=registry_fence_current(r);if(s){allocation_fail(a,s);return;}
 a->journal_observed=1;/* observation only; UNKNOWN and first cause unchanged */
}
static veil_store_status execution_burn_current(ynx_administration_execution_loan *,registry_resource_owner *);
static veil_store_status allocation_enter_burn(registry_resource_owner*r,ynx_administration_execution_loan *decision){
 registry_allocation_owner*a=r->allocation;if(!a||!a->prepared_durable)return VEIL_STORE_REQUIRED;
 if(a->unknown||a->entered)return VEIL_STORE_UNKNOWN;
 if(a->prepared.phase!=1||a->original.ordinal==UINT64_MAX||a->prepared.sequence==UINT64_MAX)return VEIL_STORE_BOUND;
 veil_store_status s=allocation_current(r,a);if(s)return s;
 if(decision){s=execution_burn_current(decision,r);if(s)return allocation_fail(a,s);}
 ynx_allocator_journal entered={0};
 unsigned char prior[YNX_ALLOCATOR_JOURNAL_BYTES];s=ynx_allocator_journal_encode(a->key,&a->prepared,prior);if(s)return s;
 s=ynx_allocator_journal_transition(a->key,(ynx_original_bytes){prior,sizeof(prior)},&a->prepared,a->request,2,&entered);OPENSSL_cleanse(prior,sizeof(prior));if(s)return allocation_fail(a,s);
 s=registry_compare_begin(r);if(s)return allocation_fail(a,s);
 s=allocation_current(r,a);if(s)return s;
 /* Adopt the irreversible phase write BEFORE calling SQL. A write/commit or
  * late current refusal may leave phase2 durable even when no TPM mutation
  * was reached. This same original cannot enter/burn again, including a late
  * Required result; recovery is observation only and keeps the first cause. */
 a->entered_original=entered;a->entered_original_retained=1;
 a->entered=1;
 s=allocation_persist(r,a,&a->prepared,&a->entered_original);if(s)return allocation_fail(a,s);
 if(sqlite3_exec(r->registry,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(r->registry))return allocation_fail(a,VEIL_STORE_UNKNOWN);
 r->transaction=0;a->prepared=entered;
 s=allocation_current(r,a);if(s)return s;
 /* Persisted phase2 precedes the TPM mutator. An entered restart is observable
  * but NEVER runnable again. The actual returned counter is not used as nonce
  * and expected+1 is not synthesized into an allocated receipt. */
 s=primitive_status(ynx_tpm2_owner_increment_signed_once(a->counter,a->authorizers[0],a->authorizers[1]));
 if(s){veil_store_status result=allocation_fail(a,s);allocation_observe_entered(r);return result;}
 allocation_observe_entered(r);if(a->unknown)return VEIL_STORE_UNKNOWN;
 /* Even a future mutator's known success must be independently adjudicated
  * against this original intent/key/head/floor before publication or GCM. */
 /* OK here is only known mutator completion under the original retained
  * decision. The caller still must verify/adjudicate the burn before GCM. */
 if(decision)return execution_burn_current(decision,r);
 return allocation_fail(a,VEIL_STORE_REQUIRED);
}
static veil_store_status allocation_close(registry_allocation_owner**owner){
 registry_allocation_owner*a=*owner;if(!a)return VEIL_STORE_OK;
 if(a->burn_attestation){Esys_Free(a->burn_attestation);a->burn_attestation=NULL;}if(a->burn_signature){Esys_Free(a->burn_signature);a->burn_signature=NULL;}
 if(a->key){OPENSSL_cleanse(a->key,a->pages);if(a->locked){if(munlock(a->key,a->pages))return allocation_fail(a,VEIL_STORE_UNKNOWN);a->locked=0;}if(munmap(a->key,a->pages))return allocation_fail(a,VEIL_STORE_UNKNOWN);a->key=NULL;}
 if(a->integrity){if(a->borrowed){veil_store_status s=primitive_status(ynx_tpm2_owner_secret_release(a->integrity));if(s)return allocation_fail(a,s);a->borrowed=0;}ynx_tpm2_owner*original=a->integrity;veil_store_status s=primitive_status(ynx_tpm2_owner_close(&a->integrity));if(a->integrity&&a->integrity!=original)abort();if(s||a->integrity)return allocation_fail(a,s?s:VEIL_STORE_UNKNOWN);}
 if(a->counter){ynx_tpm2_owner*original=a->counter;veil_store_status s=primitive_status(ynx_tpm2_owner_close(&a->counter));if(a->counter&&a->counter!=original)abort();if(s||a->counter)return allocation_fail(a,s?s:VEIL_STORE_UNKNOWN);}
 for(unsigned i=0;i<2;i++)if(a->authorizers[i]){ynx_tpm2_command_authorizer*original=a->authorizers[i];veil_store_status s=primitive_status(ynx_tpm2_command_authorizer_close(&a->authorizers[i]));if(a->authorizers[i]&&a->authorizers[i]!=original)abort();if(s||a->authorizers[i])return allocation_fail(a,s?s:VEIL_STORE_UNKNOWN);}
 for(unsigned i=0;i<2;i++)if(a->command_auth[i]){ynx_tpm2_owner*original=a->command_auth[i];veil_store_status s=primitive_status(ynx_tpm2_owner_close(&a->command_auth[i]));if(a->command_auth[i]&&a->command_auth[i]!=original)abort();if(s||a->command_auth[i])return allocation_fail(a,s?s:VEIL_STORE_UNKNOWN);}
 int unresolved=a->unknown||a->entered;
 OPENSSL_cleanse(a,sizeof(*a));free(a);*owner=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
static veil_store_status resource_close(registry_resource_owner **owner){
 registry_resource_owner *r=*owner;if(!r)return VEIL_STORE_OK;
 veil_store_status allocation_status=allocation_close(&r->allocation);if(allocation_status||r->allocation)return resource_fail(r,allocation_status?allocation_status:VEIL_STORE_UNKNOWN);
 if(r->registry){
  /* Ambiguous protected effects are never silently retried. ROLLBACK only
   * disposes an extant local transaction; it is not durable adjudication. */
  if(r->transaction&&!sqlite3_get_autocommit(r->registry)){if(sqlite3_exec(r->registry,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK)return resource_fail(r,VEIL_STORE_UNKNOWN);}
  r->transaction=0;if(sqlite3_close(r->registry)!=SQLITE_OK)return resource_fail(r,VEIL_STORE_UNKNOWN);r->registry=NULL;
 }
 if(r->store_watch){veil_store_status dropped=veil_custody_watch_drop(&r->store_watch);if(dropped||r->store_watch)return resource_fail(r,dropped?dropped:VEIL_STORE_UNKNOWN);}
 if(r->keys){OPENSSL_cleanse(r->keys,r->key_pages);if(r->keys_locked){if(munlock(r->keys,r->key_pages))return resource_fail(r,VEIL_STORE_UNKNOWN);r->keys_locked=0;}if(munmap(r->keys,r->key_pages))return resource_fail(r,VEIL_STORE_UNKNOWN);r->keys=NULL;}
 for(size_t i=3;i>0;i--){if(!r->objects[i-1])continue;if(r->borrowed[i-1]){veil_store_status release=primitive_status(ynx_tpm2_owner_secret_release(r->objects[i-1]));if(release)return resource_fail(r,release);r->borrowed[i-1]=0;}ynx_tpm2_owner *original=r->objects[i-1];int raw=ynx_tpm2_owner_close(&r->objects[i-1]);veil_store_status status=primitive_status(raw);if(r->objects[i-1]&&r->objects[i-1]!=original)abort();if(status&&!r->objects[i-1]&&status!=VEIL_STORE_UNKNOWN)abort();if(status||r->objects[i-1])return resource_fail(r,status?status:VEIL_STORE_UNKNOWN);}
 if(r->source_locked){if(pthread_mutex_unlock(&registry_source_lock))return resource_fail(r,VEIL_STORE_UNKNOWN);r->source_locked=0;}
 if(r->authority_locked){if(pthread_mutex_unlock(&registry_authority_lock))return resource_fail(r,VEIL_STORE_UNKNOWN);r->authority_locked=0;}
 if(r->fence){OPENSSL_cleanse(r->fence,sizeof(*r->fence));free(r->fence);r->fence=NULL;}
 int unresolved=r->unknown;
 OPENSSL_cleanse(r,sizeof(*r));free(r);*owner=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
static veil_store_status resource_acquire(ynx_original_bytes row,const unsigned char names[3][34],const uint32_t kinds[3],const ynx_administration_head_expectation *expected,registry_resource_owner **out){
 unsigned char digest[32];SHA256(row.data,row.size,digest);size_t count=0;const registry_resource_binding *all=registered_resource_bindings(&count),*selected=NULL;
 for(size_t i=0;i<count;i++)if(!CRYPTO_memcmp(digest,all[i].row_digest,32)&&all[i].expected.generation==expected->generation&&!CRYPTO_memcmp(all[i].expected.head,expected->head,32)){if(selected)return VEIL_STORE_MISMATCH;selected=&all[i];}
 if(!selected)return VEIL_STORE_REQUIRED;
 for(size_t i=0;i<3;i++)if(kinds[i]!=1||selected->objects[i].object_name.size!=34||CRYPTO_memcmp(selected->objects[i].object_name.name,names[i],34))return VEIL_STORE_MISMATCH;
 for(size_t i=0;i<3;i++)for(size_t j=0;j<i;j++){if(selected->objects[i].object_name.size==selected->objects[j].object_name.size&&!CRYPTO_memcmp(selected->objects[i].object_name.name,selected->objects[j].object_name.name,selected->objects[i].object_name.size))return VEIL_STORE_MISMATCH;}
 veil_store_status s=primitive_status(ynx_source_dedicated_protection_enter());if(s)return s;
 registry_resource_owner *r=calloc(1,sizeof(*r));if(!r)return VEIL_STORE_SQL;r->binding=selected;r->active_head=selected->head_envelope;*out=r;
 /* Real independently selected object/session owners are adopted BEFORE late
  * current/Unseal checks; no wrapping key, borrowed raw pointer or callback. */
 for(size_t i=0;i<3;i++){s=primitive_status(ynx_tpm2_owner_open(&selected->objects[i],&r->objects[i]));if(s)return resource_fail(r,s);}
 long page=sysconf(_SC_PAGESIZE);if(page<64)return resource_fail(r,VEIL_STORE_SQL);r->key_pages=(size_t)page;
 r->keys=mmap(NULL,r->key_pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);if(r->keys==MAP_FAILED){r->keys=NULL;return resource_fail(r,VEIL_STORE_SQL);}if(mlock(r->keys,r->key_pages))return resource_fail(r,VEIL_STORE_UNKNOWN);r->keys_locked=1;
 for(size_t i=1;i<3;i++){s=primitive_status(ynx_tpm2_owner_unseal(r->objects[i]));if(s)return resource_fail(r,s);const uint8_t *key=NULL;size_t n=0;s=primitive_status(ynx_tpm2_owner_secret_borrow(r->objects[i],&key,&n));if(s)return resource_fail(r,s);r->borrowed[i]=1;if(n!=32){int release=ynx_tpm2_owner_secret_release(r->objects[i]);if(!release)r->borrowed[i]=0;return resource_fail(r,release?primitive_status(release):VEIL_STORE_BOUND);}memcpy(r->keys+(i-1)*32,key,32);s=primitive_status(ynx_tpm2_owner_secret_release(r->objects[i]));if(s)return resource_fail(r,s);r->borrowed[i]=0;}
 s=registry_open(r);if(s)return resource_fail(r,s);return resource_current(r);
}
/* Private same-thread provisioning attempt inventory. Presence recognizes
 * custody, NEVER successful registration or an administration grant. */
struct ynx_administration_owner{
 pthread_t thread;void *startup;uint32_t role;
 unsigned char *row,*operation;size_t row_size,operation_size;
 ynx_administration_head_expectation expected;registry_resource_owner *resource;
 veil_store_status first;int unknown,policy_selected,commit_started;
 size_t execution_children;ynx_original_executor *registration_executor;
 struct ynx_administration_owner *next;
};
static pthread_mutex_t inventory_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_administration_owner *inventory;
static ynx_administration_owner *recognize(ynx_administration_owner *p){pthread_mutex_lock(&inventory_lock);ynx_administration_owner *q=inventory;while(q&&q!=p)q=q->next;pthread_mutex_unlock(&inventory_lock);return q;}
static veil_store_status fail(ynx_administration_owner *p,veil_store_status s,int uncertainty){if(p->first==VEIL_STORE_OK)p->first=s;if(uncertainty)p->unknown=1;return p->unknown?VEIL_STORE_UNKNOWN:s;}
veil_store_status ynx_administration_current(ynx_administration_owner *p){
 if(!recognize(p))return VEIL_STORE_REQUIRED;if(!pthread_equal(p->thread,pthread_self()))return VEIL_STORE_THREAD;if(p->unknown){allocation_observe_journal(p->resource);return VEIL_STORE_UNKNOWN;}
 veil_store_status s=(veil_store_status)ynx_sdk_server_startup_current_v1(p->startup,p->role);if(s)return fail(p,s,s!=VEIL_STORE_REQUIRED);
 ynx_administration_head_expectation now={0};s=(veil_store_status)ynx_sdk_server_administration_policy_current_v1(p->startup,p->role,&now);if(s)return fail(p,s,s!=VEIL_STORE_REQUIRED);
 if(p->policy_selected&&(now.generation!=p->expected.generation||CRYPTO_memcmp(now.head,p->expected.head,32)))return fail(p,VEIL_STORE_MISMATCH,1);
 if(!p->policy_selected){p->expected=now;p->policy_selected=1;}
 s=resource_current(p->resource);
 if(s){veil_store_status cause=p->resource&&p->resource->first?p->resource->first:s;return fail(p,cause,(p->resource&&p->resource->unknown)||s!=VEIL_STORE_REQUIRED);}
 if(p->resource->allocation){s=allocation_current(p->resource,p->resource->allocation);if(s){registry_allocation_owner*a=p->resource->allocation;return fail(p,a->first?a->first:s,a->unknown||s!=VEIL_STORE_REQUIRED);}}
 return VEIL_STORE_OK;
}
veil_store_status ynx_administration_acquire(void *startup,uint32_t role,ynx_original_bytes row,ynx_administration_owner **out){
 if(!out||*out||!row.data||!row.size||row.size>28u+15u*(4u+65536u)||role<1||role>2)return VEIL_STORE_BOUND;
 veil_store_status s=(veil_store_status)ynx_sdk_server_startup_recognize_v1(startup,role);if(s)return s;
 ynx_server_registered_original_borrow raw={0};s=(veil_store_status)ynx_sdk_server_registered_originals_borrow_v1(startup,&raw);if(s)return s;
 if(raw.row.size!=row.size||CRYPTO_memcmp(raw.row.data,row.data,row.size))return VEIL_STORE_MISMATCH;
 ynx_administration_owner *p=calloc(1,sizeof(*p));if(!p)return VEIL_STORE_REQUIRED;p->row=malloc(row.size);if(!p->row){free(p);return VEIL_STORE_REQUIRED;}memcpy(p->row,row.data,row.size);p->row_size=row.size;p->startup=startup;p->role=role;p->thread=pthread_self();
 pthread_mutex_lock(&inventory_lock);p->next=inventory;inventory=p;pthread_mutex_unlock(&inventory_lock);*out=p;
 /* Adopt the original partial before policy/current late fences. Empty policy
  * leaves this exact owner for cleanup; it cannot be reacquired as admission. */
 s=ynx_administration_current(p);if(s!=VEIL_STORE_REQUIRED)return s;
 if(!p->policy_selected)return s;
 s=resource_acquire((ynx_original_bytes){p->row,p->row_size},raw.names,raw.kinds,&p->expected,&p->resource);
 if(s){veil_store_status cause=p->resource&&p->resource->first?p->resource->first:s;return fail(p,cause,(p->resource&&p->resource->unknown)||s!=VEIL_STORE_REQUIRED);}
 return ynx_administration_current(p);
}
veil_store_status ynx_administration_original(ynx_administration_owner *p,ynx_original_bytes *out){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,sizeof(*out));veil_store_status s=ynx_administration_current(p);if(s)return s;
 ynx_original_bytes original={p->row,p->row_size};s=ynx_administration_current(p);if(s)return s;*out=original;return VEIL_STORE_OK;
}
veil_store_status ynx_administration_registration_commit(ynx_administration_owner *p,ynx_original_bytes operation){
 if(!recognize(p))return VEIL_STORE_REQUIRED;if(!pthread_equal(p->thread,pthread_self()))return VEIL_STORE_THREAD;if(p->unknown)return VEIL_STORE_UNKNOWN;
 if(!operation.data||!operation.size||operation.size>65536)return VEIL_STORE_BOUND;
 /* Persist only the exact public intent derived from this original owner.
  * Calling this private symbol with a different version/role/head/full row
  * is not a way to insert arbitrary data into the selected registry. */
 unsigned char row_digest[32];if(!SHA256(p->row,p->row_size,row_digest))return fail(p,VEIL_STORE_UNKNOWN,1);
 if(operation.size!=88||memcmp(operation.data,"YNXARE1\0",8)||operation.data[8]||operation.data[9]!=1||operation.data[10]||operation.data[11]!=1||operation.data[12]||operation.data[13]||operation.data[14]||operation.data[15]!=p->role||registry_u64(operation.data+16)!=p->expected.generation||CRYPTO_memcmp(operation.data+24,p->expected.head,32)||CRYPTO_memcmp(operation.data+56,row_digest,32))return VEIL_STORE_MISMATCH;
 if(p->operation){if(p->operation_size!=operation.size||CRYPTO_memcmp(p->operation,operation.data,operation.size))return VEIL_STORE_MISMATCH;if(p->commit_started||p->registration_executor)return p->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_DUPLICATE;}
 if(!p->operation){p->operation=malloc(operation.size);if(!p->operation)return VEIL_STORE_REQUIRED;memcpy(p->operation,operation.data,operation.size);p->operation_size=operation.size;}
 /* Immutable exact intent is retained before a late current/resource refusal.
  * Re-entry may observe this same intent, never substitute a new operation. */
 veil_store_status s=ynx_administration_current(p);if(s)return s;
 /* Normal provisioning now owns an actual existing SQL transaction and an
  * authenticated original head under the retained selected resource/current
  * loan. This is preflight only; no durable nonce or effect is fabricated. */
 s=registry_fence_acquire(p->resource,p->startup,p->role);if(s)return fail(p,s,s!=VEIL_STORE_REQUIRED);
 if(!p->resource->transaction&&!p->resource->intent_durable){s=registry_compare_begin(p->resource);if(s)return fail(p,p->resource->first?p->resource->first:s,p->resource->unknown||s!=VEIL_STORE_REQUIRED);}
 s=registry_intent_persist(p->resource,(ynx_original_bytes){p->operation,p->operation_size});
 if(s)return fail(p,p->resource->first?p->resource->first:s,p->resource->unknown||s!=VEIL_STORE_REQUIRED);
 /* The normal registration caller owns the same independent domain loan;
  * it never supplies NULL as the burn decision or creates a second request.
  * Publish the partial executor before interpreting late acquisition status. */
 s=ynx_original_executor_acquire(p,(ynx_original_bytes){p->operation,p->operation_size},p->resource->binding->allocator_original.deadline,&p->registration_executor);
 if(s)return fail(p,s,s!=VEIL_STORE_REQUIRED);
 p->commit_started=1;
 for(ynx_executor_phase phase=YNX_EXEC_ENTERED;phase<=YNX_EXEC_TERMINAL;phase++){
  s=ynx_original_executor_advance(p->registration_executor,phase,(ynx_original_bytes){0});
  if(s)return fail(p,s,s!=VEIL_STORE_REQUIRED);
 }
 return ynx_administration_current(p);
}
veil_store_status ynx_administration_register_original(ynx_administration_owner *p){
 veil_store_status s=ynx_administration_current(p);if(s)return s;
 unsigned char operation[88]={0};memcpy(operation,"YNXARE1\0",8);operation[9]=1;operation[11]=1;
 operation[15]=(unsigned char)p->role;uint64_t generation=p->expected.generation;
 for(unsigned i=0;i<8;i++)operation[16+i]=(unsigned char)(generation>>(56-8*i));
 memcpy(operation+24,p->expected.head,32);if(!SHA256(p->row,p->row_size,operation+56))return fail(p,VEIL_STORE_UNKNOWN,1);
 return ynx_administration_registration_commit(p,(ynx_original_bytes){operation,sizeof(operation)});
}
veil_store_status ynx_administration_close(ynx_administration_owner **owner){
 if(!owner)return VEIL_STORE_BOUND;ynx_administration_owner *p=*owner;if(!p)return VEIL_STORE_OK;if(!recognize(p))return VEIL_STORE_REQUIRED;if(!pthread_equal(p->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(p->registration_executor){ynx_original_executor*original=p->registration_executor;veil_store_status s=ynx_original_executor_close(&p->registration_executor);if(p->registration_executor&&p->registration_executor!=original)abort();if(s&&!p->registration_executor&&s!=VEIL_STORE_UNKNOWN)abort();if(s)fail(p,s,1);if(p->registration_executor)return fail(p,s?s:VEIL_STORE_UNKNOWN,1);}
 if(p->execution_children)return VEIL_STORE_FROZEN;
 veil_store_status resource_status=resource_close(&p->resource);
 if(resource_status||p->resource){veil_store_status cause=p->resource&&p->resource->first?p->resource->first:(resource_status?resource_status:VEIL_STORE_UNKNOWN);return fail(p,cause,1);}
 /* This child only borrowed the parent's startup; never release/reacquire it.
  * Original SQL/key/floor partials have been disposed before releasing RAM. */
 pthread_mutex_lock(&inventory_lock);ynx_administration_owner **q=&inventory;while(*q&&*q!=p)q=&(*q)->next;if(*q)*q=p->next;pthread_mutex_unlock(&inventory_lock);
 int unresolved=p->unknown;
 if(p->row){OPENSSL_cleanse(p->row,p->row_size);free(p->row);}if(p->operation){OPENSSL_cleanse(p->operation,p->operation_size);free(p->operation);}OPENSSL_cleanse(p,sizeof(*p));free(p);*owner=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}

struct ynx_administration_execution_loan {
 pthread_t thread;ynx_administration_owner *parent;uint64_t deadline,observed_monotonic_ns;
 sqlite3 *domain[2];veil_custody_watch *watch[2];ynx_tpm2_owner *integrity[2],*floor[2];
 unsigned char *keys;size_t pages;int locked,borrowed[2],transaction[2];
 ynx_domain_state state[2];unsigned char originals[2][YNX_DOMAIN_STATE_BYTES],intent[32];
 uint32_t phase;veil_store_status first;int unknown,reservation_started;
 int burn_invoked,proof_invoked,proof_verified;TPM2B_ATTEST *quote,*certify;TPMT_SIGNATURE *quote_signature,*certify_signature;
 TPM2B_DATA challenge;ynx_storage_ciphertext sealed;int cas_invoked,local_committed;
 struct ynx_administration_execution_loan *next;
};
static ynx_administration_execution_loan *execution_loans;
static ynx_administration_execution_loan *execution_loan_recognize(ynx_administration_execution_loan*p){pthread_mutex_lock(&inventory_lock);ynx_administration_execution_loan*q=execution_loans;while(q&&q!=p)q=q->next;pthread_mutex_unlock(&inventory_lock);return q;}
static veil_store_status execution_loan_fail(ynx_administration_execution_loan*p,veil_store_status s){if(!p->first)p->first=s;if(p->reservation_started||s!=VEIL_STORE_REQUIRED)p->unknown=1;return p->unknown?VEIL_STORE_UNKNOWN:s;}
veil_store_status ynx_private_domain_journal_read(sqlite3*db,const unsigned char identity[32],unsigned char out[YNX_DOMAIN_STATE_BYTES]){
 if(!db||!identity||!out)return VEIL_STORE_BOUND;
 sqlite3_stmt*st=NULL;unsigned char retained[YNX_DOMAIN_STATE_BYTES];
 if(sqlite3_prepare_v2(db,"SELECT original FROM domain_execution WHERE key_identity=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_MISMATCH;
 if(sqlite3_bind_blob(st,1,identity,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW&&sqlite3_column_type(st,0)==SQLITE_BLOB&&sqlite3_column_bytes(st,0)==YNX_DOMAIN_STATE_BYTES){
  const unsigned char*b=sqlite3_column_blob(st,0);if(b){memcpy(retained,b,sizeof(retained));if(sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;}
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s)memcpy(out,retained,sizeof(retained));OPENSSL_cleanse(retained,sizeof(retained));return s;
}
veil_store_status ynx_private_domain_journal_apply(sqlite3*db,const unsigned char identity[32],const unsigned char previous[YNX_DOMAIN_STATE_BYTES],const unsigned char next[YNX_DOMAIN_STATE_BYTES]){
 if(!db||!identity||!previous||!next)return VEIL_STORE_BOUND;
 /* Never starts, commits, retries or releases the owning transaction. */
 if(sqlite3_get_autocommit(db))return VEIL_STORE_FROZEN;
 sqlite3_stmt*st=NULL;if(sqlite3_prepare_v2(db,"UPDATE domain_execution SET original=?1 WHERE key_identity=?2 AND original=?3",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_SQL;
 if(sqlite3_bind_blob(st,1,next,YNX_DOMAIN_STATE_BYTES,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_blob(st,2,identity,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_blob(st,3,previous,YNX_DOMAIN_STATE_BYTES,SQLITE_STATIC)==SQLITE_OK)
  s=sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(db)==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;return s;
}
static veil_store_status domain_read(ynx_administration_execution_loan*p,unsigned d,unsigned char out[YNX_DOMAIN_STATE_BYTES],ynx_domain_state*state){
 veil_store_status s=veil_custody_watch_check(p->domain[d],p->watch[d]);if(s)return s;
 unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state decoded={0};
 s=ynx_private_domain_journal_read(p->domain[d],p->state[d].key_identity,raw);
 if(!s)s=ynx_domain_state_decode(p->keys+32*d,(ynx_original_bytes){raw,sizeof(raw)},&decoded);
 if(!s){memcpy(out,raw,sizeof(raw));*state=decoded;}
 OPENSSL_cleanse(raw,sizeof(raw));OPENSSL_cleanse(&decoded,sizeof(decoded));return s;
}
static veil_store_status domain_owner_current(ynx_administration_execution_loan*p){
 if(!recognize(p->parent))return VEIL_STORE_REQUIRED;veil_store_status s=ynx_administration_current(p->parent);if(s)return s;
 if(!p->locked||!p->keys)return VEIL_STORE_REQUIRED;
 for(unsigned d=0;d<2;d++){if(!p->integrity[d]||!p->floor[d]||!p->domain[d])return VEIL_STORE_REQUIRED;s=primitive_status(ynx_tpm2_owner_current(p->integrity[d]));if(s)return s;s=primitive_status(ynx_tpm2_owner_current(p->floor[d]));if(s)return s;}
 return ynx_administration_current(p->parent);
}
static veil_store_status execution_loan_time_current(ynx_administration_execution_loan*q){
 struct timespec t;
 if(clock_gettime(CLOCK_MONOTONIC,&t)||t.tv_sec<0||t.tv_nsec<0||t.tv_nsec>=1000000000L||
  (uint64_t)t.tv_sec>(UINT64_MAX-(uint64_t)t.tv_nsec)/1000000000u)
  return execution_loan_fail(q,VEIL_STORE_LIFETIME);
 uint64_t now=(uint64_t)t.tv_sec*1000000000u+(uint64_t)t.tv_nsec;
 if(now>=q->deadline||now<q->observed_monotonic_ns)
  return execution_loan_fail(q,VEIL_STORE_LIFETIME);
 q->observed_monotonic_ns=now;return VEIL_STORE_OK;
}
veil_store_status ynx_administration_execution_current(ynx_administration_execution_loan*p){
 ynx_administration_execution_loan*q=execution_loan_recognize(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;if(q->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status s=execution_loan_time_current(q);if(s)return s;
 s=domain_owner_current(q);if(s)return execution_loan_fail(q,s);
 for(unsigned d=0;d<2;d++){unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state observed={0};s=domain_read(q,d,raw,&observed);int same=!s&&!CRYPTO_memcmp(raw,q->originals[d],sizeof(raw));OPENSSL_cleanse(raw,sizeof(raw));OPENSSL_cleanse(&observed,sizeof(observed));if(!same)return execution_loan_fail(q,s?s:VEIL_STORE_MISMATCH);}
 s=domain_owner_current(q);if(s)return execution_loan_fail(q,s);
 /* Physical owners and authenticated domain SQL can take time. Completion
  * must remain inside the SAME fixed budget; no renewal or rollback revival. */
 return execution_loan_time_current(q);
}
/* The actual domain producer serializes each mutation against its authenticated
 * full prior original, never overwrites/reinitializes an unknown/missing row.
 * Two commits are not called atomic: an interrupted half leaves durable pending
 * and original UNKNOWN. No timeout/cancel releases a pending participant. */
static veil_store_status domain_transition(ynx_administration_execution_loan*p,unsigned d,const ynx_domain_state*next){
 unsigned char raw[YNX_DOMAIN_STATE_BYTES];veil_store_status s=ynx_domain_state_encode(p->keys+32*d,next,raw);if(s)return s;
 if(sqlite3_exec(p->domain[d],"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;p->transaction[d]=1;
 s=domain_owner_current(p);if(s)goto done;
 s=ynx_private_domain_journal_apply(p->domain[d],p->state[d].key_identity,p->originals[d],raw);if(s)goto done;
 p->reservation_started=1;/* mark possible durable effect before COMMIT */
 if(sqlite3_exec(p->domain[d],"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(p->domain[d])){s=VEIL_STORE_UNKNOWN;goto done;}p->transaction[d]=0;
 p->state[d]=*next;memcpy(p->originals[d],raw,sizeof(raw));
 unsigned char readback[YNX_DOMAIN_STATE_BYTES];ynx_domain_state observed={0};s=domain_read(p,d,readback,&observed);if(!s&&CRYPTO_memcmp(raw,readback,sizeof(raw)))s=VEIL_STORE_MISMATCH;OPENSSL_cleanse(readback,sizeof(readback));OPENSSL_cleanse(&observed,sizeof(observed));if(!s)s=domain_owner_current(p);
 done:OPENSSL_cleanse(raw,sizeof(raw));return s;
}
static veil_store_status domain_binding_match(const registry_resource_binding*b){
 if(!b)return VEIL_STORE_REQUIRED;
 const ynx_allocator_journal*a=&b->allocator_original;
 for(unsigned d=0;d<2;d++){
  const ynx_domain_state*q=&b->domain_original[d];
  /* Complete private association ties each guardian to the SAME selected
   * storage generation/allocator/head. Distinct paths/MAC keys alone never
   * satisfy this binding, and no response or observed NV becomes Expected. */
  if(CRYPTO_memcmp(q->domain,b->allocator_authorizers[d].administration_domain,32)||CRYPTO_memcmp(q->key_identity,a->key_identity,32)||q->generation!=b->storage_generation||q->generation!=a->key_generation||q->epoch!=a->epoch||q->ordinal!=a->ordinal||q->floor!=a->floor||q->deadline!=a->deadline||CRYPTO_memcmp(q->head,b->expected.head,32)||CRYPTO_memcmp(q->registration,b->row_digest,32))return VEIL_STORE_MISMATCH;
 }
 return VEIL_STORE_OK;/* binding consistency only; acquire still checks owners */
}
veil_store_status ynx_administration_execution_acquire(ynx_administration_owner*a,ynx_original_bytes request,uint64_t deadline,ynx_administration_execution_loan**out){
 if(!out||*out||!request.data||!request.size||request.size>4194384||!deadline)return VEIL_STORE_BOUND;veil_store_status s=ynx_administration_current(a);if(s)return s;
 const registry_resource_binding*b=a->resource->binding;if(!b||!b->domain_store[0]||!b->domain_store[1])return VEIL_STORE_REQUIRED;
 s=domain_binding_match(b);if(s)return s;
 if(!strcmp(b->domain_store[0],b->domain_store[1])||!CRYPTO_memcmp(b->domain_original[0].domain,b->domain_original[1].domain,32)||CRYPTO_memcmp(b->domain_original[0].key_identity,b->domain_original[1].key_identity,32)||b->domain_original[0].generation!=b->domain_original[1].generation||b->domain_original[0].epoch!=b->domain_original[1].epoch||b->domain_original[0].ordinal!=b->domain_original[1].ordinal)return VEIL_STORE_MISMATCH;
 ynx_administration_execution_loan*p=calloc(1,sizeof(*p));if(!p)return VEIL_STORE_SQL;p->parent=a;p->deadline=deadline;p->thread=pthread_self();memcpy(p->state,b->domain_original,sizeof(p->state));
 if(!SHA256(request.data,request.size,p->intent)){free(p);return VEIL_STORE_UNKNOWN;}
 pthread_mutex_lock(&inventory_lock);p->next=execution_loans;execution_loans=p;a->execution_children++;*out=p;pthread_mutex_unlock(&inventory_lock);
 long pages=sysconf(_SC_PAGESIZE);if(pages<64)return execution_loan_fail(p,VEIL_STORE_SQL);p->pages=(size_t)pages;p->keys=mmap(NULL,p->pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);if(p->keys==MAP_FAILED){p->keys=NULL;return execution_loan_fail(p,VEIL_STORE_SQL);}if(mlock(p->keys,p->pages))return execution_loan_fail(p,VEIL_STORE_UNKNOWN);p->locked=1;
 for(unsigned d=0;d<2;d++){
  if(b->domain_integrity[d].object_name.size!=34||b->domain_floor[d].expected_counter!=b->domain_original[d].floor||b->domain_original[d].phase!=6||b->domain_original[d].sequence==UINT64_MAX||b->domain_original[d].ordinal==UINT64_MAX)return execution_loan_fail(p,VEIL_STORE_MISMATCH);
  for(unsigned j=0;j<d;j++)if(b->domain_integrity[d].object_name.size==b->domain_integrity[j].object_name.size&&!CRYPTO_memcmp(b->domain_integrity[d].object_name.name,b->domain_integrity[j].object_name.name,b->domain_integrity[d].object_name.size))return execution_loan_fail(p,VEIL_STORE_MISMATCH);
  s=primitive_status(ynx_tpm2_owner_open(&b->domain_integrity[d],&p->integrity[d]));if(s)return execution_loan_fail(p,s);s=primitive_status(ynx_tpm2_owner_open(&b->domain_floor[d],&p->floor[d]));if(s)return execution_loan_fail(p,s);
  s=primitive_status(ynx_tpm2_owner_unseal(p->integrity[d]));if(s)return execution_loan_fail(p,s);const unsigned char*key=NULL;size_t size=0;s=primitive_status(ynx_tpm2_owner_secret_borrow(p->integrity[d],&key,&size));if(s)return execution_loan_fail(p,s);p->borrowed[d]=1;if(size!=32)return execution_loan_fail(p,VEIL_STORE_BOUND);memcpy(p->keys+32*d,key,32);s=primitive_status(ynx_tpm2_owner_secret_release(p->integrity[d]));if(s)return execution_loan_fail(p,s);p->borrowed[d]=0;
  struct stat st;if(lstat(b->domain_store[d],&st)||!S_ISREG(st.st_mode)||(uint64_t)st.st_dev!=b->domain_device[d]||(uint64_t)st.st_ino!=b->domain_inode[d])return execution_loan_fail(p,VEIL_STORE_MISMATCH);
  s=veil_custody_watch_open(b->domain_store[d],&p->watch[d]);if(s)return execution_loan_fail(p,s);if(sqlite3_open_v2(b->domain_store[d],&p->domain[d],SQLITE_OPEN_READWRITE|SQLITE_OPEN_FULLMUTEX|SQLITE_OPEN_NOFOLLOW,NULL)!=SQLITE_OK)return execution_loan_fail(p,VEIL_STORE_SQL);if(sqlite3_exec(p->domain[d],"PRAGMA synchronous=FULL; PRAGMA busy_timeout=0",NULL,NULL,NULL)!=SQLITE_OK)return execution_loan_fail(p,VEIL_STORE_SQL);
  ynx_domain_state original={0};s=domain_read(p,d,p->originals[d],&original);unsigned char expected[YNX_DOMAIN_STATE_BYTES];if(!s)s=ynx_domain_state_encode(p->keys+32*d,&b->domain_original[d],expected);if(!s&&CRYPTO_memcmp(expected,p->originals[d],sizeof(expected)))s=VEIL_STORE_MISMATCH;OPENSSL_cleanse(expected,sizeof(expected));OPENSSL_cleanse(&original,sizeof(original));if(s)return execution_loan_fail(p,s);
 }
 s=domain_owner_current(p);if(s)return execution_loan_fail(p,s);
 for(unsigned d=0;d<2;d++){ynx_domain_state next=p->state[d];next.phase=1;next.sequence++;next.ordinal++;next.deadline=deadline;memcpy(next.intent,p->intent,32);memset(next.ciphertext,0,32);if(!SHA256(p->originals[d],YNX_DOMAIN_STATE_BYTES,next.predecessor))return execution_loan_fail(p,VEIL_STORE_UNKNOWN);s=domain_transition(p,d,&next);if(s)return execution_loan_fail(p,s);}
 p->phase=1;return ynx_administration_execution_current(p);
}
static veil_store_status domain_pair_write(ynx_administration_execution_loan*p,uint32_t phase,ynx_original_bytes evidence){
 for(unsigned d=0;d<2;d++){ynx_domain_state next=p->state[d];if(next.sequence==UINT64_MAX)return VEIL_STORE_BOUND;next.phase=phase;next.sequence++;
  if(!SHA256(p->originals[d],YNX_DOMAIN_STATE_BYTES,next.predecessor))return VEIL_STORE_UNKNOWN;
  if(evidence.size&&(!evidence.data||!SHA256(evidence.data,evidence.size,next.ciphertext)))return VEIL_STORE_BOUND;
  veil_store_status s=domain_transition(p,d,&next);if(s)return s;
 }p->phase=phase;return VEIL_STORE_OK;
}
static veil_store_status domain_burn_verify(ynx_administration_execution_loan*p){
 registry_resource_owner*r=p->parent->resource;registry_allocation_owner*a=r?r->allocation:NULL;
 if(!a||!p->burn_invoked||!a->counter||!r->binding->allocator_enrollment)return VEIL_STORE_REQUIRED;
 if(p->state[0].ordinal!=p->state[1].ordinal||p->state[0].ordinal!=a->prepared.ordinal)return VEIL_STORE_MISMATCH;
 if(p->proof_invoked)return VEIL_STORE_UNKNOWN;p->proof_invoked=1;
 unsigned char challenge[32+2*YNX_DOMAIN_STATE_BYTES];memcpy(challenge,p->intent,32);memcpy(challenge+32,p->originals[0],YNX_DOMAIN_STATE_BYTES);memcpy(challenge+32+YNX_DOMAIN_STATE_BYTES,p->originals[1],YNX_DOMAIN_STATE_BYTES);p->challenge.size=32;if(!SHA256(challenge,sizeof(challenge),p->challenge.buffer)){OPENSSL_cleanse(challenge,sizeof(challenge));return VEIL_STORE_UNKNOWN;}OPENSSL_cleanse(challenge,sizeof(challenge));
 /* Adopt each partial ESAPI allocation before inspecting status. No second
  * command on an ambiguous original. The Expected ordinal is the protected
  * domain decision retained before mutation, never the certify response. */
 veil_store_status s=primitive_status(ynx_tpm2_owner_quote(a->counter,&p->challenge,&p->quote,&p->quote_signature));
 if((s&&s!=VEIL_STORE_UNKNOWN)||!p->quote||!p->quote_signature)return s?s:VEIL_STORE_MISMATCH;
 if(s)execution_loan_fail(p,s);
 s=primitive_status(ynx_tpm2_owner_certify(a->counter,&p->challenge,&p->certify,&p->certify_signature));
 if((s&&s!=VEIL_STORE_UNKNOWN)||!p->certify||!p->certify_signature)return s?s:VEIL_STORE_MISMATCH;
 if(s)execution_loan_fail(p,s);
 unsigned char q[8192],qs[8192],n[8192],ns[8192];size_t qn=0,qsn=0,nn=0,nsn=0;
 if(Tss2_MU_TPM2B_ATTEST_Marshal(p->quote,q,sizeof(q),&qn)||Tss2_MU_TPMT_SIGNATURE_Marshal(p->quote_signature,qs,sizeof(qs),&qsn)||Tss2_MU_TPM2B_ATTEST_Marshal(p->certify,n,sizeof(n),&nn)||Tss2_MU_TPMT_SIGNATURE_Marshal(p->certify_signature,ns,sizeof(ns),&nsn))return VEIL_STORE_MISMATCH;
 ynx_message_attestation_input input={r->binding->allocator_enrollment,{q,qn},{qs,qsn},{n,nn},{ns,nsn},&p->challenge,p->state[0].ordinal};
 int result=ynx_message_enrollment_verify_attestations(&input);OPENSSL_cleanse(q,sizeof(q));OPENSSL_cleanse(qs,sizeof(qs));OPENSSL_cleanse(n,sizeof(n));OPENSSL_cleanse(ns,sizeof(ns));if(result)return result==YNX_TPM2_REQUIRED?VEIL_STORE_REQUIRED:VEIL_STORE_MISMATCH;
 p->proof_verified=1;/* original proof math only; never clears original UNKNOWN */
 return p->unknown?VEIL_STORE_UNKNOWN:domain_owner_current(p);
}
static veil_store_status domain_registry_cas(ynx_administration_execution_loan*q){
 registry_resource_owner*r=q->parent->resource;
 if(!r||!r->allocation||!q->proof_verified||q->phase!=4||q->state[0].phase!=4||q->state[1].phase!=4)return VEIL_STORE_REQUIRED;
 if(q->cas_invoked||r->allocation->unknown)return VEIL_STORE_UNKNOWN;
 if(r->active_head.next_version==UINT64_MAX||q->state[0].epoch!=r->allocation->prepared.epoch||q->state[0].ordinal!=r->allocation->prepared.ordinal)return VEIL_STORE_MISMATCH;
 veil_store_status s=ynx_administration_execution_current(q);if(s)return s;
 s=registry_compare_begin(r);if(s)return s;
 sqlite3_stmt*st=NULL;unsigned char*previous=NULL;size_t previous_size=0;
 if(sqlite3_prepare_v2(r->registry,"SELECT sealed FROM registry_head WHERE slot=1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 if(sqlite3_step(st)==SQLITE_ROW&&sqlite3_column_type(st,0)==SQLITE_BLOB){int n=sqlite3_column_bytes(st,0);const unsigned char*b=sqlite3_column_blob(st,0);if(n>0&&n<=YNX_STORAGE_MAX&&b){previous=malloc((size_t)n);if(previous){memcpy(previous,b,(size_t)n);previous_size=(size_t)n;}}}
 s=previous&&sqlite3_step(st)==SQLITE_DONE?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;if(s)goto done;
 /* Only this same allocated child may consume its nonce. No caller bytes,
  * new allocator, random/time nonce or repeat GCM after a late refusal. */
 ynx_storage_expected next=r->active_head;next.base_version=next.next_version;next.next_version++;memcpy(next.request,q->intent,32);
 for(unsigned i=0;i<4;i++)next.storage_nonce[i]=(unsigned char)(q->state[0].epoch>>(24-8*i));
 for(unsigned i=0;i<8;i++)next.storage_nonce[4+i]=(unsigned char)(q->state[0].ordinal>>(56-8*i));
 unsigned char*plain=r->keys+64;if(r->key_pages<160){s=VEIL_STORE_BOUND;goto done;}
 size_t written=0;s=ynx_storage_open(r->keys+32,&r->active_head,(ynx_original_bytes){previous,previous_size},plain,r->key_pages-64,&written);
 if(s||written!=96){if(!s)s=VEIL_STORE_MISMATCH;OPENSSL_cleanse(plain,r->key_pages-64);goto done;}
 s=ynx_administration_execution_current(q);if(s){OPENSSL_cleanse(plain,r->key_pages-64);goto done;}
 q->cas_invoked=1;/* before the first use, even if the primitive later refuses */
 s=ynx_storage_seal(r->keys+32,&next,(ynx_original_bytes){plain,written},&q->sealed);OPENSSL_cleanse(plain,r->key_pages-64);
 if(s||!q->sealed.bytes){if(!s)s=VEIL_STORE_MISMATCH;goto done;}
 s=ynx_administration_execution_current(q);if(s)goto done;
 st=NULL;if(sqlite3_prepare_v2(r->registry,"UPDATE registry_head SET sealed=?1 WHERE slot=1 AND sealed=?2",-1,&st,NULL)!=SQLITE_OK){s=VEIL_STORE_SQL;goto done;}
 if(sqlite3_bind_blob(st,1,q->sealed.bytes,(int)q->sealed.size,SQLITE_STATIC)!=SQLITE_OK||sqlite3_bind_blob(st,2,previous,(int)previous_size,SQLITE_STATIC)!=SQLITE_OK)s=VEIL_STORE_SQL;
 else s=sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(r->registry)==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;if(s)goto done;
 /* Adopt candidate AAD before COMMIT classification. An ambiguous write never
  * falls back to the previous version or reuses this child's nonce. */
 r->active_head=next;
 if(sqlite3_exec(r->registry,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(r->registry)){s=VEIL_STORE_UNKNOWN;goto done;}r->transaction=0;q->local_committed=1;
 st=NULL;if(sqlite3_prepare_v2(r->registry,"SELECT sealed FROM registry_head WHERE slot=1",-1,&st,NULL)!=SQLITE_OK){s=VEIL_STORE_SQL;goto done;}
 s=VEIL_STORE_MISMATCH;if(sqlite3_step(st)==SQLITE_ROW&&sqlite3_column_type(st,0)==SQLITE_BLOB&&sqlite3_column_bytes(st,0)==(int)q->sealed.size){const unsigned char*b=sqlite3_column_blob(st,0);if(b&&!CRYPTO_memcmp(b,q->sealed.bytes,q->sealed.size)&&sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;}
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;if(!s)s=ynx_administration_execution_current(q);
 done:if(previous){OPENSSL_cleanse(previous,previous_size);free(previous);}return s;
}
veil_store_status ynx_administration_execution_advance(ynx_administration_execution_loan*p,uint32_t phase,ynx_original_bytes evidence){
 ynx_administration_execution_loan*q=execution_loan_recognize(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 veil_store_status s=ynx_administration_execution_current(q);if(s)return s;if(phase!=q->phase+1||phase<2||phase>6)return VEIL_STORE_MISMATCH;
 registry_resource_owner*r=q->parent->resource;
 if(phase==2){
  s=allocation_prepare(r,(ynx_original_bytes){q->intent,32},q);if(s)return execution_loan_fail(q,s);registry_allocation_owner*a=r->allocation;
  if(!a||a->original.ordinal!=q->state[0].ordinal||q->state[0].ordinal!=q->state[1].ordinal||a->original.key_generation!=q->state[0].generation)return execution_loan_fail(q,VEIL_STORE_MISMATCH);
  s=domain_pair_write(q,2,(ynx_original_bytes){0});if(s)return execution_loan_fail(q,s);
  /* Same actual guardians/counter; durable pending precedes invocation. */
  if(q->burn_invoked||a->entered)return execution_loan_fail(q,VEIL_STORE_UNKNOWN);q->burn_invoked=1;
  s=allocation_enter_burn(r,q);/* known mutation only; no allocated capability */
  if(s)return execution_loan_fail(q,s);
 }else if(phase==3){s=domain_burn_verify(q);if(s)return execution_loan_fail(q,s);s=domain_pair_write(q,3,(ynx_original_bytes){0});}
 else if(phase==4){
  /* ALLOCATED derives only from the same verified burn and both retained
   * reservations. No untrusted evidence field selects nonce or ordinal. */
  if(!q->quote||!q->certify||!q->proof_verified)return execution_loan_fail(q,VEIL_STORE_MISMATCH);s=domain_pair_write(q,4,(ynx_original_bytes){0});
 }else if(phase==5){
  s=domain_registry_cas(q);if(s)return execution_loan_fail(q,s);
  s=domain_pair_write(q,5,(ynx_original_bytes){q->sealed.bytes,q->sealed.size});
 }else{
  /* Terminal still needs the actual independent original owners,
   * not response bytes. No SQL/status/unsigned caller evidence can inhabit
   * those types; normal owning consumption is connected separately. */
  (void)evidence;return VEIL_STORE_REQUIRED;
 }
 if(s)return execution_loan_fail(q,s);return ynx_administration_execution_current(q);
}
veil_store_status ynx_administration_execution_observe(ynx_administration_execution_loan*p,uint32_t*out){
 if(!out)return VEIL_STORE_BOUND;*out=0;ynx_administration_execution_loan*q=execution_loan_recognize(p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* No reopen, reset, write or renewed window. Preserve half-commit originals
  * even when pair is unequal, so an unresolved participant is never released. */
 if(!q->locked||!q->keys)return VEIL_STORE_REQUIRED;uint32_t minimum=6;
 for(unsigned d=0;d<2;d++){if(!q->domain[d])return VEIL_STORE_REQUIRED;unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state state={0};veil_store_status s=domain_read(q,d,raw,&state);OPENSSL_cleanse(raw,sizeof(raw));if(s)return execution_loan_fail(q,s);if(CRYPTO_memcmp(state.intent,q->intent,32)||state.generation!=q->state[d].generation||state.ordinal!=q->state[d].ordinal)return execution_loan_fail(q,VEIL_STORE_MISMATCH);if(state.phase<minimum)minimum=state.phase;OPENSSL_cleanse(&state,sizeof(state));}
 /* Same entered original may produce a single bounded proof observation.
  * Partial ESAPI results remain held even when their UNKNOWN is returned.
  * This never changes durable phase, reburns, resets uncertainty or allocates. */
 if(q->burn_invoked&&!q->proof_invoked){veil_store_status proof=domain_burn_verify(q);if(proof)execution_loan_fail(q,proof);}
 *out=minimum;return q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_administration_execution_close(ynx_administration_execution_loan**p){
 if(!p)return VEIL_STORE_BOUND;if(!*p)return VEIL_STORE_OK;ynx_administration_execution_loan*q=execution_loan_recognize(*p);if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 /* Local cleanup never rolls back committed pending/burn or claims terminal. */
 for(unsigned d=0;d<2;d++){
  if(q->domain[d]){if(q->transaction[d]){if(sqlite3_exec(q->domain[d],"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(q->domain[d]))return execution_loan_fail(q,VEIL_STORE_UNKNOWN);q->transaction[d]=0;}
   if(sqlite3_close(q->domain[d])!=SQLITE_OK)return execution_loan_fail(q,VEIL_STORE_SQL);q->domain[d]=NULL;}
  if(q->watch[d]){veil_custody_watch*original=q->watch[d];veil_store_status s=veil_custody_watch_drop(&q->watch[d]);if(q->watch[d]&&q->watch[d]!=original)abort();if(s&&!q->watch[d]&&s!=VEIL_STORE_UNKNOWN)abort();if(q->watch[d])return execution_loan_fail(q,s?s:VEIL_STORE_UNKNOWN);if(s)execution_loan_fail(q,s);}
  if(q->integrity[d]){if(q->borrowed[d]){veil_store_status s=primitive_status(ynx_tpm2_owner_secret_release(q->integrity[d]));if(s)return execution_loan_fail(q,s);q->borrowed[d]=0;}ynx_tpm2_owner*original=q->integrity[d];veil_store_status s=primitive_status(ynx_tpm2_owner_close(&q->integrity[d]));if(q->integrity[d]&&q->integrity[d]!=original)abort();if(s&&!q->integrity[d]&&s!=VEIL_STORE_UNKNOWN)abort();if(q->integrity[d])return execution_loan_fail(q,s?s:VEIL_STORE_UNKNOWN);if(s)execution_loan_fail(q,s);}
  if(q->floor[d]){ynx_tpm2_owner*original=q->floor[d];veil_store_status s=primitive_status(ynx_tpm2_owner_close(&q->floor[d]));if(q->floor[d]&&q->floor[d]!=original)abort();if(s&&!q->floor[d]&&s!=VEIL_STORE_UNKNOWN)abort();if(q->floor[d])return execution_loan_fail(q,s?s:VEIL_STORE_UNKNOWN);if(s)execution_loan_fail(q,s);}
 }
 if(q->keys){OPENSSL_cleanse(q->keys,q->pages);if(q->locked){if(munlock(q->keys,q->pages))return execution_loan_fail(q,VEIL_STORE_UNKNOWN);q->locked=0;}if(munmap(q->keys,q->pages))return execution_loan_fail(q,VEIL_STORE_UNKNOWN);q->keys=NULL;}
 ynx_storage_ciphertext_free(&q->sealed);
 Esys_Free(q->quote);Esys_Free(q->quote_signature);Esys_Free(q->certify);Esys_Free(q->certify_signature);
 pthread_mutex_lock(&inventory_lock);ynx_administration_execution_loan**link=&execution_loans;while(*link&&*link!=q)link=&(*link)->next;if(*link!=q||!q->parent->execution_children){pthread_mutex_unlock(&inventory_lock);abort();}*link=q->next;q->parent->execution_children--;pthread_mutex_unlock(&inventory_lock);
 int unresolved=q->unknown||(q->reservation_started&&q->phase!=6);OPENSSL_cleanse(q,sizeof(*q));free(q);*p=NULL;return unresolved?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
static veil_store_status execution_burn_current(ynx_administration_execution_loan*p,registry_resource_owner*r){
 ynx_administration_execution_loan*q=execution_loan_recognize(p);if(!q||!q->parent||q->parent->resource!=r||q->phase!=2||!q->reservation_started)return VEIL_STORE_REQUIRED;
 if(q->state[0].phase!=2||q->state[1].phase!=2||q->state[0].ordinal!=q->state[1].ordinal||CRYPTO_memcmp(q->state[0].intent,q->intent,32)||CRYPTO_memcmp(q->state[1].intent,q->intent,32))return VEIL_STORE_MISMATCH;
 return ynx_administration_execution_current(q);
}

static veil_store_status execution_prepare_ordinal(ynx_administration_execution_loan*p,registry_resource_owner*r,ynx_original_bytes intent,uint64_t*out){
 if(!out)return VEIL_STORE_BOUND;*out=0;ynx_administration_execution_loan*q=execution_loan_recognize(p);
 if(!q||!q->parent||q->parent->resource!=r||q->phase!=1||!q->reservation_started)return VEIL_STORE_REQUIRED;
 if(!intent.data||intent.size!=32||CRYPTO_memcmp(intent.data,q->intent,32)||q->state[0].phase!=1||q->state[1].phase!=1||q->state[0].ordinal!=q->state[1].ordinal||q->state[0].generation!=q->state[1].generation||CRYPTO_memcmp(q->state[0].intent,q->intent,32)||CRYPTO_memcmp(q->state[1].intent,q->intent,32))return VEIL_STORE_MISMATCH;
 veil_store_status s=ynx_administration_execution_current(q);if(s)return s;*out=q->state[0].ordinal;return VEIL_STORE_OK;
}
