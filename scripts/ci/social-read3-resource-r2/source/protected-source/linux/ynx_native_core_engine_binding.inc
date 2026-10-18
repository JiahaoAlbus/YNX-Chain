/* Same original driver: import the NORMAL checked-store's inventory-owned
 * committed operation. Never interpret one ratchet row as the whole state.
 * This is facts custody, NOT Source enrollment or Message3 signing admission. */
#include "ynx_source_final_owner.h"
#include "ynx_native_core_engine_binding_private.h"
extern int32_t ynx_sdk_native_core_storage_binding_v2(void*,const unsigned char*,
 const unsigned char*,ynx_native_core_device_binding_v2*,uint64_t*);
/* Distinct external Source and checked-store names must be associated by the
 * SAME retained SDK/Core owner. Matching public strings is not authority. */
extern int32_t ynx_sdk_native_core_operation_names_match_v1(void*,const unsigned char*,size_t,const unsigned char*,size_t);
static veil_store_status core_engine_operation_names(void*policy,const unsigned char*source,size_t source_size,const char*store,size_t store_capacity){
 if(!policy||!source||source_size!=47||!store||store_capacity!=37||strnlen(store,store_capacity)!=36)return VEIL_STORE_MISMATCH;
 return (veil_store_status)ynx_sdk_native_core_operation_names_match_v1(policy,source,source_size,(const unsigned char*)store,36);
}
static veil_store_status core_store_cipher_inner(ynx_native_core_resource_loan*,const ynx_native_core_cipher_cas*,size_t);
static uint32_t core_engine_u32(const unsigned char*p){uint32_t x=0;for(unsigned i=0;i<4;i++)x=(x<<8)|p[i];return x;}
static uint64_t core_engine_u64(const unsigned char*p){uint64_t x=0;for(unsigned i=0;i<8;i++)x=(x<<8)|p[i];return x;}
#include "ynx_native_core_engine_context.inc"
static int core_engine_hex(const char*s,unsigned char*out){
 if(!s||strnlen(s,65)!=64)return 0;
 for(unsigned i=0;i<32;i++){unsigned x=0;for(unsigned j=0;j<2;j++){
  unsigned char c=(unsigned char)s[2*i+j];if(c>='0'&&c<='9')x=(x<<4)|(c-'0');
  else if(c>='a'&&c<='f')x=(x<<4)|(c-'a'+10);else return 0;}out[i]=(unsigned char)x;}return 1;
}
static veil_store_status core_engine_current(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d->engine_prepared||!d->engine_finish)return VEIL_STORE_REQUIRED;
 if(d->engine_native_kind==VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE){
  int previous=d->initialization_write.finish_call;d->initialization_write.finish_call=1;
  veil_store_status s=ynx_finish_initialization_prepared_current(d->engine_finish,q);
  d->initialization_write.finish_call=previous;return s;
 }
 return ynx_finish_original_current(d->engine_finish);
}
/* Compare complete SQL originals, not status flags or digest-only equality. */
static veil_store_status core_engine_read(ynx_native_core_resource_loan*q,
 unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;
 if(!out||!written||cap<416)return VEIL_STORE_BOUND;
 core_domain_driver*d=q->driver;sqlite3_stmt*st=NULL;
 /* A SELECT in this connection's unfinished transaction is not independent
  * durable readback. Keep UNKNOWN and output length zero. */
 if(!d||!d->store||d->store_transaction||!sqlite3_get_autocommit(d->store))return VEIL_STORE_UNKNOWN;
 if(sqlite3_prepare_v2(d->store,"SELECT original,journal,source_frame FROM core_engine_binding WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_MISMATCH;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
  const size_t sizes[3]={416,d->engine_journal_size,d->engine_source_frame_size};
  const unsigned char*bytes[3]={d->engine_binding,d->engine_journal,d->engine_source_frame};s=VEIL_STORE_OK;
  for(unsigned i=0;i<3;i++)if(sqlite3_column_type(st,(int)i)!=SQLITE_BLOB||
   sqlite3_column_bytes(st,(int)i)!=(int)sizes[i]||!sqlite3_column_blob(st,(int)i)||
   CRYPTO_memcmp(sqlite3_column_blob(st,(int)i),bytes[i],sizes[i])){s=VEIL_STORE_MISMATCH;break;}
  if(!s){memcpy(out,sqlite3_column_blob(st,0),416);*written=416;
   if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;}
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
static veil_store_status core_engine_insert(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d->engine_prepared)return VEIL_STORE_OK;
 veil_store_status s=core_engine_current(q);if(s)return s;
 if(!d->store_transaction||!d->effect_original)return VEIL_STORE_LIFETIME;
 if(!SHA256(d->effect_original,d->effect_original_size,d->engine_binding+256))return VEIL_STORE_UNKNOWN;
 sqlite3_stmt*st=NULL;
 if(sqlite3_prepare_v2(d->store,"INSERT INTO core_engine_binding(intent,original,journal,source_frame) VALUES(?1,?2,?3,?4)",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||
  sqlite3_bind_blob(st,2,d->engine_binding,416,SQLITE_STATIC)!=SQLITE_OK||
  sqlite3_bind_blob(st,3,d->engine_journal,(int)d->engine_journal_size,SQLITE_STATIC)!=SQLITE_OK||
  sqlite3_bind_blob(st,4,d->engine_source_frame,(int)d->engine_source_frame_size,SQLITE_STATIC)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->store)!=1))s=VEIL_STORE_MISMATCH;
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}
static veil_store_status core_engine_after_commit(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d->engine_prepared)return VEIL_STORE_OK;
 unsigned char raw[416];size_t n=0;veil_store_status s=core_engine_read(q,raw,sizeof(raw),&n);
 if(!s)s=core_engine_current(q);
 if(!s)d->engine_committed=1;
 return s;
}
/* Parse only canonical normal YNXJRN1 and authenticated selected storage
 * envelopes. The last normal inbox/outbox entry MUST be the sole queue.
 * Exact names in envelope AAD select rows; neither row0 nor array rank selects
 * global base/next state. No cipher, row version or journal is supplied by JS. */
