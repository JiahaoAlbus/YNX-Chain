/* Same original resource owner, not another loan layer. Two independently
 * keyed domain ledgers + exact registered coordinator serialize mutations.
 * SQLite/flock alone are NOT authority: entry also requires the same recognized
 * NativeCore policy/participant, named TPM integrity/floor owners and MAC-bound
 * registered originals. No administration execution loan is consumed.
 * All private-service current/revoke/cancel/CAS paths MUST use this coordinator.
 * No network wait occurs while it is locked. Cross-domain commit is NOT atomic:
 * any half-commit is unresolved, retained and only readable by exact recovery.
 */
#include "ynx_source_independent_reservation.h"
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <unistd.h>
#define sqlite3_open_v2 veil_sqlite3500400_sqlite3_open_v2
#define sqlite3_close veil_sqlite3500400_sqlite3_close
#define sqlite3_exec veil_sqlite3500400_sqlite3_exec
#define sqlite3_get_autocommit veil_sqlite3500400_sqlite3_get_autocommit
#include <sqlite3.h>
#include <tss2_mu.h>
#include "../../c/src/veil_store_custody.h"
extern veil_store_status ynx_android_core_wrap_retain_for_policy(struct ynx_android_core_wrap *,void *);
extern veil_store_status ynx_android_core_wrap_release_borrow(struct ynx_android_core_wrap *);
extern veil_store_status ynx_android_core_wrap_current(struct ynx_android_core_wrap *);
#include "ynx_storage_initialization_aad_private.h"
typedef struct core_initialization_write_state {
 veil_native_finish_result*finish_owner;int finish_cleanup,finish_call,finish_reading;
 uint32_t stage;int lease_held,write_entered,finish_entered;veil_store_status first;int unknown;
 unsigned char intent_original[224],store_reference[32],journal_digest[32],cipher_digest[32];
 ynx_storage_initialization_aad_v1 aad;
} core_initialization_write_state;
typedef struct core_message3_state {
 void*holder;int borrowed,entered,unknown,retire_entered,retired;
 unsigned mask,domain_mask[2];unsigned char*capture;size_t capture_size;
 ynx_original_bytes id,body,frames[2];
 unsigned char readback[4096];size_t readback_size;
 /* Only public retained signature originals. Before exposing key-enter the
  * owner requires one observation on leave, including a failing signer. */
 int observation_pending;
 unsigned char parts[9462],domain_parts[2][9462];
 size_t parts_size,domain_parts_size[2];
} core_message3_state;
struct core_domain_driver {
 sqlite3 *db[2];veil_custody_watch *watch[2];
 unsigned char *keys;size_t pages;int locked,borrowed[2],transaction[2];
 int fence,held,wrap_borrowed,reserve_attempted,unknown;
 sqlite3 *store;veil_custody_watch *store_watch;int store_transaction;
 ynx_tpm2_owner *command_auth[3][2];
 ynx_tpm2_command_authorizer *command_authorizer[3][2];
 TPM2B_ATTEST *counter_attestation[3];TPMT_SIGNATURE *counter_signature[3];
 unsigned char counter_challenge[3][32];int counter_entered[3],counter_observed[3];
 int nonce_entered,effect_entered,local_committed,cancelled,seal_entered,sealed_initialization;
 ynx_storage_ciphertext sealed_rows[32];size_t sealed_count;
 core_initialization_write_state initialization_write;
 ynx_storage_initialization_aad_v1 initialization_aad;char initialization_name[65];
 unsigned char*initialization_journal;size_t initialization_journal_size;
 unsigned char initialization_journal_digest[32],initialization_cipher_digest[32];
 unsigned char*sensitive_map;size_t sensitive_pages;
 int checkpoint_entered,checkpoint_committed;size_t checkpoint_size;
 unsigned char checkpoint_original[16384];
 core_message3_state m3[3];int terminal_committed;uint32_t m3_key_kind,m3_key_role,m3_key_pq;
 unsigned char nonce[12],effect_digest[32];
 unsigned char *effect_original;size_t effect_original_size;
 /* Actual normal checked-store finish, not caller-supplied typed fields.
  * Retained through uncertainty; no second encryption or signature. */
 veil_native_finish_result *engine_finish;
 unsigned char engine_binding[416];int engine_prepared,engine_committed;
 uint32_t engine_native_kind; /* copied only from same recognized checked finish */
 unsigned char *engine_journal,*engine_source_frame;
 size_t engine_journal_size,engine_source_frame_size;
 struct ynx_android_core_wrap *wrap;
 ynx_native_core_enforcing_binding_v2 binding;
 ynx_domain_state state[2];unsigned char originals[2][YNX_DOMAIN_STATE_BYTES];
 unsigned char effect_domain_originals[2][YNX_DOMAIN_STATE_BYTES];
};
static int core_driver_binding_same(const ynx_native_core_enforcing_binding_v2*a,
 const ynx_native_core_enforcing_binding_v2*b){
 return a->version==b->version&&a->purpose==b->purpose&&a->operations==b->operations&&
 a->relation_present==b->relation_present&&a->storage_generation==b->storage_generation&&
 a->policy_generation==b->policy_generation&&a->floor==b->floor&&a->deadline==b->deadline&&
 !CRYPTO_memcmp(a->head,b->head,192);
}
static veil_store_status core_counter_current(ynx_native_core_resource_loan*,unsigned);
static veil_store_status core_store_recover_denial(ynx_native_core_resource_loan*);
static veil_store_status core_store_cancel_check(ynx_native_core_resource_loan*);
static veil_store_status core_m3_close(ynx_native_core_resource_loan*);
static veil_store_status core_driver_policy(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(q->unknown||d->cancelled)return VEIL_STORE_UNKNOWN;
 /* All mutations/key use/current share the selected coordinator. A separate
  * durable denial survives cancel-after-COMMIT without rewriting its receipt. */
 if(d->held){veil_store_status z=core_store_cancel_check(q);if(z)return core_resource_fail(q,z);}
 veil_store_status s=(veil_store_status)ynx_sdk_native_core_rights_current_v2(q->policy);
 if(s)return core_resource_fail(q,s);
 s=ynx_native_core_participant_current(q->participant);if(s)return core_resource_fail(q,s);
 if(!d->wrap)return core_resource_fail(q,VEIL_STORE_REQUIRED);
 s=ynx_android_core_wrap_current(d->wrap);if(s)return core_resource_fail(q,s);
 ynx_native_core_enforcing_binding_v2 now={0};
 s=(veil_store_status)ynx_sdk_native_core_enforcing_binding_v2(q->policy,&now);
 if(s)return core_resource_fail(q,s);
 struct timespec ts;if(clock_gettime(CLOCK_MONOTONIC,&ts)||ts.tv_sec<0)return core_resource_fail(q,VEIL_STORE_UNKNOWN);
 if(now.version!=2||!now.deadline||(uint64_t)ts.tv_sec>UINT64_MAX/1000000000u||
 (uint64_t)ts.tv_sec*1000000000u+(uint64_t)ts.tv_nsec>=now.deadline||
 !core_driver_binding_same(&now,&d->binding))return core_resource_fail(q,VEIL_STORE_MISMATCH);
 /* Original Core resource observations are necessary but never sufficient. */
 for(unsigned i=0;i<7;i++){
  if(!q->objects[i])return core_resource_fail(q,VEIL_STORE_REQUIRED);
  if(i==2&&d->counter_observed[0])s=core_counter_current(q,0);
  else if(i>=5&&d->counter_observed[i-4])s=core_counter_current(q,i-4);
  else s=core_resource_primitive(ynx_tpm2_owner_current(q->objects[i]));
  if(s)return core_resource_fail(q,s);
 }
 return VEIL_STORE_OK;
}
static int core_driver_fence_path(ynx_native_core_resource_loan*q){
 struct stat a,b;const native_core_registered_row*r=q->row;core_domain_driver*d=q->driver;
 return d->fence>=0&&!fstat(d->fence,&a)&&!lstat(r->coordinator,&b)&&
 S_ISREG(a.st_mode)&&S_ISREG(b.st_mode)&&a.st_nlink==1&&a.st_uid==geteuid()&&
 (a.st_mode&0777)==0600&&(uint64_t)a.st_dev==r->coordinator_device&&
 (uint64_t)a.st_ino==r->coordinator_inode&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino;
}
static veil_store_status core_driver_fence_enter(ynx_native_core_resource_loan*q,int cleanup){
 core_domain_driver*d=q->driver;if(!d||d->held)return core_resource_fail(q,VEIL_STORE_FROZEN);
 if(!core_driver_fence_path(q))return core_resource_fail(q,VEIL_STORE_MISMATCH);
 if(flock(d->fence,LOCK_EX|LOCK_NB))return core_resource_fail(q,VEIL_STORE_FROZEN);
 d->held=1;
 if(!core_driver_fence_path(q))return core_resource_fail(q,VEIL_STORE_MISMATCH);
 return cleanup?VEIL_STORE_OK:core_driver_policy(q);
}
static veil_store_status core_driver_fence_leave(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d||!d->held)return VEIL_STORE_OK;
 if(flock(d->fence,LOCK_UN))return core_resource_fail(q,VEIL_STORE_UNKNOWN);
 d->held=0;return VEIL_STORE_OK;
}
static veil_store_status core_driver_domain_read(ynx_native_core_resource_loan*q,unsigned slot,
 unsigned char raw[YNX_DOMAIN_STATE_BYTES],ynx_domain_state*state){
 core_domain_driver*d=q->driver;
 if(slot>1||!d->db[slot]||!d->keys||!d->locked)return VEIL_STORE_REQUIRED;
 veil_store_status s=veil_custody_watch_check(d->db[slot],d->watch[slot]);
 if(!s)s=ynx_private_domain_journal_read(d->db[slot],d->state[slot].key_identity,raw);
 if(!s)s=ynx_domain_state_decode(d->keys+32*slot,(ynx_original_bytes){raw,YNX_DOMAIN_STATE_BYTES},state);
 return s;
}
static veil_store_status core_driver_domain_match(ynx_native_core_resource_loan*q,
 unsigned slot,const ynx_domain_state*s){
 core_domain_driver*d=q->driver;
 if(s->generation!=d->binding.storage_generation||s->floor!=d->binding.floor||
 CRYPTO_memcmp(s->registration,d->binding.registration,32)||
 CRYPTO_memcmp(s->head,d->binding.head,32)||
 CRYPTO_memcmp(s->domain,q->row->domain_original[slot].domain,32)||
 CRYPTO_memcmp(s->key_identity,q->row->domain_original[slot].key_identity,32))
 return VEIL_STORE_MISMATCH;
 return VEIL_STORE_OK;
}
/* CAS the complete authenticated domain original. Partial COMMIT is never
 * rolled back by guessing. Parent retains connection/transaction/first cause. */
