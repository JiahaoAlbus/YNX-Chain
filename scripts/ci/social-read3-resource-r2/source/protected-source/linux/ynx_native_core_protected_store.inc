/* Same original NativeCore resource. Concrete SQL effects, no new capability
 * or callback installer. This file is included ONLY by original_resource_owner.c.
 * Pre-existing schema is provisioned by legal enrollment, NEVER created here:
 * core_nonce(key_identity BLOB,generation INTEGER,ordinal INTEGER,intent BLOB,
 *            deadline INTEGER,nonce BLOB, UNIQUE(key_identity,generation,ordinal),
 *            UNIQUE(key_identity,nonce));
 * core_effect(intent BLOB PRIMARY KEY,generation INTEGER,deadline INTEGER,
 *             original BLOB,status INTEGER);
 * core_record(name BLOB PRIMARY KEY,version INTEGER,ciphertext BLOB);
 * core_cancel(intent BLOB PRIMARY KEY,generation INTEGER,deadline INTEGER,original BLOB);
 * core_engine_binding(intent BLOB PRIMARY KEY,original BLOB,journal BLOB,source_frame BLOB);
 * Existing records/UNKNOWN are never replaced/deleted/migrated on recovery.
 */
#define sqlite3_prepare_v2 veil_sqlite3500400_sqlite3_prepare_v2
#define sqlite3_bind_blob veil_sqlite3500400_sqlite3_bind_blob
#define sqlite3_bind_int64 veil_sqlite3500400_sqlite3_bind_int64
#define sqlite3_step veil_sqlite3500400_sqlite3_step
#define sqlite3_finalize veil_sqlite3500400_sqlite3_finalize
#define sqlite3_column_blob veil_sqlite3500400_sqlite3_column_blob
#define sqlite3_column_bytes veil_sqlite3500400_sqlite3_column_bytes
#define sqlite3_column_int64 veil_sqlite3500400_sqlite3_column_int64
#define sqlite3_column_type veil_sqlite3500400_sqlite3_column_type
#define sqlite3_changes veil_sqlite3500400_sqlite3_changes
/* SQLite was already included; explicit declarations preserve normal namespace. */
extern int sqlite3_prepare_v2(sqlite3*,const char*,int,sqlite3_stmt**,const char**);
extern int sqlite3_bind_blob(sqlite3_stmt*,int,const void*,int,void(*)(void*));
extern int sqlite3_bind_int64(sqlite3_stmt*,int,sqlite3_int64);
extern int sqlite3_step(sqlite3_stmt*);
extern int sqlite3_finalize(sqlite3_stmt*);
extern const void*sqlite3_column_blob(sqlite3_stmt*,int);
extern int sqlite3_column_bytes(sqlite3_stmt*,int);
extern sqlite3_int64 sqlite3_column_int64(sqlite3_stmt*,int);
extern int sqlite3_column_type(sqlite3_stmt*,int);
extern int sqlite3_changes(sqlite3*);
static void core_store_u64(unsigned char*b,uint64_t v){
 for(unsigned i=0;i<8;i++)b[7-i]=(unsigned char)(v>>(8*i));
}
static int core_store_path(ynx_native_core_resource_loan*q){
 struct stat a,b;const native_core_registered_row*r=q->row;
 return r&&r->store&&!lstat(r->store,&a)&&S_ISREG(a.st_mode)&&
  a.st_nlink==1&&a.st_uid==geteuid()&&(a.st_mode&0777)==0600&&
  (uint64_t)a.st_dev==r->store_device&&(uint64_t)a.st_ino==r->store_inode&&
  !lstat(r->store,&b)&&a.st_dev==b.st_dev&&a.st_ino==b.st_ino;
}
static veil_store_status core_store_open(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d||!d->held)return VEIL_STORE_LIFETIME;
 if(!core_store_path(q))return VEIL_STORE_MISMATCH;
 if(!d->store){
  veil_store_status s=veil_custody_watch_open(q->row->store,&d->store_watch);if(s)return s;
  if(sqlite3_open_v2(q->row->store,&d->store,SQLITE_OPEN_READWRITE|
    SQLITE_OPEN_FULLMUTEX|SQLITE_OPEN_NOFOLLOW,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  if(sqlite3_exec(d->store,"PRAGMA synchronous=FULL; PRAGMA busy_timeout=0",
    NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 }
 if(!core_store_path(q))return VEIL_STORE_MISMATCH;
 return veil_custody_watch_check(d->store,d->store_watch);
}
static veil_store_status core_store_begin(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;veil_store_status s=core_store_open(q);if(s)return s;
 if(d->store_transaction||!sqlite3_get_autocommit(d->store))return VEIL_STORE_FROZEN;
 if(sqlite3_exec(d->store,"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 d->store_transaction=1;return core_driver_policy(q);
}
static veil_store_status core_store_commit(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d->held||!d->store_transaction)return VEIL_STORE_LIFETIME;
 /* Last reversible check. Once COMMIT is entered cancellation cannot report
  * an ordinary clean refusal or permit re-execution, even after a late error. */
 veil_store_status s=core_driver_policy(q);if(s)return s;
 if(sqlite3_exec(d->store,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||
   !sqlite3_get_autocommit(d->store))return VEIL_STORE_UNKNOWN;
 d->store_transaction=0;return core_driver_policy(q);
}
static veil_store_status core_store_effect_read(ynx_native_core_resource_loan*q,
 unsigned char*out,size_t cap,size_t*written,int required_status){
 core_domain_driver*d=q->driver;sqlite3_stmt*st=NULL;*written=0;
 veil_store_status s=core_store_open(q);if(s)return s;
 const char*readsql=required_status==8?
  "SELECT generation,deadline,original,8 FROM core_cancel WHERE intent=?1":
  "SELECT generation,deadline,original,status FROM core_effect WHERE intent=?1";
 if(sqlite3_prepare_v2(d->store,readsql,
  -1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 s=VEIL_STORE_MISMATCH;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
  int n=sqlite3_column_bytes(st,2);const void*b=sqlite3_column_blob(st,2);
  if(sqlite3_column_int64(st,0)==(sqlite3_int64)d->binding.storage_generation&&
   sqlite3_column_int64(st,1)==(sqlite3_int64)d->binding.deadline&&
   sqlite3_column_int64(st,3)==required_status&&sqlite3_column_type(st,2)==SQLITE_BLOB&&
   n>0&&n<=65536&&b&&(size_t)n<=cap){
   memcpy(out,b,(size_t)n);*written=(size_t)n;
   if(sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;
  }
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(s){OPENSSL_cleanse(out,*written);*written=0;}return s;
}


static veil_store_status core_store_cancel_check(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;veil_store_status s=core_store_open(q);if(s)return s;
 sqlite3_stmt*st=NULL;
 if(sqlite3_prepare_v2(d->store,"SELECT generation,deadline FROM core_cancel WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 s=VEIL_STORE_SQL;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK){
  int z=sqlite3_step(st);
  if(z==SQLITE_DONE)s=VEIL_STORE_OK;
  else if(z==SQLITE_ROW){
   s=sqlite3_column_int64(st,0)==(sqlite3_int64)d->binding.storage_generation&&
     sqlite3_column_int64(st,1)==(sqlite3_int64)d->binding.deadline?VEIL_STORE_UNKNOWN:VEIL_STORE_MISMATCH;
   if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
  }
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
/* Durable denial is checked by factory/current under the same coordinator.
 * Existing local effect/UNKNOWN/cancel is never promoted by reopening a loan. */
static veil_store_status core_store_recover_denial(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;veil_store_status s=core_store_cancel_check(q);if(s)return s;
 sqlite3_stmt*st=NULL;
 if(sqlite3_prepare_v2(d->store,"SELECT generation,deadline,status FROM core_effect WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 s=VEIL_STORE_SQL;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK){
  int z=sqlite3_step(st);
  if(z==SQLITE_DONE)s=VEIL_STORE_OK;
  else if(z==SQLITE_ROW){
   s=sqlite3_column_int64(st,0)==(sqlite3_int64)d->binding.storage_generation&&
    sqlite3_column_int64(st,1)==(sqlite3_int64)d->binding.deadline?VEIL_STORE_UNKNOWN:VEIL_STORE_MISMATCH;
   if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
  }
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
static veil_store_status core_store_cancel_persist(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;veil_store_status s=core_store_open(q);if(s)return s;
 /* Existing irreversible/pending result remains immutable. Cancellation
  * prevents further effects but does not rewrite its historical receipt. */
 s=core_store_cancel_check(q);if(s==VEIL_STORE_UNKNOWN)return VEIL_STORE_OK;if(s)return s;
 if(d->binding.storage_generation>INT64_MAX||d->binding.deadline>INT64_MAX)return VEIL_STORE_BOUND;
 if(d->store_transaction)return VEIL_STORE_UNKNOWN;
 if(sqlite3_exec(d->store,"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 d->store_transaction=1;
 unsigned char original[96]={0};memcpy(original,"YNXCORECANCELV1",15);
 memcpy(original+16,d->binding.intent,32);
 core_store_u64(original+48,d->binding.storage_generation);
 core_store_u64(original+56,d->binding.deadline);core_store_u64(original+64,d->binding.floor);
 core_store_u64(original+72,d->state[0].sequence);core_store_u64(original+80,d->state[1].sequence);
 sqlite3_stmt*st=NULL;
 if(sqlite3_prepare_v2(d->store,
  "INSERT INTO core_cancel(intent,generation,deadline,original) VALUES(?1,?2,?3,?4)",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||
  sqlite3_bind_int64(st,2,(sqlite3_int64)d->binding.storage_generation)!=SQLITE_OK||
  sqlite3_bind_int64(st,3,(sqlite3_int64)d->binding.deadline)!=SQLITE_OK||
  sqlite3_bind_blob(st,4,original,sizeof(original),SQLITE_STATIC)!=SQLITE_OK))s=VEIL_STORE_SQL;
 if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->store)!=1))s=VEIL_STORE_MISMATCH;
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 /* Denial is allowed after deadline/UNKNOWN; it never authorizes a mutation. */
 if(!s&&(sqlite3_exec(d->store,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(d->store)))s=VEIL_STORE_UNKNOWN;
 if(!s)d->store_transaction=0;
 if(!s){
  unsigned char readback[96];size_t n=0;
  s=core_store_effect_read(q,readback,sizeof(readback),&n,8);
  if(!s&&(n!=sizeof(original)||CRYPTO_memcmp(original,readback,n)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(readback,sizeof(readback));
 }
 OPENSSL_cleanse(original,sizeof(original));return s;
}

static veil_store_status core_store_nonce_intent_inner(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d||q->unknown||d->unknown)return VEIL_STORE_UNKNOWN;
 if(!d->reserve_attempted||d->nonce_entered)return VEIL_STORE_DUPLICATE;
 if(d->binding.storage_generation>UINT32_MAX||d->binding.deadline>INT64_MAX||
  d->state[0].phase!=1||d->state[1].phase!=1||
  d->state[0].ordinal!=d->state[1].ordinal||
  d->state[0].ordinal>INT64_MAX||
  q->row->allocator_counter.expected_counter==UINT64_MAX||
  d->state[0].ordinal!=q->row->allocator_counter.expected_counter+1)return VEIL_STORE_MISMATCH;
 veil_store_status s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,5);
 if(s)return s;
 s=core_driver_fence_enter(q,0);if(s)return s;
 s=core_store_begin(q);sqlite3_stmt*st=NULL;
 /* Generation32 || key-global protected ordinal64. This is only RESERVED;
  * the distinct actual counter burn must be independently adjudicated before
  * any sealing/key use. No nonce bytes are returned by this entry. */
 uint64_t gen=d->binding.storage_generation;
 for(unsigned i=0;i<4;i++)d->nonce[3-i]=(unsigned char)(gen>>(8*i));
 if(d->state[0].ordinal>=UINT64_C(0x1000000000000))s=VEIL_STORE_BOUND;
 core_store_u64(d->nonce+4,d->state[0].ordinal<<16);
 if(!s&&sqlite3_prepare_v2(d->store,
  "INSERT INTO core_nonce(key_identity,generation,ordinal,intent,deadline,nonce) VALUES(?1,?2,?3,?4,?5,?6)",
  -1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&(sqlite3_bind_blob(st,1,q->row->storage_key_identity,32,SQLITE_STATIC)!=SQLITE_OK||
   sqlite3_bind_int64(st,2,(sqlite3_int64)gen)!=SQLITE_OK||
   sqlite3_bind_int64(st,3,(sqlite3_int64)d->state[0].ordinal)!=SQLITE_OK||
   sqlite3_bind_blob(st,4,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||
   sqlite3_bind_int64(st,5,(sqlite3_int64)d->binding.deadline)!=SQLITE_OK||
   sqlite3_bind_blob(st,6,d->nonce,12,SQLITE_STATIC)!=SQLITE_OK))s=VEIL_STORE_SQL;
 if(!s){d->nonce_entered=1;
  if(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->store)!=1)s=VEIL_STORE_MISMATCH;}
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s)s=core_store_commit(q);
 veil_store_status z=core_driver_fence_leave(q);
 if(s){d->unknown=1;return core_resource_fail(q,s);}
 return z;
}
/* Re-read the actual protected nonce row. Matching bytes alone are NOT the
 * independent allocator proof. No UPDATE/replace/re-reservation on this path. */
static veil_store_status core_store_nonce_read(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;sqlite3_stmt*st=NULL;
 if(!d->nonce_entered)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_store_open(q);if(s)return s;
 if(sqlite3_prepare_v2(d->store,
 "SELECT intent,deadline,nonce FROM core_nonce WHERE key_identity=?1 AND generation=?2 AND ordinal=?3",
 -1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 s=VEIL_STORE_SQL;
 if(sqlite3_bind_blob(st,1,q->row->storage_key_identity,32,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_int64(st,2,(sqlite3_int64)d->binding.storage_generation)==SQLITE_OK&&
   sqlite3_bind_int64(st,3,(sqlite3_int64)d->state[0].ordinal)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
  const void*a=sqlite3_column_blob(st,0),*b=sqlite3_column_blob(st,2);
  s=sqlite3_column_type(st,0)==SQLITE_BLOB&&sqlite3_column_bytes(st,0)==32&&a&&
   !CRYPTO_memcmp(a,d->binding.intent,32)&&sqlite3_column_int64(st,1)==(sqlite3_int64)d->binding.deadline&&
   sqlite3_column_type(st,2)==SQLITE_BLOB&&sqlite3_column_bytes(st,2)==12&&b&&
   !CRYPTO_memcmp(b,d->nonce,12)&&sqlite3_step(st)==SQLITE_DONE?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
static veil_store_status core_store_cas_row(ynx_native_core_resource_loan*q,const ynx_native_core_cipher_cas*r){
 core_domain_driver*d=q->driver;sqlite3_stmt*st=NULL;
 /* All callers are same Native inventory; this is still a complete BLOB CAS,
  * not digest-only or a public caller-supplied next-state authority. */
 const char*sql=r->previous_version?
  "UPDATE core_record SET version=?1,ciphertext=?2 WHERE name=?3 AND version=?4 AND ciphertext=?5":
  "INSERT INTO core_record(version,ciphertext,name) VALUES(?1,?2,?3)";
 if(sqlite3_prepare_v2(d->store,sql,-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_SQL;
 if(sqlite3_bind_int64(st,1,(sqlite3_int64)r->next_version)==SQLITE_OK&&
   sqlite3_bind_blob(st,2,r->next_ciphertext.data,(int)r->next_ciphertext.size,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_blob(st,3,r->name.data,(int)r->name.size,SQLITE_STATIC)==SQLITE_OK&&
   (!r->previous_version||(sqlite3_bind_int64(st,4,(sqlite3_int64)r->previous_version)==SQLITE_OK&&
    sqlite3_bind_blob(st,5,r->previous_ciphertext.data,(int)r->previous_ciphertext.size,SQLITE_STATIC)==SQLITE_OK)))
  s=sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(d->store)==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
static unsigned core_counter_index(unsigned slot){return slot?slot+4:2;}
static veil_store_status core_counter_current(ynx_native_core_resource_loan*q,unsigned slot){
 core_domain_driver*d=q->driver;if(slot>2||!d||!d->counter_entered[slot])return VEIL_STORE_REQUIRED;
 for(unsigned j=0;j<2;j++){
  if(!d->command_authorizer[slot][j])return VEIL_STORE_REQUIRED;
  veil_store_status s=core_resource_primitive(ynx_tpm2_command_authorizer_current(d->command_authorizer[slot][j]));
  if(s)return s;
 }
 return core_resource_primitive(ynx_tpm2_owner_increment_observed_current(
  q->objects[core_counter_index(slot)],d->counter_challenge[slot],
  &d->counter_attestation[slot],&d->counter_signature[slot]));
}
static veil_store_status core_counter_burn(ynx_native_core_resource_loan*q,unsigned slot){
 core_domain_driver*d=q->driver;if(!d||!d->held||slot>2)return VEIL_STORE_LIFETIME;
 if(d->counter_entered[slot])return d->counter_observed[slot]?core_counter_current(q,slot):VEIL_STORE_UNKNOWN;
 veil_store_status s=core_driver_policy(q);if(s)return s;
 for(unsigned j=0;j<2;j++){
  const ynx_tpm2_resource_selection*r=&q->row->command_auth[slot][j];
  const ynx_tpm2_command_authorizer_selection*c=&q->row->command_authorizer[slot][j];
  if(!r->device||!c->device||r->object_name.size!=34||c->original_name.size!=34)return VEIL_STORE_REQUIRED;
  if(r->monotonic_deadline_ns!=d->binding.deadline||c->monotonic_deadline_ns!=d->binding.deadline||
   r->object_name.size!=34||c->original_name.size!=34)return VEIL_STORE_MISMATCH;
  /* Distinct original command custody, never a storage/integrity/role borrow. */
  for(unsigned k=0;k<7;k++){
   const ynx_tpm2_resource_selection*all[]={&q->row->storage,&q->row->allocator_integrity,
    &q->row->allocator_counter,&q->row->domain_integrity[0],&q->row->domain_integrity[1],
    &q->row->domain_floor[0],&q->row->domain_floor[1]};
   const TPM2B_NAME*names[]={&all[k]->object_name,&all[k]->salt_name,&all[k]->ak_name,&all[k]->counter_name};
   for(unsigned v=0;v<4;v++)if(names[v]->size==34&&
    (!CRYPTO_memcmp(names[v]->name,r->object_name.name,34)||
     !CRYPTO_memcmp(names[v]->name,c->original_name.name,34)))return VEIL_STORE_MISMATCH;
  }
  if(j&&(!CRYPTO_memcmp(c->original_name.name,q->row->command_authorizer[slot][0].original_name.name,34)||
   !CRYPTO_memcmp(c->administration_domain,q->row->command_authorizer[slot][0].administration_domain,32)||
   !CRYPTO_memcmp(r->object_name.name,q->row->command_auth[slot][0].object_name.name,34)))return VEIL_STORE_MISMATCH;
  if(!d->command_auth[slot][j]){
   s=core_resource_primitive(ynx_tpm2_owner_open(r,&d->command_auth[slot][j]));if(s)return s;
   s=core_resource_primitive(ynx_tpm2_owner_unseal(d->command_auth[slot][j]));if(s)return s;
   s=core_resource_primitive(ynx_tpm2_command_authorizer_open(c,d->command_auth[slot][j],
    &d->command_authorizer[slot][j]));if(s)return s;
  }
 }
 /* Before irreversible command, persist exact two-domain ENTERED originals.
  * Nonce burn phase2; independent floor burns phase4. Each exact digest binds
  * the same intent, generation/deadline, domain predecessors and slot. */
 unsigned char challenge[32+2*YNX_DOMAIN_STATE_BYTES+8];
 memcpy(challenge,d->binding.intent,32);
 memcpy(challenge+32,d->originals[0],YNX_DOMAIN_STATE_BYTES);
 memcpy(challenge+32+YNX_DOMAIN_STATE_BYTES,d->originals[1],YNX_DOMAIN_STATE_BYTES);
 core_store_u64(challenge+32+2*YNX_DOMAIN_STATE_BYTES,slot);
 if(!SHA256(challenge,sizeof(challenge),d->counter_challenge[slot]))return VEIL_STORE_UNKNOWN;
 OPENSSL_cleanse(challenge,sizeof(challenge));
 for(unsigned i=0;i<2;i++){
  ynx_domain_state next=d->state[i];
  if(next.sequence==UINT64_MAX)return VEIL_STORE_BOUND;
  next.sequence++;next.phase=slot?4:2;
  if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor))return VEIL_STORE_UNKNOWN;
  s=core_driver_domain_cas(q,i,&next);OPENSSL_cleanse(&next,sizeof(next));if(s)return s;
 }
 d->counter_entered[slot]=1;
 int z=ynx_tpm2_owner_increment_signed_once(q->objects[core_counter_index(slot)],
  d->command_authorizer[slot][0],d->command_authorizer[slot][1]);
 if(z!=YNX_TPM2_OK&&z!=YNX_TPM2_UNKNOWN)return core_resource_primitive(z);
 /* UNKNOWN from reserve_mutation is not automatically success. Actual named
  * AK certification+signature verification+fresh NV read are mandatory. The
  * primitive uncertainty remains sticky, and no fresh increment is attempted. */
 s=core_counter_current(q,slot);if(s)return s;d->counter_observed[slot]=1;
 return core_driver_policy(q);
}

static veil_store_status core_store_allocator_ready(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d||!d->held||!d->nonce_entered)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_store_nonce_read(q);if(s)return s;
 return core_counter_burn(q,0);
}
#include "ynx_native_core_engine_binding.inc"
static veil_store_status core_store_cipher_inner(ynx_native_core_resource_loan*q,
 const ynx_native_core_cipher_cas*rows,size_t n){
 core_domain_driver*d=q->driver;
 if(!d||q->unknown||d->unknown)return VEIL_STORE_UNKNOWN;
 if(!rows||!n||n>32||!d->nonce_entered||d->effect_entered)return VEIL_STORE_BOUND;
 /* This is local protected storage, NOT an independent final/Core-ready constructor. */
 veil_store_status s=d->held?core_driver_policy(q):core_driver_fence_enter(q,0);if(s)return s;
 s=core_store_allocator_ready(q);
 if(s){veil_store_status z=core_driver_fence_leave(q);
  if(d->counter_entered[0]||d->state[0].phase!=d->state[1].phase){d->unknown=1;return core_resource_fail(q,s);}
  return z?z:s;
 }
 size_t size=96+n*128;if(size>65536){core_driver_fence_leave(q);return VEIL_STORE_BOUND;}
 unsigned char *original=calloc(1,size);if(!original){core_driver_fence_leave(q);return VEIL_STORE_SQL;}
 memcpy(original,"YNXCORECASV1",12);memcpy(original+16,d->binding.intent,32);
 core_store_u64(original+48,d->binding.storage_generation);core_store_u64(original+56,d->binding.deadline);
 memcpy(original+64,d->nonce,12);core_store_u64(original+80,n);
 for(size_t i=0;i<n;i++){
  const ynx_native_core_cipher_cas*r=&rows[i];unsigned char *b=original+96+i*128;
  unsigned char exact_nonce[12];memcpy(exact_nonce,d->nonce,12);
  exact_nonce[10]=(unsigned char)(i>>8);exact_nonce[11]=(unsigned char)i;
  if(!r->name.data||!r->name.size||r->name.size>128||!r->next_ciphertext.data||
   !r->next_ciphertext.size||r->next_ciphertext.size>1049132||
   r->previous_ciphertext.size>1049132||(r->previous_ciphertext.size&&!r->previous_ciphertext.data)||
   r->next_version<=r->previous_version||r->next_version>INT64_MAX||
   (!d->engine_prepared&&CRYPTO_memcmp(r->storage_nonce,exact_nonce,12))){s=VEIL_STORE_BOUND;break;}
  /* Bound import contains already sealed ciphertext from the inventory-owned
   * normal finish. Its original envelope nonce is not overwritten or reused.
   * d->nonce is this transaction's allocator reservation, NOT a claim that a
   * second encryption took place. Only the fixed finish importer enables it. */
  if(d->engine_prepared){
   /* The original immutable native subtype, not row rank, selects tagged init
    * nonce location. Ordinary message1..6 retain their exact old offset400. */
   size_t off=400,min=428;
   if(d->engine_native_kind==VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE){
    off=544;min=792;
    if(n!=1||r->next_ciphertext.size<min||memcmp(r->next_ciphertext.data,"YNXREC1\0",8)||
     r->next_ciphertext.data[8]||r->next_ciphertext.data[9]!=2||
     core_engine_u32(r->next_ciphertext.data+12)!=624||core_engine_u32(r->next_ciphertext.data+24)!=7){s=VEIL_STORE_MISMATCH;break;}
   }
   if(r->next_ciphertext.size<min||CRYPTO_memcmp(r->storage_nonce,r->next_ciphertext.data+off,12)){s=VEIL_STORE_MISMATCH;break;}
  }
  for(size_t j=0;j<i;j++)if(r->name.size==rows[j].name.size&&
   !CRYPTO_memcmp(r->name.data,rows[j].name.data,r->name.size)){s=VEIL_STORE_DUPLICATE;break;}
  if(s)break;
  if(!SHA256(r->name.data,r->name.size,b)||!SHA256(r->next_ciphertext.data,r->next_ciphertext.size,b+32)){s=VEIL_STORE_UNKNOWN;break;}
  core_store_u64(b+64,r->previous_version);core_store_u64(b+72,r->next_version);
  if(!SHA256(r->previous_ciphertext.data?r->previous_ciphertext.data:(const unsigned char*)"",
    r->previous_ciphertext.size,b+80)){s=VEIL_STORE_UNKNOWN;break;}
 }
 if(!s)s=core_driver_policy(q);
 if(!s)s=core_store_nonce_read(q);
 if(!s)s=core_store_begin(q);
 if(!s){d->effect_entered=1;d->effect_original=original;d->effect_original_size=size;original=NULL;
  for(size_t i=0;!s&&i<n;i++)s=core_store_cas_row(q,&rows[i]);
 }
 sqlite3_stmt*st=NULL;
 if(!s&&sqlite3_prepare_v2(d->store,
  "INSERT INTO core_effect(intent,generation,deadline,original,status) VALUES(?1,?2,?3,?4,5)",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||
  sqlite3_bind_int64(st,2,(sqlite3_int64)d->binding.storage_generation)!=SQLITE_OK||
  sqlite3_bind_int64(st,3,(sqlite3_int64)d->binding.deadline)!=SQLITE_OK||
  sqlite3_bind_blob(st,4,d->effect_original,(int)d->effect_original_size,SQLITE_STATIC)!=SQLITE_OK))s=VEIL_STORE_SQL;
 if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->store)!=1))s=VEIL_STORE_MISMATCH;
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s)s=core_engine_insert(q);
 if(!s)s=core_store_commit(q);
 if(!s){unsigned char readback[65536];size_t got=0;
  s=core_store_effect_read(q,readback,sizeof(readback),&got,5);
  if(!s&&(got!=d->effect_original_size||CRYPTO_memcmp(readback,d->effect_original,got)))s=VEIL_STORE_MISMATCH;
  if(!s&&!SHA256(readback,got,d->effect_digest))s=VEIL_STORE_UNKNOWN;
  OPENSSL_cleanse(readback,sizeof(readback));
 }
 if(!s)s=core_engine_after_commit(q);
 if(!s){
  for(unsigned i=0;!s&&i<2;i++){
   ynx_domain_state next=d->state[i];
   if(next.sequence==UINT64_MAX){s=VEIL_STORE_BOUND;break;}
   next.sequence++;next.phase=5;memcpy(next.ciphertext,d->effect_digest,32);
   /* Commit the typed binding as well as the complete CAS transcript into
    * each independently MACed head. This immutable effect-stage original is
    * distinct from later checkpoint/terminal observations. */
   unsigned char chain[96];memcpy(chain,d->state[i].head,32);memcpy(chain+32,d->effect_digest,32);
   memset(chain+64,0,32);
   if(d->engine_prepared&&!SHA256(d->engine_binding,416,chain+64))s=VEIL_STORE_UNKNOWN;
   if(!s&&!SHA256(chain,sizeof(chain),next.head))s=VEIL_STORE_UNKNOWN;
   if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor))s=VEIL_STORE_UNKNOWN;
   if(!s)s=core_driver_domain_cas(q,i,&next);
   OPENSSL_cleanse(&next,sizeof(next));
  }
  if(!s){memcpy(d->effect_domain_originals,d->originals,sizeof(d->originals));d->local_committed=1;} /* local only */
 }
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(original){OPENSSL_cleanse(original,size);free(original);}
 if(s&&d->effect_entered){d->unknown=1;return core_resource_fail(q,s);}return s;
}
veil_store_status ynx_native_core_resource_driver_nonce_intent(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_store_nonce_intent_inner(q);q->active=0;return q->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_native_core_resource_driver_effect_query(ynx_native_core_resource_loan*p,
 unsigned char*out,size_t cap,size_t*written){
 if(!out||!written||!cap)return VEIL_STORE_BOUND;
 *written=0;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_driver_fence_enter(q,1);
 if(!s)s=core_store_effect_read(q,out,cap,written,5);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;if(s)return core_resource_fail(q,s);
 return q->unknown||q->driver->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_cancel(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 s=core_driver_fence_enter(q,1);
 if(!s){
  /* Linearization is the same fence before any new CAS/COMMIT/key use.
   * Selected cancellation is sticky even when primitive cleanup later fails. */
  s=core_store_cancel_persist(q);
  d->cancelled=1;
  for(unsigned i=0;i<7;i++)if(q->objects[i]){
   int z=ynx_tpm2_owner_cancel(q->objects[i]);
   if(z!=YNX_TPM2_REFUSED&&z!=YNX_TPM2_OK&&z!=YNX_TPM2_UNKNOWN&&!s)s=VEIL_STORE_UNKNOWN;
  }
  d->unknown=1;core_resource_fail(q,s?s:VEIL_STORE_UNKNOWN);
 }
 veil_store_status z=core_driver_fence_leave(q);q->active=0;
 if(s)return core_resource_fail(q,s);
 return z?z:VEIL_STORE_UNKNOWN;
}


#include "ynx_native_core_initialization_record_private.h"
/* A typed FirstDeviceCore record is borrowed from the SAME real SDK policy.
 * Public purpose/row count alone never selects the local initialization path.
 * This validates exact immutable originals, not Native admission or lease. */
static uint64_t core_initialization_be64(const unsigned char*p){uint64_t x=0;for(unsigned i=0;i<8;i++)x=(x<<8)|p[i];return x;}
static veil_store_status core_initialization_plan_match(
 const ynx_native_core_enforcing_binding_v2*binding,
 const ynx_core_initialization_record_v1*original,
 const ynx_native_core_plain_cas*rows,size_t n){
 static const unsigned char kind[]="first-device-bootstrap-v1";
 if(!binding||!original||!rows||n!=1||!rows[0].expected)return VEIL_STORE_BOUND;
 const ynx_storage_expected*e=rows[0].expected;
 if(binding->purpose!=1||original->version!=1||original->purpose!=1||
  original->storage_generation!=binding->storage_generation||
  CRYPTO_memcmp(original->request_digest,binding->intent,32)||
  !original->kind.data||original->kind.size!=sizeof(kind)||memcmp(original->kind.data,kind,sizeof(kind))||
  !original->id.data||original->id.size!=65||original->id.data[64]||
  !original->plaintext.data||original->plaintext.size<152||original->plaintext.size>65536||
  !rows[0].plaintext.data||rows[0].plaintext.size!=original->plaintext.size||
  CRYPTO_memcmp(rows[0].plaintext.data,original->plaintext.data,original->plaintext.size)||
  e->container_class!=YNX_STORAGE_RECORD||e->kind!=7||e->generation!=binding->storage_generation||
  CRYPTO_memcmp(e->request,binding->intent,32)||!e->name.data||e->name.size!=64||
  CRYPTO_memcmp(e->name.data,original->id.data,64))return VEIL_STORE_MISMATCH;
 for(unsigned i=0;i<64;i++)if(!((original->id.data[i]>='0'&&original->id.data[i]<='9')||
  (original->id.data[i]>='a'&&original->id.data[i]<='f')))return VEIL_STORE_MISMATCH;
 const unsigned char*p=original->plaintext.data;
 if(memcmp(p,"YNXFDI01",8)||p[8]||p[9]||p[10]||p[11]!=1||p[12]||p[13]||p[14]||p[15]!=7||
  core_initialization_be64(p+16)!=binding->storage_generation||CRYPTO_memcmp(p+56,binding->intent,32))return VEIL_STORE_MISMATCH;
 return VEIL_STORE_OK;
}
static veil_store_status core_plain_topology(ynx_native_core_resource_loan*q,
 const ynx_native_core_plain_cas*rows,size_t n,int*initialization){
 if(!q||!q->driver||!initialization||!rows||!n||n>32)return VEIL_STORE_BOUND;
 *initialization=0;core_domain_driver*d=q->driver;
 if(d->binding.purpose==1){
  ynx_core_initialization_record_v1 original={0};
  veil_store_status s=(veil_store_status)ynx_sdk_native_core_initialization_record_borrow_v1(q->policy,&original);
  if(!s)s=core_initialization_plan_match(&d->binding,&original,rows,n);
  if(!s)s=core_driver_policy(q);
  if(s)return s;
  *initialization=1;return VEIL_STORE_OK;
 }
 if(d->binding.purpose!=2)return VEIL_STORE_MISMATCH;
 for(size_t i=0;i<n;i++)if(!rows[i].expected||rows[i].expected->kind==7)return VEIL_STORE_MISMATCH;
 return VEIL_STORE_OK;
}

/* One original key-use implementation shared by normal complete ratchet and
 * typed pre-write sealing. The same driver owns all partial ciphertext/maps. */
static veil_store_status core_seal_rows(ynx_native_core_resource_loan*q,
 const ynx_native_core_plain_cas*rows,size_t n,int initialization,
 ynx_native_core_cipher_cas cas[32]){
 core_domain_driver*d=q->driver;veil_store_status s=VEIL_STORE_OK;
 if(initialization)d->sealed_initialization=1;
 for(size_t i=0;!s&&i<n;i++){
  const ynx_native_core_plain_cas*r=&rows[i];
  if(!r->expected||!r->plaintext.data||!r->plaintext.size||
    r->plaintext.size>1048576||r->previous_ciphertext.size>1049132||
    (r->previous_ciphertext.size&&!r->previous_ciphertext.data)){s=VEIL_STORE_BOUND;break;}
  ynx_storage_expected expected=*r->expected;
  if(expected.generation!=d->binding.storage_generation||
    expected.next_version<=expected.base_version||
    CRYPTO_memcmp(expected.request,d->binding.intent,32)||
    expected.container_class!=(!initialization&&i+1==n?YNX_STORAGE_QUEUE:YNX_STORAGE_RECORD)||
    r->plaintext.size>(!initialization&&i+1==n?1048576u:65536u)){s=VEIL_STORE_MISMATCH;break;}
  unsigned char nonce[12];memcpy(nonce,d->nonce,12);nonce[10]=(unsigned char)(i>>8);nonce[11]=(unsigned char)i;
  memcpy(expected.storage_nonce,nonce,12);
  /* The normal storage envelope enforces all expected field sizes and AAD.
   * Copy sensitive plaintext into private locked pages for key-use scope. */
  long page=sysconf(_SC_PAGESIZE);if(page<=0||page>1048576){s=VEIL_STORE_BOUND;break;}
  size_t pages=(r->plaintext.size+(size_t)page-1)/(size_t)page*(size_t)page;
  unsigned char*plain=mmap(NULL,pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);
  if(plain==MAP_FAILED){s=VEIL_STORE_SQL;break;}
  int locked=mlock(plain,pages)==0;
  if(!locked){if(munmap(plain,pages))s=VEIL_STORE_UNKNOWN;else s=VEIL_STORE_SQL;break;}
  memcpy(plain,r->plaintext.data,r->plaintext.size);
  d->seal_entered=1;d->sealed_count=i+1; /* retain ciphertext before interpreting a late refusal */
  s=core_resource_primitive(ynx_tpm2_owner_storage_seal(q->objects[0],q->row->storage_key_identity,
    &expected,plain,r->plaintext.size,&d->sealed_rows[i]));
  OPENSSL_cleanse(plain,pages);
  /* Failed munlock/unmap is unresolved; retain original mapping for cleanup.
   * The mapping remains owned by driver below, never lose its pointer. */
  if(munlock(plain,pages)||munmap(plain,pages)){
   d->sensitive_map=plain;d->sensitive_pages=pages;d->unknown=1;s=VEIL_STORE_UNKNOWN;
  }
  if(s)break;
  cas[i].name=expected.name;cas[i].previous_ciphertext=r->previous_ciphertext;
  cas[i].next_ciphertext=(ynx_original_bytes){d->sealed_rows[i].bytes,d->sealed_rows[i].size};
  cas[i].previous_version=expected.base_version;cas[i].next_version=expected.next_version;
  memcpy(cas[i].storage_nonce,nonce,12);
  s=core_driver_policy(q);
 }
 return s;
}

veil_store_status ynx_native_core_resource_driver_protected_ratchet(
 ynx_native_core_resource_loan*p,const ynx_native_core_plain_cas*rows,size_t n){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;
 if(!d||!rows||!n||n>32){q->active=0;return VEIL_STORE_BOUND;}
 if(q->unknown||d->unknown||d->seal_entered){q->active=0;return VEIL_STORE_UNKNOWN;}
 if(d->binding.purpose!=2){q->active=0;return VEIL_STORE_MISMATCH;}
 int initialization=0;s=core_plain_topology(q,rows,n,&initialization);
 for(unsigned op=2;!s&&op<=6;op++)if(op!=3)s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,op);
 if(!s)s=core_driver_fence_enter(q,0);
 if(!s)s=core_store_allocator_ready(q);
 ynx_native_core_cipher_cas cas[32];memset(cas,0,sizeof(cas));
 if(!s)s=core_seal_rows(q,rows,n,initialization,cas);
 if(!s)s=core_store_cipher_inner(q,cas,n);
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;
 if(s&&(d->seal_entered||d->counter_entered[0])){d->unknown=1;return core_resource_fail(q,s);}
 return q->unknown?VEIL_STORE_UNKNOWN:s;
}

/* Exact typed pre-write path: seal ONCE under actual reservation/current,
 * but do not run core CAS before the normal checked-store owns its finish.
 * No public metadata/secret output; subsequent engine import must consume
 * precisely this same retained ciphertext. Uncertainty never permits reseal. */
#include "ynx_native_core_initialization_descriptor.inc"
veil_store_status ynx_native_core_resource_driver_initialization_ciphertext_borrow(
 ynx_native_core_resource_loan*p,ynx_original_bytes*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;
 if(!d||!d->sealed_initialization||!d->seal_entered||d->sealed_count!=1||
  !d->sealed_rows[0].bytes||!d->sealed_rows[0].size)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_policy(q);
 if(!s)*out=(ynx_original_bytes){d->sealed_rows[0].bytes,d->sealed_rows[0].size};
 q->active=0;return s;
}

/* Independently protected floor/head checkpoint. This persists actual named
 * counter certificates, not a locally invented public terminal or role proof.
 * The same original service owns both domain commits; half commit is UNKNOWN.
 */
static veil_store_status core_store_checkpoint_inner(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d||!d->local_committed||d->checkpoint_entered||q->unknown||d->unknown)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_driver_fence_enter(q,0);if(s)return s;
 for(unsigned i=0;!s&&i<2;i++){
  if(d->state[i].sequence==UINT64_MAX){s=VEIL_STORE_BOUND;break;}
  ynx_domain_state next=d->state[i];next.phase=5;next.sequence++;
  memcpy(next.ciphertext,d->effect_digest,32);
  /* Effect head was already advanced exactly once in the CAS phase. */
  if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor))s=VEIL_STORE_UNKNOWN;
  if(!s)s=core_driver_domain_cas(q,i,&next);
  OPENSSL_cleanse(&next,sizeof(next));
 }
 if(!s){d->checkpoint_entered=1;s=core_counter_burn(q,1);}
 if(!s)s=core_counter_burn(q,2);
 unsigned char raw[16384];size_t off=128;
 memset(raw,0,sizeof(raw));
 if(!s){
  memcpy(raw,"YNXCORECHECKPOINTV1",19);memcpy(raw+24,d->binding.intent,32);
  core_store_u64(raw+56,d->binding.storage_generation);
  core_store_u64(raw+64,d->binding.deadline);core_store_u64(raw+72,d->binding.floor);
  memcpy(raw+80,d->effect_digest,32);
  for(unsigned k=0;k<3&&!s;k++){
   if(!d->counter_observed[k]||!d->counter_attestation[k]||!d->counter_signature[k]){s=VEIL_STORE_REQUIRED;break;}
   s=core_counter_current(q,k);if(s)break;
   size_t begin=off;off+=8;
   if(off>=sizeof(raw)||Tss2_MU_TPM2B_ATTEST_Marshal(d->counter_attestation[k],raw,sizeof(raw),&off)||
    Tss2_MU_TPMT_SIGNATURE_Marshal(d->counter_signature[k],raw,sizeof(raw),&off)){s=VEIL_STORE_UNKNOWN;break;}
   core_store_u64(raw+begin,off-begin-8);
  }
 }
 for(unsigned i=0;!s&&i<2;i++){
  /* Actual independent floor counter value is original expected+1. The row
   * commits that observed floor and exact new head; no arbitrary caller floor. */
  const ynx_tpm2_resource_selection*f=&q->row->domain_floor[i];
  if(f->expected_counter!=d->binding.floor||f->expected_counter==UINT64_MAX||
   d->state[i].sequence==UINT64_MAX){s=VEIL_STORE_MISMATCH;break;}
  ynx_domain_state next=d->state[i];next.phase=4;next.floor=f->expected_counter+1;next.sequence++;
  if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor)){s=VEIL_STORE_UNKNOWN;break;}
  s=core_driver_domain_cas(q,i,&next);OPENSSL_cleanse(&next,sizeof(next));
  if(s)break;
  if(sqlite3_exec(d->db[i],"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK){s=VEIL_STORE_SQL;break;}
  d->transaction[i]=1;sqlite3_stmt*st=NULL;
  if(sqlite3_prepare_v2(d->db[i],"INSERT INTO core_checkpoint(intent,original) VALUES(?1,?2)",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
  if(!s&&(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||
   sqlite3_bind_blob(st,2,raw,(int)off,SQLITE_STATIC)!=SQLITE_OK))s=VEIL_STORE_SQL;
  if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->db[i])!=1))s=VEIL_STORE_MISMATCH;
  if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(!s)s=core_driver_policy(q);
  if(!s&&(sqlite3_exec(d->db[i],"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||
    !sqlite3_get_autocommit(d->db[i])))s=VEIL_STORE_UNKNOWN;
  if(!s)d->transaction[i]=0;
  /* Independent SELECT after actual COMMIT: do not hand the write buffer back
   * as if it were durable readback. Exact bytes and unique intent required. */
  st=NULL;
  if(!s&&sqlite3_prepare_v2(d->db[i],"SELECT original FROM core_checkpoint WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
  if(!s){
   s=VEIL_STORE_MISMATCH;
   if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
    const void*b=sqlite3_column_blob(st,0);int n=sqlite3_column_bytes(st,0);
    if(sqlite3_column_type(st,0)==SQLITE_BLOB&&n==(int)off&&b&&!CRYPTO_memcmp(b,raw,off)&&
      sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;
   }
  }
  if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 }
 if(!s){d->checkpoint_size=off;memcpy(d->checkpoint_original,raw,off);d->checkpoint_committed=1;}
 OPENSSL_cleanse(raw,sizeof(raw));
 veil_store_status z=core_driver_fence_leave(q);
 if(s){d->unknown=1;return core_resource_fail(q,s);}return z;
}
veil_store_status ynx_native_core_resource_driver_checkpoint(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_store_checkpoint_inner(q);q->active=0;return q->unknown?VEIL_STORE_UNKNOWN:s;
}
