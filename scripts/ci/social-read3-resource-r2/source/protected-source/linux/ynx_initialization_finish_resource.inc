/* Same original resource + normal checked-store finish inventory. */
#include "ynx_initialization_finish_private.h"
static veil_store_status core_initialization_finish_entry(ynx_native_core_resource_loan*p,
 veil_native_finish_result*r,ynx_native_core_resource_loan**out,int*entered){
 *entered=0;ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(!q->driver)return VEIL_STORE_REQUIRED;
 core_initialization_write_state*w=&q->driver->initialization_write;
 if(w->finish_reading)return core_resource_fail(q,VEIL_STORE_FROZEN);
 if(q->active){if(!w->finish_call)return core_resource_fail(q,VEIL_STORE_FROZEN);}
 else{q->active=1;*entered=1;}
 veil_store_status s=ynx_finish_initialization_identity_matches(r,q);
 if(s){if(*entered)q->active=0;return s;}
 w->finish_reading=1;*out=q;return VEIL_STORE_OK;
}
static void core_initialization_finish_leave(ynx_native_core_resource_loan*q,int entered){
 q->driver->initialization_write.finish_reading=0;if(entered)q->active=0;
}
veil_store_status ynx_native_core_resource_initialization_finish_attach(
 ynx_native_core_resource_loan*p,veil_native_finish_result*r,int*retained){
 if(!retained)return VEIL_STORE_BOUND;
 *retained=0;
 ynx_native_core_resource_loan*q=NULL;int entered=0;
 veil_store_status s=core_initialization_finish_entry(p,r,&q,&entered);if(s)return s;
 core_initialization_write_state*w=&q->driver->initialization_write;
 if(w->finish_owner||q->prepared_borrows>=32||w->write_entered)s=VEIL_STORE_DUPLICATE;
 if(!s)s=core_initialization_write_current(q);
 if(!s){q->prepared_borrows++;w->finish_owner=r;*retained=1;
  /* Partial is adopted before the final potentially reentrant current check. */
  s=core_initialization_write_current(q);}
 if(s&&*retained)s=core_initialization_write_fail(q,s);
 core_initialization_finish_leave(q,entered);return s;
}
veil_store_status ynx_native_core_resource_initialization_finish_originals(
 ynx_native_core_resource_loan*p,veil_native_finish_result*r,ynx_initialization_finish_original_v1*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 int entered=0;
 veil_store_status s=core_initialization_finish_entry(p,r,&q,&entered);if(s)return s;
 core_domain_driver*d=q->driver;core_initialization_write_state*w=&d->initialization_write;
 if(w->finish_owner!=r)s=VEIL_STORE_MISMATCH;
 if(!s)s=core_initialization_write_current(q);
 if(!s){ynx_initialization_finish_original_v1 v={.version=1,.size=632,.generation=d->binding.storage_generation,.deadline=d->binding.deadline,
   .aad=w->aad,.intent_original={w->intent_original,224},
   .journal={d->initialization_journal,d->initialization_journal_size},
   .ciphertext={d->sealed_rows[0].bytes,d->sealed_rows[0].size}};
  memcpy(v.store_reference,w->store_reference,32);*out=v;
 }
 core_initialization_finish_leave(q,entered);return s;
}
veil_store_status ynx_native_core_resource_initialization_finish_release(
 ynx_native_core_resource_loan*p,veil_native_finish_result*r,int*released){
 if(!released)return VEIL_STORE_BOUND;
 *released=0;
 ynx_native_core_resource_loan*q=core_resource_recognized(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 core_domain_driver*d=q->driver;if(!d)return VEIL_STORE_REQUIRED;
 core_initialization_write_state*w=&d->initialization_write;
 if(q->active&&!w->finish_cleanup)return core_resource_fail(q,VEIL_STORE_FROZEN);
 veil_store_status s=ynx_finish_initialization_identity_matches(r,q);if(s)return s;
 if(w->finish_owner!=r||!q->prepared_borrows)return core_resource_fail(q,VEIL_STORE_UNKNOWN);
 if((d->held||d->store_transaction)&&!w->finish_cleanup)return VEIL_STORE_UNKNOWN;
 w->finish_owner=NULL;q->prepared_borrows--;*released=1;
 return q->unknown||w->unknown||d->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_initialization_finished_current(
 ynx_native_core_resource_loan*p,veil_native_finish_result*r){
 ynx_native_core_resource_loan*q=NULL;int entered=0;
 veil_store_status s=core_initialization_finish_entry(p,r,&q,&entered);if(s)return s;
 core_domain_driver*d=q->driver;core_initialization_write_state*w=&d->initialization_write;
 if(w->finish_owner!=r||!w->write_entered||!d->local_committed||!d->engine_committed)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_initialization_write_current(q);
 int locked=0;
 if(!s&&!d->held){s=core_driver_fence_enter(q,0);locked=!s;}
 unsigned char original[416];size_t n=0;
 if(!s)s=core_engine_read(q,original,sizeof(original),&n);
 for(unsigned i=0;!s&&i<2;i++){
  unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state actual={0};s=core_driver_domain_read(q,i,raw,&actual);
  if(!s&&(CRYPTO_memcmp(raw,d->originals[i],sizeof(raw))||actual.phase<4||actual.phase>6||
   actual.generation!=d->binding.storage_generation||actual.deadline!=d->binding.deadline||
   CRYPTO_memcmp(actual.intent,d->binding.intent,32)))s=VEIL_STORE_MISMATCH;
 }
 if(!s)s=core_driver_policy(q);
 if(locked){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 core_initialization_finish_leave(q,entered);return s;
}
/* Drop only the driver's actual retained reference before the parent child
 * count gate. External finish refs continue pinning the parent, so cleanup
 * cannot create a driver->finish->parent self-cycle or free a live borrower. */
static veil_store_status core_initialization_finish_drain_internal(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d||!d->engine_finish||
  d->engine_finish!=d->initialization_write.finish_owner)return VEIL_STORE_OK;
 veil_native_finish_result*r=d->engine_finish;d->engine_finish=NULL;d->initialization_write.finish_cleanup=1;
 veil_store_status s=veil_native_finish_result_drop(&r);d->initialization_write.finish_cleanup=0;
 if(r){d->engine_finish=r;return s?s:VEIL_STORE_UNKNOWN;}
 if(s)core_resource_fail(q,s);
 return VEIL_STORE_OK;
}

/* Actual normal source owns a prepared initialization finish before its first
 * protected write. No legacy message guard, actor, route or session is forged.
 * Canonical scope is explicitly the ZERO->ONE bootstrap-record journal, not a
 * caller-chosen row from a multi-record message engine. */
veil_store_status ynx_native_core_resource_driver_initialization_bind_finish_v1(
 ynx_native_core_resource_loan*p,veil_native_finish_result*r){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;ynx_initialization_finish_original_v1 v={0};
 if(!d||!r){q->active=0;return VEIL_STORE_REQUIRED;}
 if(d->engine_finish||d->engine_prepared||d->effect_entered){q->active=0;return VEIL_STORE_DUPLICATE;}
 d->initialization_write.finish_call=1;
 s=ynx_finish_initialization_prepared_retain(r,q,&d->engine_finish);
 if(!s)s=ynx_finish_initialization_original_borrow(r,q,&v);
 d->initialization_write.finish_call=0;
 const ynx_original_bytes source=q->participant?q->participant->originals.origin[3]:(ynx_original_bytes){0};
 if(!s&&(v.version!=1||v.size!=632||v.generation!=d->binding.storage_generation||
  v.deadline!=d->binding.deadline||!d->binding.policy_generation||!source.data||!source.size||source.size>65536||
  !v.journal.data||!v.journal.size||v.journal.size>33554432||!v.ciphertext.data||v.ciphertext.size<792))s=VEIL_STORE_MISMATCH;
 if(!s){
  d->engine_journal=malloc(v.journal.size);d->engine_source_frame=malloc(source.size);
  if(!d->engine_journal||!d->engine_source_frame)s=VEIL_STORE_SQL;
 }
 if(!s){
  memcpy(d->engine_journal,v.journal.data,v.journal.size);d->engine_journal_size=v.journal.size;
  memcpy(d->engine_source_frame,source.data,source.size);d->engine_source_frame_size=source.size;
  unsigned char*b=d->engine_binding;memset(b,0,416);memcpy(b,"YNXENGINEBIND1",14);b[14]=1;
  memcpy(b+16,d->binding.intent,32);core_store_u64(b+48,v.generation);core_store_u64(b+56,v.deadline);
  core_store_u64(b+64,0);core_store_u64(b+72,1);
  static const unsigned char empty_initialization_journal[12]={'Y','N','X','J','R','N','1',0,0,0,0,0};
  if(!SHA256(empty_initialization_journal,sizeof(empty_initialization_journal),b+80)||
   !SHA256(v.journal.data,v.journal.size,b+112)||!SHA256(v.ciphertext.data,v.ciphertext.size,b+144)||
   !SHA256(v.journal.data,v.journal.size,b+176)||!SHA256(source.data,source.size,b+352))s=VEIL_STORE_UNKNOWN;
  memcpy(b+208,d->binding.head,32);/* sourceSequence0 only under explicit init tag */
  core_store_u64(b+248,1);
  unsigned char selector[68]={0,0,0,64};memcpy(selector+4,d->initialization_name,64);
  if(!SHA256(selector,sizeof(selector),b+320))s=VEIL_STORE_UNKNOWN;
 }
 if(!s){d->engine_native_kind=VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE;d->engine_prepared=1;s=core_engine_current(q);}
 if(s&&d->engine_finish)s=core_initialization_write_fail(q,s);
 q->active=0;return s;
}
veil_store_status ynx_native_core_resource_driver_initialization_engine_context_query(
 ynx_native_core_resource_loan*p,unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;
 if(!out||!written||cap<720)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;unsigned char context[720]={0},binding[416],header[688];size_t n=0,hs=0;
 if(!d||!d->engine_prepared||d->engine_native_kind!=VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE||
  !d->engine_committed||!d->local_committed||!d->initialization_write.finish_owner)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_fence_enter(q,0);
 if(!s)s=core_store_open(q);
 if(!s)s=core_initialization_write_current(q);
 if(!s)s=core_engine_read(q,binding,sizeof(binding),&n);
 if(!s&&(n!=416||binding[14]!=1||binding[15]||core_engine_u64(binding+240)))s=VEIL_STORE_MISMATCH;
 /* Independently read the exact stored cipher, not only a RAM digest. */
 sqlite3_stmt*st=NULL;
 if(!s&&sqlite3_prepare_v2(d->store,"SELECT version,ciphertext FROM core_record WHERE name=?1",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s){s=VEIL_STORE_MISMATCH;
  if(sqlite3_bind_blob(st,1,d->initialization_name,64,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW&&
   sqlite3_column_type(st,0)==SQLITE_INTEGER&&sqlite3_column_int64(st,0)==1&&sqlite3_column_type(st,1)==SQLITE_BLOB){
   int size=sqlite3_column_bytes(st,1);const unsigned char*b=sqlite3_column_blob(st,1);
   if(size>0&&b&&(size_t)size==d->sealed_rows[0].size&&!CRYPTO_memcmp(b,d->sealed_rows[0].bytes,(size_t)size)&&
    sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;
  }
 }
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s){const ynx_storage_initialization_aad_v1*a=&d->initialization_write.aad;
  ynx_storage_expected e={.generation=a->generation,.next_version=1,.kind=7,.container_class=YNX_STORAGE_RECORD,
   .name={(unsigned char*)d->initialization_name,64},.initialization=a};memcpy(e.request,a->request_digest,32);memcpy(e.storage_nonce,a->storage_nonce,12);
  s=ynx_storage_initialization_header_exact_v1(&e,d->sealed_rows[0].size-640,header,sizeof(header),&hs);
 }
 if(!s){static const unsigned char prefix[16]={0,0,0,1,0,0,2,208,0,0,0,1,0,0,0,1};
  if(hs!=624)s=VEIL_STORE_MISMATCH;else{memcpy(context,prefix,16);core_store_u64(context+16,d->binding.storage_generation);
   core_store_u64(context+24,d->binding.policy_generation);memcpy(context+32,d->binding.intent,32);
   memcpy(context+64,d->initialization_write.store_reference,32);memcpy(context+96,d->binding.head,32);
   memcpy(context+128,header+32,528);memcpy(context+656,d->initialization_write.journal_digest,32);
   memcpy(context+688,d->initialization_write.cipher_digest,32);s=core_driver_policy(q);}
 }
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s){memcpy(out,context,sizeof(context));*written=sizeof(context);}
 q->active=0;return s;
}