static veil_store_status core_driver_domain_cas(ynx_native_core_resource_loan*q,
 unsigned slot,const ynx_domain_state*next){
 core_domain_driver*d=q->driver;if(!d->held||slot>1)return VEIL_STORE_LIFETIME;
 unsigned char raw[YNX_DOMAIN_STATE_BYTES];veil_store_status s=ynx_domain_state_encode(d->keys+32*slot,next,raw);
 if(s)return s;
 if(sqlite3_exec(d->db[slot],"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK){OPENSSL_cleanse(raw,sizeof(raw));return VEIL_STORE_SQL;}
 d->transaction[slot]=1;
 s=core_driver_policy(q);
 if(!s)s=ynx_private_domain_journal_apply(d->db[slot],d->state[slot].key_identity,d->originals[slot],raw);
 if(!s){
  d->reserve_attempted=1;
  if(sqlite3_exec(d->db[slot],"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||
   !sqlite3_get_autocommit(d->db[slot]))s=VEIL_STORE_UNKNOWN;
  else {d->transaction[slot]=0;d->state[slot]=*next;memcpy(d->originals[slot],raw,sizeof(raw));}
 }
 if(!s){
  unsigned char observed[YNX_DOMAIN_STATE_BYTES];ynx_domain_state st={0};
  s=core_driver_domain_read(q,slot,observed,&st);
  if(!s&&CRYPTO_memcmp(observed,raw,sizeof(raw)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(observed,sizeof(observed));OPENSSL_cleanse(&st,sizeof(st));
 }
 OPENSSL_cleanse(raw,sizeof(raw));if(!s)s=core_driver_policy(q);
 return s;
}
static veil_store_status core_driver_close(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d)return VEIL_STORE_OK;
 /* Cleanup releases only owned RAM/SQL locks; durable reservations remain. */
 veil_store_status m3close=core_m3_close(q);if(m3close)return m3close;
 if(d->engine_finish){
  veil_native_finish_result*before=d->engine_finish;
  veil_store_status z=veil_native_finish_result_drop(&d->engine_finish);
  if(d->engine_finish&&d->engine_finish!=before)abort();
  if(z||d->engine_finish)return core_resource_fail(q,z?z:VEIL_STORE_UNKNOWN);
 }
 for(unsigned i=0;i<3;i++){
  for(unsigned j=0;j<2;j++){
   if(d->command_authorizer[i][j]){
    veil_store_status z=core_resource_primitive(ynx_tpm2_command_authorizer_close(&d->command_authorizer[i][j]));
    if(d->command_authorizer[i][j])return core_resource_fail(q,z?z:VEIL_STORE_UNKNOWN);
    if(z)core_resource_fail(q,z);
   }
   if(d->command_auth[i][j]){
    veil_store_status z=core_resource_primitive(ynx_tpm2_owner_close(&d->command_auth[i][j]));
    if(d->command_auth[i][j])return core_resource_fail(q,z?z:VEIL_STORE_UNKNOWN);
    if(z)core_resource_fail(q,z);
   }
  }
  Esys_Free(d->counter_attestation[i]);d->counter_attestation[i]=NULL;
  Esys_Free(d->counter_signature[i]);d->counter_signature[i]=NULL;
 }
 if(d->sensitive_map){
  OPENSSL_cleanse(d->sensitive_map,d->sensitive_pages);
  if(munlock(d->sensitive_map,d->sensitive_pages)||munmap(d->sensitive_map,d->sensitive_pages))
   return core_resource_fail(q,VEIL_STORE_UNKNOWN);
  d->sensitive_map=NULL;
 }
 if(d->initialization_journal){free(d->initialization_journal);d->initialization_journal=NULL;d->initialization_journal_size=0;}
 for(size_t i=0;i<d->sealed_count;i++)ynx_storage_ciphertext_free(&d->sealed_rows[i]);
 d->sealed_count=0;
 if(d->store){
  if(d->store_transaction){
   if(sqlite3_exec(d->store,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||
      !sqlite3_get_autocommit(d->store))return core_resource_fail(q,VEIL_STORE_UNKNOWN);
   d->store_transaction=0;
  }
  if(sqlite3_close(d->store)!=SQLITE_OK)return core_resource_fail(q,VEIL_STORE_SQL);
  d->store=NULL;
 }
 if(d->store_watch){
  veil_custody_watch *before=d->store_watch;
  veil_store_status z=veil_custody_watch_drop(&d->store_watch);
  if(d->store_watch&&d->store_watch!=before)abort();
  if(z||d->store_watch)return core_resource_fail(q,z?z:VEIL_STORE_UNKNOWN);
 }
 if(d->effect_original){OPENSSL_cleanse(d->effect_original,d->effect_original_size);
  free(d->effect_original);d->effect_original=NULL;}
 if(d->engine_journal){free(d->engine_journal);d->engine_journal=NULL;}
 if(d->engine_source_frame){free(d->engine_source_frame);d->engine_source_frame=NULL;}

 for(unsigned i=0;i<2;i++){
  if(d->db[i]){
   if(d->transaction[i]){
    if(sqlite3_exec(d->db[i],"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||
     !sqlite3_get_autocommit(d->db[i]))return core_resource_fail(q,VEIL_STORE_UNKNOWN);
    d->transaction[i]=0;
   }
   if(sqlite3_close(d->db[i])!=SQLITE_OK)return core_resource_fail(q,VEIL_STORE_SQL);
   d->db[i]=NULL;
  }
  if(d->watch[i]){
   veil_custody_watch*before=d->watch[i];veil_store_status s=veil_custody_watch_drop(&d->watch[i]);
   if(d->watch[i]&&d->watch[i]!=before)abort();
   if(s)core_resource_fail(q,s);
   if(d->watch[i])return core_resource_fail(q,s?s:VEIL_STORE_UNKNOWN);
  }
  if(d->borrowed[i]){
   veil_store_status s=core_resource_primitive(ynx_tpm2_owner_secret_release(q->objects[3+i]));
   if(s)return core_resource_fail(q,s);d->borrowed[i]=0;
  }
 }
 veil_store_status s=core_driver_fence_leave(q);if(s)return s;
 if(d->fence>=0){int fd=d->fence;d->fence=-1;if(close(fd))return core_resource_fail(q,VEIL_STORE_UNKNOWN);}
 if(d->wrap_borrowed){s=ynx_android_core_wrap_release_borrow(d->wrap);if(s)return core_resource_fail(q,s);d->wrap_borrowed=0;}
 if(d->keys){
  OPENSSL_cleanse(d->keys,d->pages);
  if(d->locked){if(munlock(d->keys,d->pages))return core_resource_fail(q,VEIL_STORE_UNKNOWN);d->locked=0;}
  if(munmap(d->keys,d->pages))return core_resource_fail(q,VEIL_STORE_UNKNOWN);d->keys=NULL;
 }
 int unresolved=d->unknown||d->reserve_attempted;
 OPENSSL_cleanse(d,sizeof(*d));free(d);q->driver=NULL;
 if(unresolved)return core_resource_fail(q,VEIL_STORE_UNKNOWN);
 return VEIL_STORE_OK;
}
static veil_store_status core_driver_factory_inner(void*policy,
 ynx_native_core_participant*participant,struct ynx_android_core_wrap*wrap,
 ynx_native_core_resource_loan**out){
 if(!policy||!participant||!wrap||!out||*out)return VEIL_STORE_BOUND;
 /* Reuse original inventory and partial lifetime. No new wrapper/accepted root. */
 veil_store_status s=core_resource_acquire_inner(policy,1,participant,out);
 ynx_native_core_resource_loan*q=*out;
 if(!q||!q->row)return s?s:VEIL_STORE_UNKNOWN;
 if(s&&s!=VEIL_STORE_REQUIRED)return s;
 /* Rows without genuine registered domain/coordinator originals are NOT
  * CREATED. Do not create a DB/table, seed a floor, initialize a nonce or key. */
 const native_core_registered_row*r=q->row;
 if(!r->coordinator||!r->domain_store[0]||!r->domain_store[1])return VEIL_STORE_REQUIRED;
 if(!strcmp(r->domain_store[0],r->domain_store[1])||
 !CRYPTO_memcmp(r->domain_original[0].domain,r->domain_original[1].domain,32)||
 !CRYPTO_memcmp(r->domain_original[0].key_identity,r->domain_original[1].key_identity,32))
 return core_resource_fail(q,VEIL_STORE_MISMATCH);
 core_domain_driver*d=calloc(1,sizeof(*d));if(!d)return core_resource_fail(q,VEIL_STORE_SQL);
 q->driver=d;q->active=1;d->fence=-1;d->wrap=wrap;
 s=ynx_android_core_wrap_retain_for_policy(wrap,policy);if(s)return core_resource_fail(q,s);d->wrap_borrowed=1;
 s=(veil_store_status)ynx_sdk_native_core_enforcing_binding_v2(policy,&d->binding);
 if(s)return core_resource_fail(q,s);
 long pages=sysconf(_SC_PAGESIZE);if(pages<64||pages>1048576)return core_resource_fail(q,VEIL_STORE_BOUND);
 d->pages=(size_t)pages;d->keys=mmap(NULL,d->pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);
 if(d->keys==MAP_FAILED){d->keys=NULL;return core_resource_fail(q,VEIL_STORE_SQL);}
 if(mlock(d->keys,d->pages))return core_resource_fail(q,VEIL_STORE_UNKNOWN);d->locked=1;
 d->fence=open(r->coordinator,O_RDWR|O_NOFOLLOW|O_CLOEXEC);
 if(d->fence<0)return core_resource_fail(q,VEIL_STORE_REQUIRED);
 s=core_driver_fence_enter(q,0);if(s)return s;
 for(unsigned i=0;i<2;i++){
  d->state[i]=r->domain_original[i];
  s=core_resource_primitive(ynx_tpm2_owner_unseal(q->objects[3+i]));if(s)return core_resource_fail(q,s);
  const uint8_t*secret=NULL;size_t n=0;
  s=core_resource_primitive(ynx_tpm2_owner_secret_borrow(q->objects[3+i],&secret,&n));
  if(s)return core_resource_fail(q,s);d->borrowed[i]=1;
  if(!secret||n!=32)return core_resource_fail(q,VEIL_STORE_MISMATCH);
  memcpy(d->keys+32*i,secret,32);
  struct stat st;
  if(lstat(r->domain_store[i],&st)||!S_ISREG(st.st_mode)||
   (uint64_t)st.st_dev!=r->domain_device[i]||(uint64_t)st.st_ino!=r->domain_inode[i])
   return core_resource_fail(q,VEIL_STORE_MISMATCH);
  s=veil_custody_watch_open(r->domain_store[i],&d->watch[i]);if(s)return core_resource_fail(q,s);
  if(sqlite3_open_v2(r->domain_store[i],&d->db[i],SQLITE_OPEN_READWRITE|SQLITE_OPEN_FULLMUTEX|SQLITE_OPEN_NOFOLLOW,NULL)!=SQLITE_OK)
   return core_resource_fail(q,VEIL_STORE_SQL);
  if(sqlite3_exec(d->db[i],"PRAGMA synchronous=FULL; PRAGMA busy_timeout=0",NULL,NULL,NULL)!=SQLITE_OK)
   return core_resource_fail(q,VEIL_STORE_SQL);
  ynx_domain_state actual={0};s=core_driver_domain_read(q,i,d->originals[i],&actual);
  if(!s)s=core_driver_domain_match(q,i,&actual);
  if(s)return core_resource_fail(q,s);d->state[i]=actual;
  if(actual.phase!=6){
   /* Recovery never refreshes expected history or turns partial into READY. */
   if(CRYPTO_memcmp(actual.intent,d->binding.intent,32)||
    actual.deadline!=d->binding.deadline)return core_resource_fail(q,VEIL_STORE_UNKNOWN);
   d->reserve_attempted=1;d->unknown=1;
  }
 }
 s=core_driver_policy(q);if(s)return s;
 s=core_store_recover_denial(q);if(s){d->unknown=1;core_resource_fail(q,s);}
 veil_store_status unlock=core_driver_fence_leave(q);if(unlock)return unlock;
 return d->unknown?core_resource_fail(q,VEIL_STORE_UNKNOWN):VEIL_STORE_OK;
}
static veil_store_status core_driver_current_inner(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!q->driver)return VEIL_STORE_REQUIRED;if(q->unknown||q->driver->unknown)return VEIL_STORE_UNKNOWN;
 veil_store_status s=core_driver_fence_enter(q,0);
 for(unsigned i=0;!s&&i<2;i++){
  unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state st={0};
  s=core_driver_domain_read(q,i,raw,&st);
  if(!s&&CRYPTO_memcmp(raw,q->driver->originals[i],sizeof(raw)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(raw,sizeof(raw));OPENSSL_cleanse(&st,sizeof(st));
 }
 if(!s)s=core_driver_policy(q);
 veil_store_status release=core_driver_fence_leave(q);
 if(s)return core_resource_fail(q,s);return release;
}
static veil_store_status core_driver_reserve_inner(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 core_domain_driver*d=q->driver;if(!d)return VEIL_STORE_REQUIRED;
 if(q->unknown||d->unknown)return VEIL_STORE_UNKNOWN;
 if(d->reserve_attempted)return VEIL_STORE_DUPLICATE;
 veil_store_status s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,5);
 if(s)return core_resource_fail(q,s);
 s=core_driver_fence_enter(q,0);
 if(!s){d->reserve_attempted=1;
  for(unsigned i=0;!s&&i<2;i++){
   if(d->state[i].phase!=6||d->state[i].sequence==UINT64_MAX||d->state[i].ordinal==UINT64_MAX){s=VEIL_STORE_MISMATCH;break;}
   ynx_domain_state next=d->state[i];next.phase=1;next.sequence++;next.ordinal++;
   next.deadline=d->binding.deadline;memcpy(next.intent,d->binding.intent,32);memset(next.ciphertext,0,32);
   if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor)){s=VEIL_STORE_UNKNOWN;break;}
   s=core_driver_domain_cas(q,i,&next);OPENSSL_cleanse(&next,sizeof(next));
  }
 }
 veil_store_status release=core_driver_fence_leave(q);
 if(s){d->unknown=1;return core_resource_fail(q,s);}return release;
}
static veil_store_status core_driver_query_inner(ynx_native_core_resource_loan*p,
 unsigned char out[2][YNX_DOMAIN_STATE_BYTES]){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,2*YNX_DOMAIN_STATE_BYTES);
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 core_domain_driver*d=q->driver;if(!d)return VEIL_STORE_REQUIRED;
 /* Exact original recovery: no advance/CAS/nonce/sign/expiry reset. */
 veil_store_status s=core_driver_fence_enter(q,1);
 for(unsigned i=0;!s&&i<2;i++){
  ynx_domain_state actual={0};s=core_driver_domain_read(q,i,out[i],&actual);
  if(!s&&(CRYPTO_memcmp(actual.intent,d->binding.intent,32)||
   actual.generation!=d->binding.storage_generation||actual.deadline!=d->binding.deadline))
   s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(&actual,sizeof(actual));
 }
 veil_store_status release=core_driver_fence_leave(q);
 if(s){OPENSSL_cleanse(out,2*YNX_DOMAIN_STATE_BYTES);return core_resource_fail(q,s);}
 if(release)return release;
 return q->unknown||d->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}

/* Same original inventory's reentry fence; failed nested attempts cannot
 * be swallowed and promoted by an outer late check. */
veil_store_status ynx_native_core_resource_driver_factory_v3(void*policy,
 ynx_native_core_participant*participant,struct ynx_android_core_wrap*wrap,
 ynx_native_core_resource_loan**out){
 /* AcquireOrRestore always opens the exact registered originals. A pending
  * phase is a read-only recovery owner, never an activation choice by caller. */
 veil_store_status s=core_driver_factory_inner(policy,participant,wrap,out);
 if(out&&*out){ynx_native_core_resource_loan*q=core_resource_recognized(*out);
  if(q&&pthread_equal(q->thread,pthread_self())){q->active=0;if(q->unknown)return VEIL_STORE_UNKNOWN;}}
 return s;
}
static veil_store_status core_driver_operation_enter(ynx_native_core_resource_loan*p,
 ynx_native_core_resource_loan**out){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->active)return core_resource_fail(q,VEIL_STORE_FROZEN);
 q->active=1;*out=q;return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_current(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);
 if(s)return s;s=core_driver_current_inner(p);q->active=0;
 return q->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_native_core_resource_driver_reserve(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);
 if(s)return s;s=core_driver_reserve_inner(p);q->active=0;
 return q->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_native_core_resource_driver_query_exact(ynx_native_core_resource_loan*p,
 unsigned char out[2][YNX_DOMAIN_STATE_BYTES]){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);
 if(s){memset(out,0,2*YNX_DOMAIN_STATE_BYTES);return s;}
 s=core_driver_query_inner(p,out);q->active=0;
 return q->unknown?VEIL_STORE_UNKNOWN:s;
}

/* Old provisional restore=1 has no recognized caller mapping. Refuse instead
 * of guessing that purpose/operation/rights mask means restoration. */
veil_store_status ynx_native_core_resource_driver_factory_v2(void*policy,
 ynx_native_core_participant*participant,struct ynx_android_core_wrap*wrap,int restore,
 ynx_native_core_resource_loan**out){
 if(restore)return VEIL_STORE_BOUND;
 return ynx_native_core_resource_driver_factory_v3(policy,participant,wrap,out);
}

#include "ynx_native_core_protected_store.inc"

#include "ynx_native_core_message3_driver.inc"

#include "ynx_native_core_store_readonly.inc"

#include "ynx_native_core_initialization_write.inc"

#include "ynx_initialization_finish_resource.inc"

#include "ynx_initialization_entry_cleanup.inc"

#include "ynx_native_product_catalog.inc"

#include "ynx_native_product_terminal.inc"

#include "ynx_native_product_sql_transaction.inc"
