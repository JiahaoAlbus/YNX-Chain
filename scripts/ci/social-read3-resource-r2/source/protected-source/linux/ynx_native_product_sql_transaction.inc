/* Existing original resource TU only. This owns the actual registered-store
 * BEGIN/ROLLBACK, never another SQLite file or in-memory success substitute. */
#include "ynx_native_product_sql_transaction_private.h"
struct ynx_product_sql_transaction {
 ynx_native_core_resource_loan*resource;pthread_t thread;ynx_native_core_device_binding_v2 device_binding;
 unsigned char store_reference[32];int active,begin_entered,owns_sql,finish_entered,ended,unknown,prepare_entered,prepared;uint32_t operation,sealed_mask;int local_entered,local_committed,end_entered,readonly_entered,readonly_committed;unsigned char catalog_after[32];
 veil_store_status first;struct ynx_product_sql_transaction*next;
};
extern int32_t ynx_sdk_native_core_operation_kind_v2(void *,uint32_t *);
/* Matching Main context implementation REQUIRED before link. This is not an
 * installer, new signed purpose or replacement for genuine C device-current. */
extern int32_t ynx_sdk_native_core_own_records_current_v1(void *);
extern int32_t ynx_sdk_native_core_own_records_namespace_v1(void *,uint32_t);
static pthread_mutex_t product_sql_lock=PTHREAD_MUTEX_INITIALIZER;
static ynx_product_sql_transaction*product_sql_inventory;static size_t product_sql_count;
static veil_store_status product_sql_recognize(ynx_product_sql_transaction*p){
 pthread_mutex_lock(&product_sql_lock);ynx_product_sql_transaction*q=product_sql_inventory;while(q&&q!=p)q=q->next;
 veil_store_status s=!q?VEIL_STORE_REQUIRED:!pthread_equal(q->thread,pthread_self())?VEIL_STORE_THREAD:VEIL_STORE_OK;
 pthread_mutex_unlock(&product_sql_lock);return s;
}
static veil_store_status product_sql_fail(ynx_product_sql_transaction*p,veil_store_status s){
 if(s){if(!p->first)p->first=s;p->unknown=1;}return p->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
static veil_store_status product_sql_path_current(ynx_product_sql_transaction*p,int authority){
 ynx_native_core_resource_loan*q=core_resource_recognized(p->resource);
 if(!q||!pthread_equal(q->thread,pthread_self())||!q->driver||!q->row)return VEIL_STORE_REQUIRED;
 core_domain_driver*d=q->driver;unsigned char ref[32];veil_store_status s=core_store_reference_make(q,ref);
 if(!s&&CRYPTO_memcmp(ref,p->store_reference,32))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_store_open(q);
 if(!s&&authority)s=core_product_catalog_current(q);
 if(!s&&authority)s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s&&authority)s=core_driver_policy(q);
 if(!s&&(!p->begin_entered||(!p->ended&&!p->local_committed&&!p->readonly_committed&&(!p->owns_sql||!d->store_transaction||sqlite3_get_autocommit(d->store)))))s=VEIL_STORE_UNKNOWN;
 return s;
}
veil_store_status ynx_product_sql_begin_v1(ynx_native_core_resource_loan*supplied,
 const ynx_native_core_device_binding_v2*binding,const unsigned char same_store[32],ynx_product_sql_transaction**out){
 if(!binding||!same_store||!out||*out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(supplied,&q);if(s)return s;
 /* Per-transaction Native policy is INDEPENDENT of accepted-device root.
  * Reject original initialize operation1. Neither a genuine device nor its old
  * final/init q can supply a perpetual local-record write authorization. */
 uint32_t operation=0;s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s)s=(veil_store_status)ynx_sdk_native_core_operation_kind_v2(q->policy,&operation);
 if(!s&&operation!=3&&operation!=4)s=VEIL_STORE_MISMATCH;
 if(!s)s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,3);
 if(!s&&operation==4)for(uint32_t op=2;!s&&op<=6;op++)s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,op);
 if(!s)s=core_driver_policy(q);
 if(s){q->active=0;return s;}
 ynx_product_sql_transaction*t=calloc(1,sizeof(*t));if(!t){q->active=0;return VEIL_STORE_SQL;}
 t->resource=q;t->thread=pthread_self();t->operation=operation;memcpy(t->store_reference,same_store,32);
 pthread_mutex_lock(&product_sql_lock);
 for(ynx_product_sql_transaction*x=product_sql_inventory;x;x=x->next)if(x->resource==q&&!x->ended){pthread_mutex_unlock(&product_sql_lock);free(t);q->active=0;return VEIL_STORE_FROZEN;}
 if(product_sql_count>=32||q->product_sql_borrows>=32){pthread_mutex_unlock(&product_sql_lock);free(t);q->active=0;return VEIL_STORE_BOUND;}
 product_sql_count++;q->product_sql_borrows++;t->next=product_sql_inventory;product_sql_inventory=t;*out=t;pthread_mutex_unlock(&product_sql_lock);
 t->active=1;s=core_driver_fence_enter(q,0);
 unsigned char ref[32];ynx_native_core_device_binding_v2 authenticated={0};uint64_t generation=0;
 if(!s)s=(veil_store_status)ynx_sdk_native_core_storage_binding_v2(q->policy,binding->classic,binding->pq,&authenticated,&generation);
 if(!s&&(generation!=q->driver->binding.storage_generation||CRYPTO_memcmp(&authenticated,binding,sizeof(authenticated))))s=VEIL_STORE_MISMATCH;
 if(!s)memcpy(&t->device_binding,&authenticated,sizeof(authenticated));
 if(!s)s=core_store_reference_make(q,ref);
 if(!s&&CRYPTO_memcmp(ref,same_store,32))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_store_open(q);
 if(!s)s=core_product_catalog_current(q);
 if(!s&&(q->driver->store_transaction||!sqlite3_get_autocommit(q->driver->store)))s=VEIL_STORE_FROZEN;
 if(!s){t->begin_entered=1;s=core_store_begin(q);t->owns_sql=q->driver->store&&!sqlite3_get_autocommit(q->driver->store);}
 OPENSSL_cleanse(&authenticated,sizeof(authenticated));
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}
veil_store_status ynx_product_sql_current_v1(ynx_product_sql_transaction*t){
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(t->ended)return VEIL_STORE_LIFETIME;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}
veil_store_status ynx_product_sql_rollback_once_v1(ynx_product_sql_transaction*t){
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->finish_entered||t->ended)return VEIL_STORE_DUPLICATE;
 ynx_native_core_resource_loan*q=core_resource_recognized(t->resource);
 if(!q||!pthread_equal(q->thread,pthread_self())||q->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 t->active=1;q->active=1;t->finish_entered=1; /* BEFORE original cleanup invocation */
 s=core_driver_fence_enter(q,1);
 core_domain_driver*d=q->driver;
 if(!s&&!t->owns_sql){
  /* A refused begin that acquired no SQL transaction has cleanup custody only.
   * Never ROLLBACK a pre-existing transaction owned by another original path. */
  t->ended=4;
 }else if(!s)s=product_sql_path_current(t,0);
 if(!s&&t->owns_sql){
  if(sqlite3_exec(d->store,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(d->store))s=VEIL_STORE_UNKNOWN;
  else {d->store_transaction=0;t->owns_sql=0;t->ended=2;}
 }
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}
veil_store_status ynx_product_sql_outcome_v1_query(ynx_product_sql_transaction*t,ynx_product_sql_outcome_v1*out){
 if(!out)return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);
 if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 ynx_native_core_resource_loan*q=core_resource_recognized(t->resource);if(!q||q->active||!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_FROZEN;
 q->active=1;t->active=1;s=core_driver_fence_enter(q,1);
 if(!s&&t->ended!=4)s=product_sql_path_current(t,0);
 if(!s&&t->ended==4){unsigned char ref[32];s=core_store_reference_make(q,ref);if(!s&&CRYPTO_memcmp(ref,t->store_reference,32))s=VEIL_STORE_MISMATCH;}
 if(!s&&t->ended==2&&(!q->driver->store||!sqlite3_get_autocommit(q->driver->store)))s=VEIL_STORE_UNKNOWN;
 /* Exact-intent recovery is READ ONLY. A valid paired original may prove
  * durable end after an ACK/current failure, without clearing sticky UNKNOWN
  * or calling checkpoint/finish again. Missing/half proof is not success. */
 uint32_t committed=0;
 if(!s&&t->readonly_committed){
  if(!q->driver->store_transaction&&sqlite3_get_autocommit(q->driver->store))committed=1;else s=VEIL_STORE_UNKNOWN;
 }
 if(!s&&!committed&&t->end_entered&&t->local_committed){
  veil_store_status proof=core_product_terminal_query(q,t->store_reference);
  if(!proof)committed=1;else if(t->ended==1)s=proof;
 }
 ynx_product_sql_outcome_v1 v={.version=1,.state=committed?1:(t->ended==2?2:(t->unknown||t->end_entered||t->ended==4?3:0)),.ended=(committed||t->ended==2||t->ended==4)?1:0,.owner_unknown=t->unknown,.first_cause=t->first,.cleanup_only=t->ended==4};
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;if(!s)*out=v;return s;
}
veil_store_status ynx_product_sql_drop_v1(ynx_product_sql_transaction**slot){
 if(!slot)return VEIL_STORE_BOUND;
 if(!*slot)return VEIL_STORE_OK;
 ynx_product_sql_transaction*t=*slot;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active||(!t->ended&&t->begin_entered))return VEIL_STORE_FROZEN;
 ynx_native_core_resource_loan*q=core_resource_recognized(t->resource);
 if(!q||!q->driver||!q->product_sql_borrows)return product_sql_fail(t,VEIL_STORE_UNKNOWN);
 if(t->owns_sql)return product_sql_fail(t,VEIL_STORE_UNKNOWN);
 if(t->ended==1){ynx_product_sql_outcome_v1 proof={0};s=ynx_product_sql_outcome_v1_query(t,&proof);
  if(s||proof.state!=1||!proof.ended)return product_sql_fail(t,s?s:VEIL_STORE_UNKNOWN);}
 if(t->ended==2&&(!q->driver->store||q->driver->store_transaction||!sqlite3_get_autocommit(q->driver->store)))return product_sql_fail(t,VEIL_STORE_UNKNOWN);
 pthread_mutex_lock(&product_sql_lock);ynx_product_sql_transaction**p=&product_sql_inventory;while(*p&&*p!=t)p=&(*p)->next;if(!*p)abort();*p=t->next;product_sql_count--;q->product_sql_borrows--;pthread_mutex_unlock(&product_sql_lock);
 memset(t,0,sizeof(*t));free(t);*slot=NULL;return VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_write_current_v1(ynx_product_sql_transaction*t){
 veil_store_status s=ynx_product_sql_current_v1(t);if(s)return s;
 return t->operation==4?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
}

/* Read the exact registered-store predecessor under the ORIGINAL open SQL
 * transaction. Never return a synthetic version/cipher or use an effect status
 * as an ended receipt. No caller output is changed on a late current failure. */
veil_store_status ynx_product_sql_cipher_original_v1(ynx_product_sql_transaction*t,
 const unsigned char selector[32],unsigned char*out,size_t capacity,size_t*written,
 uint64_t*version,uint32_t*found){
 int size_only=!out&&!capacity;
 if(!selector||(!size_only&&(!out||!capacity))||capacity>YNX_PRODUCT_ROW_CIPHER_MAX||!written||!version||!found)return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(t->ended)return VEIL_STORE_LIFETIME;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);
 if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 sqlite3_stmt*statement=NULL;unsigned char*copy=NULL;size_t size=0;uint64_t actual_version=0;uint32_t present=0;
 if(!s&&sqlite3_prepare_v2(q->driver->store,
   "SELECT r.version,r.ciphertext FROM core_record AS r JOIN core_product_index AS i ON i.name=r.name WHERE r.name=?1",-1,&statement,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&sqlite3_bind_blob(statement,1,selector,32,SQLITE_STATIC)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s){int step=sqlite3_step(statement);
  if(step==SQLITE_ROW){sqlite3_int64 v=sqlite3_column_int64(statement,0);int n=sqlite3_column_bytes(statement,1);
   const void*bytes=sqlite3_column_blob(statement,1);
   if(sqlite3_column_type(statement,0)!=SQLITE_INTEGER||v<=0||sqlite3_column_type(statement,1)!=SQLITE_BLOB||
      n<=0||(size_t)n>YNX_PRODUCT_ROW_CIPHER_MAX||!bytes)s=VEIL_STORE_MISMATCH;
   else if(!size_only&&(size_t)n>capacity)s=VEIL_STORE_BOUND;
   else {size=(size_t)n;actual_version=(uint64_t)v;present=1;
    if(!size_only){copy=malloc(size);if(!copy)s=VEIL_STORE_SQL;else memcpy(copy,bytes,size);}}
   if(!s&&sqlite3_step(statement)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
  }else if(step!=SQLITE_DONE)s=VEIL_STORE_SQL;
 }
 if(statement&&sqlite3_finalize(statement)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s)s=product_sql_path_current(t,1);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;
 if(!s){if(size&&!size_only)memcpy(out,copy,size);*written=size;*version=actual_version;*found=present;}
 if(copy){OPENSSL_cleanse(copy,size);free(copy);}
 return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_selector_v1(ynx_product_sql_transaction*t,uint32_t ns,
 const unsigned char*id,size_t size,unsigned char out[32]){
 if((ns!=1&&ns!=2)||!id||!size||size>1024||!out)return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(t->ended)return VEIL_STORE_LIFETIME;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);
 if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 unsigned char actual[32]={0};
 if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_namespace_v1(q->policy,ns);
 if(!s)s=core_resource_primitive(ynx_tpm2_owner_product_selector_v1(q->objects[0],
  q->row->storage_key_identity,t->store_reference,q->driver->binding.storage_generation,ns,id,size,actual));
 if(!s)s=product_sql_path_current(t,1);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;if(!s)memcpy(out,actual,32);OPENSSL_cleanse(actual,sizeof(actual));
 return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_prepare_write_once_v1(ynx_product_sql_transaction*t){
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->prepare_entered||t->finish_entered||t->ended)return VEIL_STORE_DUPLICATE;
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(t->operation!=4)return VEIL_STORE_MISMATCH;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);
 if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 /* Snapshot contains NO staged plaintext writes. A failed rollback must not
  * be mistaken for a closed transaction or followed by a protected command. */
 if(!s){t->prepare_entered=1;
  if(sqlite3_exec(q->driver->store,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||
     !sqlite3_get_autocommit(q->driver->store))s=VEIL_STORE_UNKNOWN;
  else{q->driver->store_transaction=0;t->owns_sql=0;}
 }
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s)s=core_driver_reserve_inner(q);
 if(!s)s=core_store_nonce_intent_inner(q);
 if(!s)s=core_driver_fence_enter(q,0);
 if(!s)s=core_counter_burn(q,0);
 if(!s)s=core_store_allocator_ready(q);
 if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s){s=core_store_begin(q);t->owns_sql=q->driver->store&&!sqlite3_get_autocommit(q->driver->store);}
 if(!s)s=product_sql_path_current(t,1);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;if(!s)t->prepared=1;
 return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_recheck_original_v1(ynx_product_sql_transaction*t,
 const unsigned char selector[32],const unsigned char*previous,size_t previous_size,
 uint64_t previous_version,uint32_t previous_found){
 if(!selector||previous_found>1||previous_size>YNX_PRODUCT_ROW_CIPHER_MAX||
  (previous_found?(!previous||!previous_size||!previous_version):(previous_size||previous_version)))return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(!t->prepared||!t->prepare_entered)return VEIL_STORE_LIFETIME;
 unsigned char*readback=previous_size?malloc(previous_size):NULL;if(previous_size&&!readback)return product_sql_fail(t,VEIL_STORE_SQL);
 size_t size=0;uint64_t version=0;uint32_t found=0;
 s=ynx_product_sql_cipher_original_v1(t,selector,readback,previous_size,&size,&version,&found);
 if(!s&&(found!=previous_found||version!=previous_version||size!=previous_size||
  (size&&CRYPTO_memcmp(previous,readback,size))))s=VEIL_STORE_MISMATCH;
 if(readback)OPENSSL_cleanse(readback,previous_size);
 free(readback);
 return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

static void product_sql_put32(unsigned char*out,uint32_t v){for(unsigned i=0;i<4;i++)out[3-i]=(unsigned char)(v>>(8*i));}
veil_store_status ynx_product_sql_seal_once_v1(ynx_product_sql_transaction*t,uint32_t index,
 const ynx_product_seal_input_v1*input,ynx_original_bytes*out){
 if(!input||!out||out->data||out->size||index>=32||
  (input->namespace_id!=1&&input->namespace_id!=2)||input->tombstone>1||
  (input->tombstone&&input->namespace_id!=1)||!input->id.data||!input->id.size||input->id.size>1024||
  (input->tombstone?input->json.size:(!input->json.data||!input->json.size||input->json.size>YNX_PRODUCT_JSON_MAX)))return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(t->ended||!t->prepared||t->operation!=4)return VEIL_STORE_LIFETIME;
 if(t->sealed_mask&(UINT32_C(1)<<index))return VEIL_STORE_DUPLICATE;
 s=ynx_product_sql_recheck_original_v1(t,input->selector,input->previous_cipher.data,
  input->previous_cipher.size,input->previous_version,input->previous_found);if(s)return s;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 if(!s)s=core_store_allocator_ready(q);
 if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_namespace_v1(q->policy,input->namespace_id);
 unsigned char selected[32];if(!s)s=core_resource_primitive(ynx_tpm2_owner_product_selector_v1(q->objects[0],
  q->row->storage_key_identity,t->store_reference,q->driver->binding.storage_generation,input->namespace_id,input->id.data,input->id.size,selected));
 if(!s&&CRYPTO_memcmp(selected,input->selector,32))s=VEIL_STORE_MISMATCH;
 OPENSSL_cleanse(selected,sizeof(selected));
 ynx_product_cipher_expected_v1 expected={.version=1,.namespace_id=input->namespace_id,.tombstone=input->tombstone};
 core_domain_driver*d=q->driver;ynx_native_core_device_binding_v2 binding={0};uint64_t generation=0;
 if(!s)s=(veil_store_status)ynx_sdk_native_core_storage_binding_v2(q->policy,
  t->device_binding.classic,t->device_binding.pq,&binding,&generation);
 /* Full original key binding was already authenticated by SQL begin. Obtain
  * it from the same immutable Main storage borrower using held originals. */
 if(!s&&(generation!=d->binding.storage_generation||CRYPTO_memcmp(&binding,&t->device_binding,sizeof(binding))))s=VEIL_STORE_MISMATCH;
 if(!s){expected.storage_generation=generation;expected.base_version=input->previous_version;expected.next_version=input->previous_version+1;
  expected.policy_generation=d->binding.policy_generation;expected.deadline=d->binding.deadline;
  memcpy(expected.store_reference,t->store_reference,32);memcpy(expected.intent,d->binding.intent,32);memcpy(expected.policy_head,d->binding.head,32);memcpy(expected.selector,input->selector,32);
  if(!SHA256((const unsigned char*)&binding,sizeof(binding),expected.device_binding_digest)||
   !SHA256(input->previous_cipher.data?input->previous_cipher.data:(const unsigned char*)"",input->previous_cipher.size,expected.previous_cipher_digest))s=VEIL_STORE_UNKNOWN;
  memcpy(expected.storage_nonce,d->nonce,12);expected.storage_nonce[10]=(unsigned char)(index>>8);expected.storage_nonce[11]=(unsigned char)index;
 }
 OPENSSL_cleanse(&binding,sizeof(binding));
 size_t plain_size=16+input->id.size+input->json.size,pages=0;unsigned char*plain=NULL;int locked=0;
 long page=sysconf(_SC_PAGESIZE);if(!s&&(page<=0||page>1048576))s=VEIL_STORE_BOUND;
 if(!s){pages=(plain_size+(size_t)page-1)/(size_t)page*(size_t)page;plain=mmap(NULL,pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);if(plain==MAP_FAILED){plain=NULL;s=VEIL_STORE_SQL;}}
 if(!s){locked=mlock(plain,pages)==0;if(!locked)s=VEIL_STORE_SQL;}
 if(!s){memcpy(plain,"YNXPRJ1",8);product_sql_put32(plain+8,(uint32_t)input->id.size);product_sql_put32(plain+12,(uint32_t)input->json.size);
  memcpy(plain+16,input->id.data,input->id.size);if(input->json.size)memcpy(plain+16+input->id.size,input->json.data,input->json.size);
  if(!SHA256(plain,plain_size,expected.plaintext_digest))s=VEIL_STORE_UNKNOWN;
 }
 if(!s&&d->sealed_rows[index].bytes)s=VEIL_STORE_DUPLICATE;
 if(!s){t->sealed_mask|=UINT32_C(1)<<index;d->seal_entered=1;if(d->sealed_count<index+1)d->sealed_count=index+1;
  s=core_resource_primitive(ynx_tpm2_owner_product_seal_v1(q->objects[0],q->row->storage_key_identity,&expected,plain,plain_size,&d->sealed_rows[index]));
  *out=(ynx_original_bytes){d->sealed_rows[index].bytes,d->sealed_rows[index].size};
 }
 if(plain){OPENSSL_cleanse(plain,pages);int unresolved=locked&&munlock(plain,pages);if(!unresolved)unresolved=munmap(plain,pages);
  if(unresolved){d->sensitive_map=plain;d->sensitive_pages=pages;d->unknown=1;s=VEIL_STORE_UNKNOWN;}}
 OPENSSL_cleanse(&expected,sizeof(expected));if(!s)s=product_sql_path_current(t,1);
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_namespace_current_v1(ynx_product_sql_transaction*t,uint32_t record_class){
 if(record_class!=1&&record_class!=2)return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(t->ended)return VEIL_STORE_LIFETIME;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_namespace_v1(q->policy,record_class);
 if(!s)s=product_sql_path_current(t,1);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_first_cause_v1(ynx_product_sql_transaction*t){
 return product_sql_recognize(t)?VEIL_STORE_REQUIRED:t->first;
}

veil_store_status ynx_product_sql_commit_local_once_v1(ynx_product_sql_transaction*t,
 const ynx_native_core_cipher_cas*rows,size_t count){
 if(!rows||!count||count>32)return VEIL_STORE_BOUND;
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->local_entered||t->finish_entered||t->ended)return VEIL_STORE_DUPLICATE;
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(!t->prepared||t->operation!=4||!t->owns_sql)return VEIL_STORE_LIFETIME;
 uint32_t mask=count==32?UINT32_MAX:((UINT32_C(1)<<count)-1);if(t->sealed_mask!=mask)return VEIL_STORE_MISMATCH;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 core_domain_driver*d=q->driver;
 if(!s&&(d->effect_entered||d->local_committed||d->effect_original||d->sealed_count!=count))s=VEIL_STORE_DUPLICATE;
 if(!s)s=core_store_allocator_ready(q);
 size_t size=192+count*128;unsigned char*original=NULL;
 if(!s){original=calloc(1,size);if(!original)s=VEIL_STORE_SQL;}
 for(size_t i=0;!s&&i<count;i++){
  const ynx_native_core_cipher_cas*r=&rows[i];const unsigned char*cipher=d->sealed_rows[i].bytes;size_t n=d->sealed_rows[i].size;
  if(!r->name.data||r->name.size!=32||r->next_ciphertext.data!=cipher||r->next_ciphertext.size!=n||!cipher||n<352||n>YNX_PRODUCT_ROW_CIPHER_MAX||
   r->previous_ciphertext.size>YNX_PRODUCT_ROW_CIPHER_MAX||(r->previous_ciphertext.size&&!r->previous_ciphertext.data)||
   r->previous_version>=INT64_MAX||r->next_version!=r->previous_version+1||(!r->previous_version&&r->previous_ciphertext.size)||
   memcmp(cipher,"YNXPRD1\0",8)||core_engine_u32(cipher+12)!=320||core_engine_u32(cipher+16)!=(uint32_t)n-336||
   core_engine_u64(cipher+32)!=d->binding.storage_generation||core_engine_u64(cipher+40)!=r->previous_version||core_engine_u64(cipher+48)!=r->next_version||
   core_engine_u64(cipher+56)!=d->binding.policy_generation||core_engine_u64(cipher+64)!=d->binding.deadline||
   CRYPTO_memcmp(cipher+72,t->store_reference,32)||CRYPTO_memcmp(cipher+136,d->binding.intent,32)||
   CRYPTO_memcmp(cipher+168,d->binding.head,32)||CRYPTO_memcmp(cipher+200,r->name.data,32)){s=VEIL_STORE_MISMATCH;break;}
  unsigned char nonce[12],previous[32];memcpy(nonce,d->nonce,12);nonce[10]=(unsigned char)(i>>8);nonce[11]=(unsigned char)i;
  if(CRYPTO_memcmp(nonce,cipher+296,12)||CRYPTO_memcmp(nonce,r->storage_nonce,12)||
   !SHA256(r->previous_ciphertext.data?r->previous_ciphertext.data:(const unsigned char*)"",r->previous_ciphertext.size,previous)||
   CRYPTO_memcmp(previous,cipher+232,32)){s=VEIL_STORE_MISMATCH;break;}
  s=(veil_store_status)ynx_sdk_native_core_own_records_namespace_v1(q->policy,core_engine_u32(cipher+20));
  for(size_t j=0;!s&&j<i;j++)if(!CRYPTO_memcmp(r->name.data,rows[j].name.data,32))s=VEIL_STORE_DUPLICATE;
 }
 if(!s)s=core_driver_policy(q);
 if(!s){t->local_entered=1;t->finish_entered=1; /* BEFORE first row mutation */
  for(size_t i=0;!s&&i<count;i++){
   s=core_store_cas_row(q,&rows[i]);
   if(!s&&!rows[i].previous_version){sqlite3_stmt*st=NULL;
    if(sqlite3_prepare_v2(d->store,"INSERT INTO core_product_index(name,record_class) VALUES(?1,?2)",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
    if(!s&&(sqlite3_bind_blob(st,1,rows[i].name.data,32,SQLITE_STATIC)!=SQLITE_OK||
      sqlite3_bind_int64(st,2,core_engine_u32(d->sealed_rows[i].bytes+20))!=SQLITE_OK))s=VEIL_STORE_SQL;
    if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->store)!=1))s=VEIL_STORE_MISMATCH;
    if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
   }
  }
 }
 if(!s)s=core_product_catalog_measure(q,t->catalog_after);
 if(!s){memcpy(original,"YNXPRODUCTCASV1",15);product_sql_put32(original+16,1);product_sql_put32(original+20,(uint32_t)count);
  memcpy(original+24,d->binding.intent,32);core_store_u64(original+56,d->binding.storage_generation);core_store_u64(original+64,d->binding.policy_generation);core_store_u64(original+72,d->binding.deadline);
  memcpy(original+80,t->store_reference,32);memcpy(original+112,d->state[0].product_catalog,32);memcpy(original+144,t->catalog_after,32);memcpy(original+176,d->nonce,12);
  for(size_t i=0;!s&&i<count;i++){unsigned char*b=original+192+i*128;memcpy(b,rows[i].name.data,32);
   if(!SHA256(rows[i].next_ciphertext.data,rows[i].next_ciphertext.size,b+32)||
    !SHA256(rows[i].previous_ciphertext.data?rows[i].previous_ciphertext.data:(const unsigned char*)"",rows[i].previous_ciphertext.size,b+80))s=VEIL_STORE_UNKNOWN;
   core_store_u64(b+64,rows[i].previous_version);core_store_u64(b+72,rows[i].next_version);
  }
 }
 if(!s){d->effect_entered=1;d->effect_original=original;d->effect_original_size=size;original=NULL;sqlite3_stmt*st=NULL;
  if(sqlite3_prepare_v2(d->store,"INSERT INTO core_effect(intent,generation,deadline,original,status) VALUES(?1,?2,?3,?4,9)",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
  if(!s&&(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||sqlite3_bind_int64(st,2,(sqlite3_int64)d->binding.storage_generation)!=SQLITE_OK||
   sqlite3_bind_int64(st,3,(sqlite3_int64)d->binding.deadline)!=SQLITE_OK||sqlite3_bind_blob(st,4,d->effect_original,(int)size,SQLITE_STATIC)!=SQLITE_OK))s=VEIL_STORE_SQL;
  if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->store)!=1))s=VEIL_STORE_MISMATCH;
  if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 }
 if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s){s=core_store_commit(q);t->owns_sql=d->store&&!sqlite3_get_autocommit(d->store);}
 if(!s){unsigned char readback[65536];size_t got=0;s=core_store_effect_read(q,readback,sizeof(readback),&got,9);
  if(!s&&(got!=size||CRYPTO_memcmp(readback,d->effect_original,size)))s=VEIL_STORE_MISMATCH;
  if(!s&&!SHA256(readback,got,d->effect_digest))s=VEIL_STORE_UNKNOWN;
  OPENSSL_cleanse(readback,sizeof(readback));
 }
 if(!s){unsigned char measured[32];s=core_product_catalog_measure(q,measured);if(!s&&CRYPTO_memcmp(measured,t->catalog_after,32))s=VEIL_STORE_MISMATCH;OPENSSL_cleanse(measured,sizeof(measured));}
 for(unsigned i=0;!s&&i<2;i++){
  ynx_domain_state next=d->state[i];if(next.sequence==UINT64_MAX){s=VEIL_STORE_BOUND;break;}
  next.sequence++;next.phase=5;memcpy(next.product_catalog,t->catalog_after,32);memcpy(next.ciphertext,d->effect_digest,32);
  unsigned char chain[96];memcpy(chain,d->state[i].head,32);memcpy(chain+32,d->effect_digest,32);memcpy(chain+64,t->catalog_after,32);
  if(!SHA256(chain,sizeof(chain),next.head)||!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor))s=VEIL_STORE_UNKNOWN;
  if(!s)s=core_driver_domain_cas(q,i,&next);
  OPENSSL_cleanse(&next,sizeof(next));
 }
 if(!s){memcpy(d->effect_domain_originals,d->originals,sizeof(d->originals));d->local_committed=1;t->local_committed=1;}
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;if(original){OPENSSL_cleanse(original,size);free(original);}
 if(s&&t->local_entered){d->unknown=1;core_resource_fail(q,s);}
 return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