static veil_store_status core_engine_rows(ynx_native_core_resource_loan*q,
 const ynx_finish_commit_original*v,ynx_native_core_cipher_cas rows[32],
 unsigned char*old[32],size_t*count){
 core_domain_driver*d=q->driver;const unsigned char*p=v->journal;size_t left=v->journal_size;
 if(!p||left<12||memcmp(p,"YNXJRN1\0",8))return VEIL_STORE_MISMATCH;
 uint32_t n=core_engine_u32(p+8);veil_store_status cardinality=core_engine_typed_count(v->native_kind,v->journal_steps,n);if(cardinality)return cardinality;
 unsigned char context[120];veil_store_status context_status=core_engine_context_parse(d,
  (ynx_original_bytes){v->journal,v->journal_size},context);if(context_status)return context_status;
 p+=12;left-=12;unsigned char selectors[32*132];size_t used=0;
 for(unsigned i=0;i<n;i++){
  if(left<16)return VEIL_STORE_BOUND;
  uint32_t ix=core_engine_u32(p),kn=core_engine_u32(p+4),idn=core_engine_u32(p+8),cn=core_engine_u32(p+12);
  if(ix!=i||!kn||kn>32||!idn||idn>1024||cn<428||cn>1049132||
   (size_t)kn+idn+cn>left-16)return VEIL_STORE_BOUND;
  const unsigned char*kind=p+16,*b=kind+kn+idn;int queue=0;
  veil_store_status typed=core_engine_typed_row(v->native_kind,n,i,kind,kn,kind+kn,idn,b,&queue);if(typed)return typed;
  uint32_t hn=core_engine_u32(b+12),plain=core_engine_u32(b+16),nn=core_engine_u32(b+64);
  if(memcmp(b,queue?"YNXQUE1":"YNXREC1",7)||b[7]||b[8]||b[9]!=1||b[10]||b[11]!=1||
   !nn||nn>128||hn!=412+nn||cn!=(size_t)hn+plain+16||core_engine_u32(b+20)!=plain+16||
   core_engine_u64(b+24)!=d->binding.storage_generation||
   CRYPTO_memcmp(b+192,v->origin.root_digest,32)||CRYPTO_memcmp(b+320,d->binding.intent,32))return VEIL_STORE_MISMATCH;
  ynx_native_core_cipher_cas*r=&rows[i];r->name=(ynx_original_bytes){b+412,nn};
  if(d->seal_entered){
   if(!d->sealed_initialization||v->native_kind!=VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE||n!=1||
    d->sealed_count!=1||!d->sealed_rows[0].bytes||d->sealed_rows[0].size!=cn||
    CRYPTO_memcmp(d->sealed_rows[0].bytes,b,cn))return VEIL_STORE_MISMATCH;
  }
  r->next_ciphertext=(ynx_original_bytes){b,cn};r->previous_version=core_engine_u64(b+32);r->next_version=core_engine_u64(b+40);
  if(r->previous_version==UINT64_MAX||r->next_version!=r->previous_version+1)return VEIL_STORE_MISMATCH;
  memcpy(r->storage_nonce,b+400,12);
  for(unsigned j=0;j<i;j++)if(rows[j].name.size==nn&&!CRYPTO_memcmp(rows[j].name.data,r->name.data,nn))return VEIL_STORE_DUPLICATE;
  if(queue){if(!SHA256(r->name.data,nn,d->engine_binding+288))return VEIL_STORE_UNKNOWN;}
  else{selectors[used++]=(unsigned char)(nn>>24);selectors[used++]=(unsigned char)(nn>>16);selectors[used++]=(unsigned char)(nn>>8);selectors[used++]=(unsigned char)nn;memcpy(selectors+used,r->name.data,nn);used+=nn;}
  sqlite3_stmt*st=NULL;veil_store_status s=VEIL_STORE_MISMATCH;
  if(sqlite3_prepare_v2(d->store,"SELECT version,ciphertext FROM core_record WHERE name=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  if(sqlite3_bind_blob(st,1,r->name.data,(int)nn,SQLITE_STATIC)==SQLITE_OK){int rc=sqlite3_step(st);
   if(rc==SQLITE_DONE&&r->previous_version==0)s=VEIL_STORE_OK;
   else if(rc==SQLITE_ROW&&sqlite3_column_type(st,0)==SQLITE_INTEGER&&sqlite3_column_int64(st,0)>=0&&
    (uint64_t)sqlite3_column_int64(st,0)==r->previous_version&&sqlite3_column_type(st,1)==SQLITE_BLOB){
    int size=sqlite3_column_bytes(st,1);if(size>0&&size<=1049132&&sqlite3_column_blob(st,1)){
     old[i]=malloc((size_t)size);if(!old[i])s=VEIL_STORE_SQL;
     else{memcpy(old[i],sqlite3_column_blob(st,1),(size_t)size);r->previous_ciphertext=(ynx_original_bytes){old[i],(size_t)size};s=sqlite3_step(st)==SQLITE_DONE?VEIL_STORE_OK:VEIL_STORE_MISMATCH;}}}}
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(s)return s;
  size_t take=16+(size_t)kn+idn+cn;p+=take;left-=take;
 }
 if(left)return VEIL_STORE_BOUND;
 if(!SHA256(selectors,used,d->engine_binding+320))return VEIL_STORE_UNKNOWN;
 core_store_u64(d->engine_binding+248,n);*count=n;return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_commit_engine_original(
 ynx_native_core_resource_loan*p,veil_native_finish_result*finish,ynx_source_role_hold*source){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;ynx_finish_commit_original v={0};ynx_role_binding history={0};
 ynx_native_core_cipher_cas rows[32]={0};unsigned char*old[32]={0};size_t count=0;
 if(!d||!finish||!source||d->engine_finish||d->effect_entered||(d->seal_entered&&!d->sealed_initialization)){q->active=0;return VEIL_STORE_BOUND;}
 const veil_native_intent_handle*intent=NULL;
 s=ynx_finish_original_retain(finish,&d->engine_finish,&intent);
 if(!s)s=ynx_finish_original_commit_borrow(d->engine_finish,&v);
 if(!s&&v.native_kind>VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE)s=VEIL_STORE_MISMATCH;
 if(!s)d->engine_native_kind=v.native_kind;
 /* Existing SDK inventory getter checks actual keys/account/device/current;
  * digest equality with a supplied Source view alone is NOT sufficient. */
 if(!s){ynx_native_core_device_binding_v2 authenticated={0};uint64_t generation=0;
  s=(veil_store_status)ynx_sdk_native_core_storage_binding_v2(q->policy,v.origin.native_classic,
   v.origin.native_pq,&authenticated,&generation);
  if(!s&&(generation!=d->binding.storage_generation||
   CRYPTO_memcmp(authenticated.root,v.origin.root_digest,32)||
   CRYPTO_memcmp(authenticated.registration,v.origin.registration_digest,32)||
   CRYPTO_memcmp(authenticated.classic,v.origin.native_classic,33)||
   CRYPTO_memcmp(authenticated.pq,v.origin.native_pq,2592)))s=VEIL_STORE_MISMATCH;
 }
 if(!s)s=ynx_source_client_role_current(source);
 if(!s)s=ynx_source_client_role_projection(source,&history);
 /* Source history observation is same operation/root-current, never borrowing
  * the old directory/prepared role's rights to sign a Message3 frame. */
 if(!s&&(v.base_revision<0||v.base_revision==INT64_MAX||v.next_revision!=v.base_revision+1||
  !history.sequence||!history.frame.data||!history.frame.size||history.frame.size>65536||
  CRYPTO_memcmp(history.head,d->binding.head,32)||
  CRYPTO_memcmp(v.origin.registration_digest,d->binding.registration,32)))s=VEIL_STORE_MISMATCH;
 /* Preserve the original SDK status (including UNKNOWN/current failure); do
  * not reinterpret it as a digest match, grant, or renewed operation. */
 if(!s)s=core_engine_operation_names(q->policy,history.operation.data,history.operation.size,v.operation,sizeof(v.operation));
 if(!s){unsigned char*b=d->engine_binding;memset(b,0,416);memcpy(b,"YNXENGINEBIND1",14);
  memcpy(b+16,d->binding.intent,32);core_store_u64(b+48,d->binding.storage_generation);core_store_u64(b+56,d->binding.deadline);
  core_store_u64(b+64,(uint64_t)v.base_revision);core_store_u64(b+72,(uint64_t)v.next_revision);
  if(!core_engine_hex(v.base_hash,b+80)||!core_engine_hex(v.next_hash,b+112)||!core_engine_hex(v.cipher_hash,b+144))s=VEIL_STORE_BOUND;
  unsigned char actual[32];if(!s&&(!v.ciphertext||!v.ciphertext_size||!SHA256(v.ciphertext,v.ciphertext_size,actual)||CRYPTO_memcmp(actual,b+144,32)))s=VEIL_STORE_MISMATCH;
  if(!s&&(!v.journal||!v.journal_size||v.journal_size>33554432||!SHA256(v.journal,v.journal_size,actual)||CRYPTO_memcmp(actual,v.journal_digest,32)))s=VEIL_STORE_MISMATCH;
  if(!s){memcpy(b+176,actual,32);memcpy(b+208,history.head,32);core_store_u64(b+240,history.sequence);
   if(!SHA256(history.frame.data,history.frame.size,b+352))s=VEIL_STORE_UNKNOWN;}
 }
 if(!s){d->engine_journal=malloc(v.journal_size);d->engine_source_frame=malloc(history.frame.size);
  if(!d->engine_journal||!d->engine_source_frame)s=VEIL_STORE_SQL;
  else{memcpy(d->engine_journal,v.journal,v.journal_size);d->engine_journal_size=v.journal_size;
   memcpy(d->engine_source_frame,history.frame.data,history.frame.size);d->engine_source_frame_size=history.frame.size;d->engine_prepared=1;}}
 if(!s)s=core_driver_fence_enter(q,0);
 if(!s)s=core_store_open(q);
 if(!s)s=core_engine_rows(q,&v,rows,old,&count);
 if(!s)s=ynx_source_client_role_current(source);
 if(!s)s=core_engine_current(q);
 if(!s)s=core_store_cipher_inner(q,rows,count);
 if(!s)s=ynx_source_client_role_current(source);
 for(unsigned i=0;i<32;i++)free(old[i]);
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;if(s&&d&&d->effect_entered)return core_resource_fail(q,s);return s;
}
veil_store_status ynx_native_core_resource_driver_engine_binding_query(
 ynx_native_core_resource_loan*p,unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);
 if(s)return s;
 core_domain_driver*d=q->driver;
 if(!d||!d->engine_prepared||!d->effect_entered)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_fence_enter(q,1);
 if(!s)s=core_store_open(q);
 if(!s)s=core_engine_read(q,out,cap,written);
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;return s;
}
veil_store_status ynx_native_core_resource_driver_engine_original_query(
 ynx_native_core_resource_loan*p,uint32_t which,unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;
 if(!out||!written||which<1||which>3)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;unsigned char check[416];size_t got=0;
 if(!d||!d->engine_prepared||!d->effect_entered)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_fence_enter(q,1);
 if(!s)s=core_store_open(q);
 if(!s)s=core_engine_read(q,check,sizeof(check),&got);
 sqlite3_stmt*st=NULL;
 if(!s&&sqlite3_prepare_v2(d->store,"SELECT original,journal,source_frame FROM core_engine_binding WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s){
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||sqlite3_step(st)!=SQLITE_ROW)s=VEIL_STORE_MISMATCH;
  else{int size=sqlite3_column_bytes(st,(int)which-1);const void*bytes=sqlite3_column_blob(st,(int)which-1);
   const unsigned char*expected=which==1?d->engine_binding:which==2?d->engine_journal:d->engine_source_frame;
   size_t expected_size=which==1?416:which==2?d->engine_journal_size:d->engine_source_frame_size;
   if(sqlite3_column_type(st,(int)which-1)!=SQLITE_BLOB||size<=0||!bytes)s=VEIL_STORE_MISMATCH;
   else if((size_t)size!=expected_size||CRYPTO_memcmp(bytes,expected,expected_size))s=VEIL_STORE_MISMATCH;
   else if((size_t)size>cap)s=VEIL_STORE_BOUND;
   else{memcpy(out,bytes,(size_t)size);*written=(size_t)size;if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;}}
 }
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;return s;
}
