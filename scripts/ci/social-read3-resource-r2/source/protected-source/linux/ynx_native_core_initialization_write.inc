/* Included only in the original Core resource TU. Direct typed producer, not
 * a second owner registry or a reconstruction from post-effect facts. */
#include "ynx_native_core_initialization_write_private.h"
static veil_store_status core_initialization_write_fail(ynx_native_core_resource_loan*q,veil_store_status s){
 core_initialization_write_state*w=&q->driver->initialization_write;
 if(!w->first)w->first=s?s:VEIL_STORE_UNKNOWN;
 if(!q->first)q->first=w->first;
 if(w->write_entered||s==VEIL_STORE_UNKNOWN||(w->lease_held&&s!=VEIL_STORE_REQUIRED)){w->unknown=1;w->stage=YNX_INIT_UNCERTAIN;return core_resource_fail(q,s?s:VEIL_STORE_UNKNOWN);}
 return s;
}
/* Full original checks; a stored pointer/ref or journal hash is NOT sufficient
 * to establish current. Late failures retain this lease/ciphertext/firstcause. */
static veil_store_status core_initialization_write_current(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d)return VEIL_STORE_REQUIRED;
 core_initialization_write_state*w=&d->initialization_write;
 if(!w->lease_held||!q->prepared_borrows)return VEIL_STORE_LIFETIME;
 if(w->unknown||q->unknown||d->unknown)return VEIL_STORE_UNKNOWN;
 if(w->stage==YNX_INIT_UNPREPARED||d->binding.purpose!=1||!d->sealed_initialization||
  !d->seal_entered||d->sealed_count!=1||!d->initialization_journal||!d->initialization_journal_size)return VEIL_STORE_MISMATCH;
 veil_store_status s=core_driver_policy(q);if(s)return s;
 unsigned char ref[32],digest[32];s=core_store_reference_make(q,ref);
 if(!s&&(CRYPTO_memcmp(ref,w->store_reference,32)||
  CRYPTO_memcmp(&w->aad,&d->initialization_aad,sizeof(w->aad))))s=VEIL_STORE_MISMATCH;
 if(!s&&(!SHA256(d->initialization_journal,d->initialization_journal_size,digest)||
  CRYPTO_memcmp(digest,w->journal_digest,32)))s=VEIL_STORE_MISMATCH;
 if(!s&&(!d->sealed_rows[0].bytes||!SHA256(d->sealed_rows[0].bytes,d->sealed_rows[0].size,digest)||
  CRYPTO_memcmp(digest,w->cipher_digest,32)))s=VEIL_STORE_MISMATCH;
 /* Independently re-borrow the actual immutable Core record and compare all
  * initializer originals. This is the real Rust callee, not a test stand-in. */
 ynx_core_initialization_record_v1 r={0};ynx_storage_initialization_aad_v1 aad={0};
 if(!s)s=(veil_store_status)ynx_sdk_native_core_initialization_record_borrow_v1(q->policy,&r);
 if(!s)s=core_initialization_descriptor_make(q,&r,&aad);
 if(!s){memcpy(aad.storage_nonce,d->initialization_aad.storage_nonce,12);
  if(CRYPTO_memcmp(&aad,&w->aad,sizeof(aad)))s=VEIL_STORE_MISMATCH;}
 if(!s)s=(veil_store_status)ynx_sdk_native_core_initialization_aad_verify_v1(q->policy,&w->aad);
 if(!s)s=core_driver_policy(q);
 return s;
}
veil_store_status ynx_native_core_resource_driver_initialization_prepare_v1(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;
 if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 core_initialization_write_state*w=&d->initialization_write;
 if(w->lease_held||w->stage||d->effect_entered||d->engine_committed){q->active=0;return VEIL_STORE_DUPLICATE;}
 if(!q->row||!q->participant||q->prepared_borrows>=32||q->unknown||d->unknown){q->active=0;return q->unknown||d->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_REQUIRED;}
 if(!d->sealed_initialization||!d->seal_entered||d->sealed_count!=1||!d->initialization_journal||
  !d->initialization_journal_size||d->binding.purpose!=1){q->active=0;return VEIL_STORE_MISMATCH;}
 s=core_driver_fence_enter(q,0);if(!s)s=core_store_open(q);
 if(!s)s=core_initialization_record_absent(q,(ynx_original_bytes){(unsigned char*)d->initialization_name,64});
 if(!s)s=core_store_nonce_read(q);
 if(!s){
  /* Adopt the real internal resource borrow BEFORE any later refusal. Parent
   * close uses this existing count, not a new Source grant or SDK instance. */
  q->prepared_borrows++;w->lease_held=1;w->stage=YNX_INIT_PREPARED;
  w->aad=d->initialization_aad;memcpy(w->journal_digest,d->initialization_journal_digest,32);
  memcpy(w->cipher_digest,d->initialization_cipher_digest,32);s=core_store_reference_make(q,w->store_reference);
 }
 if(!s){
  /* Immutable private intent bytes: no actor/session/route/device-final fields.
   * This is custody of already authorized originals, not a signed protocol. */
  unsigned char*b=w->intent_original;memset(b,0,224);memcpy(b,"YNXINITINT1",11);
  core_store_u64(b+16,d->binding.storage_generation);core_store_u64(b+24,d->binding.deadline);
  memcpy(b+32,d->binding.intent,32);memcpy(b+64,w->store_reference,32);
  memcpy(b+96,w->journal_digest,32);memcpy(b+128,w->cipher_digest,32);
  unsigned char header[688];size_t hn=0;
  ynx_storage_expected expected={.generation=w->aad.generation,.next_version=1,.kind=7,.container_class=YNX_STORAGE_RECORD,
   .name={(unsigned char*)d->initialization_name,64},.initialization=&w->aad};
  memcpy(expected.request,w->aad.request_digest,32);memcpy(expected.storage_nonce,w->aad.storage_nonce,12);
  s=ynx_storage_initialization_header_exact_v1(&expected,(size_t)(d->sealed_rows[0].size-640),header,sizeof(header),&hn);
  if(!s&&(hn!=624||!SHA256(header+32,528,b+160)))s=VEIL_STORE_UNKNOWN;
  memcpy(b+192,w->aad.operation_ids,32);
 }
 if(!s)s=core_initialization_write_current(q);
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(s&&w->lease_held)s=core_initialization_write_fail(q,s);
 q->active=0;
 return s;
}
veil_store_status ynx_native_core_resource_driver_initialization_intent_borrow_v1(
 ynx_native_core_resource_loan*p,ynx_original_bytes*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_initialization_write_current(q);
 if(!s)*out=(ynx_original_bytes){q->driver->initialization_write.intent_original,224};
 q->active=0;return s;
}
/* Existing typed EngineCommit adapter ownership, never a byte-shaped caller
 * grant. Main's forthcoming typed body is not manufactured here. Until that
 * actual normal checked-finish is bound, this pre-effect gate refuses safely. */