veil_store_status ynx_product_sql_end_once_v1(ynx_product_sql_transaction*t){
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->end_entered||t->ended)return VEIL_STORE_DUPLICATE;
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if(!t->local_committed||t->owns_sql||!t->finish_entered)return VEIL_STORE_LIFETIME;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;t->end_entered=1;
 s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s)s=core_store_checkpoint_inner(q);
 if(!s)s=core_product_terminal_write(q,t->store_reference);
 if(!s)t->ended=1; /* only independently read two terminal originals+CP+effect */
 if(!s)s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}

/* Existing selected-store snapshot only. Header historical intent/head/time
 * are authenticated STORAGE DATA, not current permission; a fresh q supplies
 * current rights. No nonce reserve, seal, finish or re-execution on read. */
veil_store_status ynx_product_sql_read_json_v1(ynx_product_sql_transaction*t,uint32_t ns,
 const unsigned char*id,size_t ni,unsigned char*out,size_t capacity,size_t*written,uint32_t*found){
 int size_only=!out&&!capacity;
 if((ns!=1&&ns!=2)||!id||!ni||ni>YNX_PRODUCT_ID_BYTES_MAX||(!size_only&&(!out||!capacity))||capacity>YNX_PRODUCT_JSON_MAX||!written||!found)return VEIL_STORE_BOUND;
 veil_store_status s=ynx_product_sql_namespace_current_v1(t,ns);unsigned char selector[32];
 if(!s)s=ynx_product_sql_selector_v1(t,ns,id,ni,selector);
 unsigned char*blob=NULL;size_t n=0;uint64_t version=0;uint32_t present=0;
 if(!s)s=ynx_product_sql_cipher_original_v1(t,selector,NULL,0,&n,&version,&present);
 if(!s&&!present){*written=0;*found=0;return VEIL_STORE_OK;}
 if(!s){if(!n||n>YNX_PRODUCT_ROW_CIPHER_MAX)s=VEIL_STORE_MISMATCH;else{blob=malloc(n);if(!blob)s=VEIL_STORE_SQL;}}
 if(!s){size_t actual_size=0;uint64_t actual_version=0;uint32_t actual_found=0;
  s=ynx_product_sql_cipher_original_v1(t,selector,blob,n,&actual_size,&actual_version,&actual_found);
  if(!s&&(actual_size!=n||actual_version!=version||actual_found!=present))s=VEIL_STORE_MISMATCH;}
 if(s){free(blob);return s;}
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s){free(blob);return product_sql_fail(t,s);}
 t->active=1;core_domain_driver*d=q->driver;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 if(!s&&(n<352||memcmp(blob,"YNXPRD1",8)||core_engine_u32(blob+8)!=1||core_engine_u32(blob+12)!=320||
  core_engine_u32(blob+20)!=ns||core_engine_u64(blob+32)!=d->binding.storage_generation||core_engine_u64(blob+48)!=version||
  CRYPTO_memcmp(blob+72,t->store_reference,32)||CRYPTO_memcmp(blob+200,selector,32)))s=VEIL_STORE_MISMATCH;
 ynx_product_cipher_expected_v1 e={.version=1,.namespace_id=ns};
 if(!s){e.tombstone=core_engine_u32(blob+24);e.storage_generation=core_engine_u64(blob+32);e.base_version=core_engine_u64(blob+40);e.next_version=version;
  e.policy_generation=core_engine_u64(blob+56);e.deadline=core_engine_u64(blob+64);
  memcpy(e.store_reference,t->store_reference,32);memcpy(e.intent,blob+136,32);memcpy(e.policy_head,blob+168,32);memcpy(e.selector,selector,32);
  memcpy(e.previous_cipher_digest,blob+232,32);memcpy(e.plaintext_digest,blob+264,32);memcpy(e.storage_nonce,blob+296,12);
  if(!SHA256((const unsigned char*)&t->device_binding,sizeof(t->device_binding),e.device_binding_digest)||
   CRYPTO_memcmp(e.device_binding_digest,blob+104,32))s=VEIL_STORE_MISMATCH;
 }
 size_t plain_size=!s?core_engine_u32(blob+16):0,pages=0,got=0,json_size=0;unsigned char*plain=NULL;int locked=0;
 long page=sysconf(_SC_PAGESIZE);if(!s&&(page<=0||page>1048576||plain_size<16||plain_size>YNX_PRODUCT_ROW_PLAIN_MAX))s=VEIL_STORE_BOUND;
 if(!s){pages=(plain_size+(size_t)page-1)/(size_t)page*(size_t)page;plain=mmap(NULL,pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);if(plain==MAP_FAILED){plain=NULL;s=VEIL_STORE_SQL;}}
 if(!s){locked=mlock(plain,pages)==0;if(!locked)s=VEIL_STORE_SQL;}
 if(!s)s=core_resource_primitive(ynx_tpm2_owner_product_open_v1(q->objects[0],q->row->storage_key_identity,&e,blob,n,plain,plain_size,&got));
 if(!s){uint32_t stored_id=core_engine_u32(plain+8);json_size=core_engine_u32(plain+12);
  if(got!=plain_size||memcmp(plain,"YNXPRJ1",8)||stored_id!=ni||16+ni+json_size!=got||
   CRYPTO_memcmp(plain+16,id,ni)||json_size>YNX_PRODUCT_JSON_MAX||(!size_only&&json_size>capacity)||(e.tombstone?json_size==0:json_size>0)==0)s=VEIL_STORE_MISMATCH;}
 if(!s)s=product_sql_path_current(t,1);
 if(!s&&!size_only&&json_size)memcpy(out,plain+16+ni,json_size);
 if(plain){OPENSSL_cleanse(plain,pages);int unresolved=locked&&munlock(plain,pages);if(!unresolved)unresolved=munmap(plain,pages);
  if(unresolved){d->sensitive_map=plain;d->sensitive_pages=pages;d->unknown=1;s=VEIL_STORE_UNKNOWN;}}
 OPENSSL_cleanse(&e,sizeof(e));OPENSSL_cleanse(blob,n);free(blob);
 if(!s)s=product_sql_path_current(t,1);
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;
 if(s){if(out&&capacity)OPENSSL_cleanse(out,capacity);return product_sql_fail(t,s);}
 *written=json_size;*found=json_size?1:0;return VEIL_STORE_OK;
}

