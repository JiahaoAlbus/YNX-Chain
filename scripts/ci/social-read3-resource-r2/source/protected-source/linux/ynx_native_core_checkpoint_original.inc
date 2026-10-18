#include "ynx_native_core_checkpoint_original_private.h"
/* Read both committed originals independently. Neither the cached write buffer
 * nor a SELECT inside an unfinished writer transaction is terminal readback. */
static veil_store_status core_checkpoint_read_original(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d||!d->held||!d->checkpoint_committed||d->checkpoint_size<128||d->checkpoint_size>sizeof(d->checkpoint_original))return VEIL_STORE_REQUIRED;
 for(unsigned i=0;i<2;i++){
  if(!d->db[i]||d->transaction[i]||!sqlite3_get_autocommit(d->db[i]))return VEIL_STORE_UNKNOWN;
  sqlite3_stmt*st=NULL;veil_store_status s=VEIL_STORE_MISMATCH;
  if(sqlite3_prepare_v2(d->db[i],"SELECT original FROM core_checkpoint WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
   int n=sqlite3_column_bytes(st,0);const void*raw=sqlite3_column_blob(st,0);
   if(sqlite3_column_type(st,0)==SQLITE_BLOB&&n==(int)d->checkpoint_size&&raw&&
    !CRYPTO_memcmp(raw,d->checkpoint_original,d->checkpoint_size)&&sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;
  }
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(s)return s;
 }
 return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_checkpoint_original_query(
 ynx_native_core_resource_loan*p,ynx_native_core_checkpoint_original_v1*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;ynx_native_core_checkpoint_original_v1 v={0};
 unsigned char engine[416]={0};size_t written=0;
 if(!d||!d->checkpoint_committed||!d->engine_committed){q->active=0;return VEIL_STORE_REQUIRED;}
 s=core_driver_fence_enter(q,1);
 if(!s)s=core_checkpoint_read_original(q);
 if(!s)s=core_engine_read(q,engine,sizeof(engine),&written);
 if(!s&&written!=sizeof(engine))s=VEIL_STORE_MISMATCH;
 /* Actual named/certified independent counters, including anchor slot2.
  * Never substitute a SourceSigner Name or SQL/domain sequence as floor. */
 for(unsigned k=0;!s&&k<3;k++)s=core_counter_current(q,k);
 if(!s){const ynx_tpm2_resource_selection*f=&q->row->domain_floor[1];
  if(f->counter_name.size!=34||f->expected_counter==UINT64_MAX||d->state[1].floor!=f->expected_counter+1)s=VEIL_STORE_MISMATCH;
  else{v.version=1;v.size=sizeof(v);v.anchor_floor=d->state[1].floor;memcpy(v.anchor_counter_name,f->counter_name.name,34);
   if(!SHA256(d->checkpoint_original,d->checkpoint_size,v.checkpoint_digest))s=VEIL_STORE_UNKNOWN;
   memcpy(v.output_cipher_hash,engine+144,32);}
 }
 if(!s)s=core_driver_policy(q);
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;if(!s&&(q->unknown||d->unknown))s=VEIL_STORE_UNKNOWN;
 if(s)return core_resource_fail(q,s);
 *out=v;
 return VEIL_STORE_OK;
}