static veil_store_status core_initialization_engine_owner(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d->engine_prepared||!d->engine_finish)return VEIL_STORE_REQUIRED;
 if(d->engine_native_kind!=VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE||
  !d->engine_journal||d->engine_journal_size!=d->initialization_journal_size||
  CRYPTO_memcmp(d->engine_journal,d->initialization_journal,d->engine_journal_size))return VEIL_STORE_MISMATCH;
 return core_engine_current(q);
}
veil_store_status ynx_native_core_resource_driver_initialization_checked_write_v1(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 core_initialization_write_state*w=&d->initialization_write;
 if(w->write_entered||w->finish_entered||d->effect_entered){q->active=0;return w->unknown||q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_DUPLICATE;}
 s=core_initialization_write_current(q);
 /* No DB mutation or entered latch if the real same-source typed finish has
  * not been produced. Do not install engine_prepared or an OK test witness. */
 if(!s)s=core_initialization_engine_owner(q);
 if(!s)s=core_driver_fence_enter(q,0);
 if(!s)s=core_store_open(q);
 if(!s)s=core_initialization_record_absent(q,(ynx_original_bytes){(unsigned char*)d->initialization_name,64});
 if(!s)s=core_store_nonce_read(q);
 if(!s)s=core_initialization_write_current(q);
 if(!s){
  ynx_native_core_cipher_cas row={.name={(unsigned char*)d->initialization_name,64},
   .next_ciphertext={d->sealed_rows[0].bytes,d->sealed_rows[0].size},.previous_version=0,.next_version=1};
  memcpy(row.storage_nonce,w->aad.storage_nonce,12);w->write_entered=1;w->stage=YNX_INIT_WRITE_ENTERED;
  /* Existing checked transaction: exact absent-selector CAS + engine binding
   * insert + same SQL COMMIT + independent readback + two domain CAS heads. */
  s=core_store_cipher_inner(q,&row,1);
  if(!s)s=core_initialization_write_current(q);
  if(!s){if(!d->local_committed||!d->engine_committed)s=VEIL_STORE_UNKNOWN;else{
    w->stage=YNX_INIT_LOCAL_COMMITTED;w->finish_call=1;
    s=ynx_finish_initialization_commit_observed(d->engine_finish,q);w->finish_call=0;
   }}
 }
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(s&&w->lease_held&&(w->write_entered||s!=VEIL_STORE_REQUIRED))s=core_initialization_write_fail(q,s);
 q->active=0;
 return s;
}
veil_store_status ynx_native_core_resource_driver_initialization_finish_v1(
 ynx_native_core_resource_loan*p,ynx_native_core_initialization_finish_v1*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 core_initialization_write_state*w=&d->initialization_write;
 if(w->finish_entered){q->active=0;return w->unknown||q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_DUPLICATE;}
 if(w->stage!=YNX_INIT_LOCAL_COMMITTED){q->active=0;return w->unknown||q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_REQUIRED;}
 s=core_initialization_write_current(q);if(!s)s=core_initialization_engine_owner(q);
 if(!s)s=core_driver_fence_enter(q,0);
 unsigned char raw[65536],engine[416],domains[2][YNX_DOMAIN_STATE_BYTES];size_t n=0,en=0;
 if(!s){w->finish_entered=1;s=core_store_effect_read(q,raw,sizeof(raw),&n,5);}
 if(!s&&(n!=d->effect_original_size||!d->effect_original||CRYPTO_memcmp(raw,d->effect_original,n)))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_engine_read(q,engine,sizeof(engine),&en);
 for(unsigned i=0;!s&&i<2;i++){
  ynx_domain_state actual={0};s=core_driver_domain_read(q,i,domains[i],&actual);
  if(!s&&(CRYPTO_memcmp(domains[i],d->effect_domain_originals[i],YNX_DOMAIN_STATE_BYTES)||
   actual.generation!=d->binding.storage_generation||actual.deadline!=d->binding.deadline||
   CRYPTO_memcmp(actual.intent,d->binding.intent,32)))s=VEIL_STORE_MISMATCH;
 }
 if(!s)s=core_initialization_write_current(q);
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s){ynx_native_core_initialization_finish_v1 v={.version=1,.stage=YNX_INIT_FINISH_OBSERVED,.journal_steps=1,.queue_count=0,
   .generation=d->binding.storage_generation,.deadline=d->binding.deadline};
  memcpy(v.intent,d->binding.intent,32);memcpy(v.store_reference,w->store_reference,32);
  memcpy(v.journal_digest,w->journal_digest,32);memcpy(v.cipher_digest,w->cipher_digest,32);
  if(!SHA256(raw,n,v.effect_digest))s=VEIL_STORE_UNKNOWN;
  if(!s){w->stage=YNX_INIT_FINISH_OBSERVED;*out=v;}
 }
 OPENSSL_cleanse(raw,sizeof(raw));if(s&&w->finish_entered)s=core_initialization_write_fail(q,s);
 q->active=0;return s;
}
veil_store_status ynx_native_core_resource_driver_initialization_lease_release_v1(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->active)return core_resource_fail(q,VEIL_STORE_FROZEN);
 if(!q->driver)return VEIL_STORE_REQUIRED;
 core_initialization_write_state*w=&q->driver->initialization_write;
 if(!w->lease_held)return VEIL_STORE_BOUND;
 if(!q->prepared_borrows)return core_resource_fail(q,VEIL_STORE_UNKNOWN);
 /* Drain only this owned reversible SQL/fence before dropping its internal
  * borrow, otherwise parent close would be blocked by its own cleanup child.
  * Durable COMMIT/nonce/UNKNOWN originals remain in the same parent. */
 if(q->driver->store_transaction){
  if(sqlite3_exec(q->driver->store,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||
   !sqlite3_get_autocommit(q->driver->store))return core_initialization_write_fail(q,VEIL_STORE_UNKNOWN);
  q->driver->store_transaction=0;
 }
 if(q->driver->held){veil_store_status s=core_driver_fence_leave(q);if(s)return core_initialization_write_fail(q,s);}
 q->prepared_borrows--;w->lease_held=0;
 return w->unknown||q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