/* Normal inventory enumerates only the authenticated product catalog class in
 * this SAME SQLite snapshot. IDs are inside AEAD ciphertext, never plaintext
 * index columns. Output is private BE32 length + exact UTF8 ID, count separate. */
veil_store_status ynx_product_sql_ids_v1(ynx_product_sql_transaction*t,uint32_t ns,
 unsigned char*out,size_t capacity,size_t*written,uint32_t*count){
 if((ns!=1&&ns!=2)||!out||!capacity||capacity>4194304||!written||!count)return VEIL_STORE_BOUND;
 veil_store_status s=ynx_product_sql_namespace_current_v1(t,ns);if(s)return s;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;core_domain_driver*d=q->driver;s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 sqlite3_stmt*st=NULL;size_t used=0,total_cipher=0;uint32_t items=0;
 if(!s&&sqlite3_prepare_v2(d->store,"SELECT r.name,r.version,r.ciphertext FROM core_product_index AS i JOIN core_record AS r ON r.name=i.name WHERE i.record_class=?1 ORDER BY r.name",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&sqlite3_bind_int(st,1,(int)ns)!=SQLITE_OK)s=VEIL_STORE_SQL;
 while(!s){int step=sqlite3_step(st);if(step==SQLITE_DONE)break;if(step!=SQLITE_ROW){s=VEIL_STORE_SQL;break;}
  const unsigned char*selector=sqlite3_column_blob(st,0),*blob=sqlite3_column_blob(st,2);int nb=sqlite3_column_bytes(st,2);sqlite3_int64 version=sqlite3_column_int64(st,1);
  if(sqlite3_column_type(st,0)!=SQLITE_BLOB||sqlite3_column_bytes(st,0)!=32||!selector||sqlite3_column_type(st,1)!=SQLITE_INTEGER||version<=0||
   sqlite3_column_type(st,2)!=SQLITE_BLOB||!blob||nb<352||(size_t)nb>YNX_PRODUCT_ROW_CIPHER_MAX||total_cipher>YNX_PRODUCT_CATALOG_CIPHER_MAX-(size_t)nb){s=VEIL_STORE_MISMATCH;break;}
  total_cipher+=(size_t)nb;
  if(memcmp(blob,"YNXPRD1",8)||core_engine_u32(blob+8)!=1||core_engine_u32(blob+12)!=320||core_engine_u32(blob+20)!=ns||
   core_engine_u64(blob+32)!=d->binding.storage_generation||core_engine_u64(blob+48)!=(uint64_t)version||
   CRYPTO_memcmp(blob+72,t->store_reference,32)||CRYPTO_memcmp(blob+200,selector,32)){s=VEIL_STORE_MISMATCH;break;}
  ynx_product_cipher_expected_v1 e={.version=1,.namespace_id=ns,.tombstone=core_engine_u32(blob+24),.storage_generation=core_engine_u64(blob+32),
   .base_version=core_engine_u64(blob+40),.next_version=(uint64_t)version,.policy_generation=core_engine_u64(blob+56),.deadline=core_engine_u64(blob+64)};
  memcpy(e.store_reference,t->store_reference,32);memcpy(e.intent,blob+136,32);memcpy(e.policy_head,blob+168,32);memcpy(e.selector,selector,32);
  memcpy(e.previous_cipher_digest,blob+232,32);memcpy(e.plaintext_digest,blob+264,32);memcpy(e.storage_nonce,blob+296,12);
  if(!SHA256((const unsigned char*)&t->device_binding,sizeof(t->device_binding),e.device_binding_digest)||CRYPTO_memcmp(e.device_binding_digest,blob+104,32)){s=VEIL_STORE_MISMATCH;break;}
  size_t plain_size=core_engine_u32(blob+16),pages=0,got=0;unsigned char*plain=NULL;int locked=0;
  long page=sysconf(_SC_PAGESIZE);if(page<=0||page>1048576||plain_size<17||plain_size>YNX_PRODUCT_ROW_PLAIN_MAX){s=VEIL_STORE_BOUND;break;}
  pages=(plain_size+(size_t)page-1)/(size_t)page*(size_t)page;plain=mmap(NULL,pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);
  if(plain==MAP_FAILED){s=VEIL_STORE_SQL;break;}
  locked=mlock(plain,pages)==0;if(!locked)s=VEIL_STORE_SQL;
  if(!s)s=core_resource_primitive(ynx_tpm2_owner_product_open_v1(q->objects[0],q->row->storage_key_identity,&e,blob,(size_t)nb,plain,plain_size,&got));
  uint32_t ni=0,nj=0;unsigned char recomputed[32]={0};
  if(!s){ni=core_engine_u32(plain+8);nj=core_engine_u32(plain+12);
   if(got!=plain_size||memcmp(plain,"YNXPRJ1",8)||!ni||ni>1024||16+(size_t)ni+nj!=got||(e.tombstone?nj!=0:!nj))s=VEIL_STORE_MISMATCH;}
  if(!s)s=core_resource_primitive(ynx_tpm2_owner_product_selector_v1(q->objects[0],q->row->storage_key_identity,t->store_reference,d->binding.storage_generation,ns,plain+16,ni,recomputed));
  if(!s&&CRYPTO_memcmp(recomputed,selector,32))s=VEIL_STORE_MISMATCH;
  if(!s&&!e.tombstone){if(items>=4096||used>capacity||4+(size_t)ni>capacity-used)s=VEIL_STORE_BOUND;
   else{product_sql_put32(out+used,ni);memcpy(out+used+4,plain+16,ni);used+=4+ni;items++;}}
  OPENSSL_cleanse(recomputed,sizeof(recomputed));OPENSSL_cleanse(&e,sizeof(e));OPENSSL_cleanse(plain,pages);
  int unresolved=locked&&munlock(plain,pages);if(!unresolved)unresolved=munmap(plain,pages);
  if(unresolved){d->sensitive_map=plain;d->sensitive_pages=pages;d->unknown=1;s=VEIL_STORE_UNKNOWN;}
  if(!s)s=product_sql_path_current(t,1);
 }
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s)s=product_sql_path_current(t,1);
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;
 if(s){if(out&&capacity)OPENSSL_cleanse(out,capacity);return product_sql_fail(t,s);}
 *written=used;*count=items;return VEIL_STORE_OK;
}

/* Pure read/no-mutation transaction. An actual SQL COMMIT ends the retained
 * snapshot; this does NOT mint a protected-write terminal or burn any nonce.
 * Ambiguous COMMIT is never retried or inferred successful from a Boolean. */
veil_store_status ynx_product_sql_read_end_once_v1(ynx_product_sql_transaction*t){
 veil_store_status s=product_sql_recognize(t);if(s)return s;
 if(t->active)return product_sql_fail(t,VEIL_STORE_FROZEN);
 if(t->finish_entered||t->readonly_entered||t->prepare_entered||t->local_entered||t->end_entered||t->ended)return VEIL_STORE_DUPLICATE;
 if(t->unknown)return VEIL_STORE_UNKNOWN;
 if((t->operation!=3&&t->operation!=4)||!t->owns_sql)return VEIL_STORE_LIFETIME;
 ynx_native_core_resource_loan*q=NULL;s=core_driver_operation_enter(t->resource,&q);if(s)return product_sql_fail(t,s);
 t->active=1;t->readonly_entered=1;t->finish_entered=1;
 s=core_driver_fence_enter(q,0);if(!s)s=product_sql_path_current(t,1);
 if(!s){if(sqlite3_exec(q->driver->store,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(q->driver->store))s=VEIL_STORE_UNKNOWN;
  else{q->driver->store_transaction=0;t->owns_sql=0;t->readonly_committed=1;}}
 if(!s)s=product_sql_path_current(t,1);
 if(!s)t->ended=1;
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;t->active=0;return s?product_sql_fail(t,s):VEIL_STORE_OK;
}
