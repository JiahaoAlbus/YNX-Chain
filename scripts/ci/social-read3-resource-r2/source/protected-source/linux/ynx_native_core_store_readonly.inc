/* Same resource TU; no new owner/registry/authority or alternate store. */
#include "ynx_native_core_store_readonly_private.h"
static veil_store_status core_store_reference_make(ynx_native_core_resource_loan*q,unsigned char out[32]){
 if(!q||!q->row||!q->driver||!out)return VEIL_STORE_REQUIRED;
 const native_core_registered_row*r=q->row;core_domain_driver*d=q->driver;
 if(!r->store_device||!r->store_inode||!d->binding.storage_generation||
  !r->complete_association.data||!r->complete_association.size||r->complete_association.size>65536)return VEIL_STORE_BOUND;
 /* Exact registration identity, not path or an account guessed from token JSON. */
 unsigned char raw[128]={0};memcpy(raw,"YNXSTOREREFV1",13);
 core_store_u64(raw+16,r->store_device);core_store_u64(raw+24,r->store_inode);
 core_store_u64(raw+32,d->binding.storage_generation);
 memcpy(raw+40,r->storage_key_identity,32);
 if(!SHA256(r->complete_association.data,r->complete_association.size,raw+72))return VEIL_STORE_UNKNOWN;
 /* Full registration32 occupies the appended segment; reserved bytes zero. */
 unsigned char framed[160];memcpy(framed,raw,128);memcpy(framed+128,d->binding.registration,32);
 return SHA256(framed,sizeof(framed),out)?VEIL_STORE_OK:VEIL_STORE_UNKNOWN;
}
veil_store_status ynx_native_core_resource_driver_store_reference_v1(
 ynx_native_core_resource_loan*p,unsigned char out[32]){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 unsigned char ref[32];s=core_driver_fence_enter(q,0);
 if(!s)s=core_store_open(q);
 if(!s)s=core_store_reference_make(q,ref);
 if(!s)s=core_driver_policy(q);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s)memcpy(out,ref,32);
 q->active=0;return s;
}
/* Durable receipt comparison itself never consults mutable RAM retired flags.
 * A half-domain row is uncertainty even if current process remembers success. */
static veil_store_status core_terminal_read_pair(core_domain_driver*d,uint32_t kind,
 unsigned char*out,size_t cap,size_t*written){
 *written=0;if(!d||!d->held||kind<1||kind>3||!out||cap<65536)return VEIL_STORE_BOUND;
 for(unsigned i=0;i<2;i++){
  if(!d->db[i])return VEIL_STORE_REQUIRED;
  sqlite3_stmt*st=NULL;
  if(sqlite3_prepare_v2(d->db[i],"SELECT receipt FROM core_message3 WHERE intent=?1 AND kind=?2 AND state=2",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  veil_store_status s=VEIL_STORE_SQL;
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_int64(st,2,kind)==SQLITE_OK){
   int rc=sqlite3_step(st);s=VEIL_STORE_UNKNOWN;
   if(rc==SQLITE_ROW){
    int n=sqlite3_column_bytes(st,0);const void*b=sqlite3_column_blob(st,0);
    if(sqlite3_column_type(st,0)==SQLITE_BLOB&&n>0&&n<=65536&&b){
     if(!i){memcpy(out,b,(size_t)n);*written=(size_t)n;s=VEIL_STORE_OK;}
     else if((size_t)n==*written&&!CRYPTO_memcmp(out,b,*written))s=VEIL_STORE_OK;
     if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_UNKNOWN;
    }
   }else if(rc!=SQLITE_DONE)s=VEIL_STORE_SQL;
  }
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(s)return s;
 }
 return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_terminal_observe_v1(
 ynx_native_core_resource_loan*p,uint32_t kind,ynx_native_core_terminal_observation_v1*out,
 unsigned char*receipt,size_t cap,size_t*written){
 if(written)*written=0;
 if(!out||!receipt||!written||cap<65536||kind<1||kind>3)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;unsigned char*copy=NULL;size_t n=0;
 ynx_native_core_terminal_observation_v1 v={.version=1,.kind=kind};
 if(!d||!q->row)s=VEIL_STORE_REQUIRED;
 /* Cleanup/read-only coordinator admission: preserves expired/UNKNOWN history.
  * It is never fed into effect/current/qualified permission paths. */
 if(!s)s=core_driver_fence_enter(q,1);
 if(!s)s=core_store_open(q);
 if(!s)s=core_store_reference_make(q,v.store_reference);
 for(unsigned i=0;!s&&i<2;i++){
  unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state state={0};
  s=core_driver_domain_read(q,i,raw,&state);
  if(!s&&(state.generation!=d->binding.storage_generation||state.deadline!=d->binding.deadline||
   CRYPTO_memcmp(state.intent,d->binding.intent,32)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(raw,sizeof(raw));OPENSSL_cleanse(&state,sizeof(state));
 }
 if(!s){copy=malloc(65536);if(!copy)s=VEIL_STORE_SQL;}
 if(!s)s=core_terminal_read_pair(d,kind,copy,65536,&n);
 if(!s&&!SHA256(copy,n,v.receipt_digest))s=VEIL_STORE_UNKNOWN;
 if(!s){v.generation=d->binding.storage_generation;v.deadline=d->binding.deadline;
  memcpy(v.intent,d->binding.intent,32);v.facts_written=1;v.owner_unknown=q->unknown||d->unknown;}
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s){memcpy(receipt,copy,n);*written=n;*out=v;}
 if(copy){OPENSSL_cleanse(copy,65536);free(copy);}q->active=0;
 return s?s:(v.owner_unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK);
}

static veil_store_status core_effect_observed_shape(const core_domain_driver*d,const unsigned char*b,size_t n){
 if(!d||!b||n<224||memcmp(b,"YNXCORECASV1",12)||
  CRYPTO_memcmp(b+16,d->binding.intent,32)||core_engine_u64(b+48)!=d->binding.storage_generation||
  core_engine_u64(b+56)!=d->binding.deadline)return VEIL_STORE_MISMATCH;
 uint64_t rows=core_engine_u64(b+80);if(!rows||rows>32||n!=96+(size_t)rows*128)return VEIL_STORE_MISMATCH;
 for(unsigned i=12;i<16;i++)if(b[i])return VEIL_STORE_MISMATCH;
 for(unsigned i=76;i<80;i++)if(b[i])return VEIL_STORE_MISMATCH;
 for(unsigned i=88;i<96;i++)if(b[i])return VEIL_STORE_MISMATCH;
 for(size_t i=0;i<rows;i++){
  const unsigned char*r=b+96+i*128;uint64_t prev=core_engine_u64(r+64),next=core_engine_u64(r+72);
  if(next<=prev||next>INT64_MAX)return VEIL_STORE_MISMATCH;
  for(unsigned k=112;k<128;k++)if(r[k])return VEIL_STORE_MISMATCH;
  for(size_t j=0;j<i;j++)if(!CRYPTO_memcmp(r,b+96+j*128,32))return VEIL_STORE_MISMATCH;
 }
 return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_effect_observe_v1(
 ynx_native_core_resource_loan*p,ynx_native_core_terminal_observation_v1*out,
 unsigned char*effect,size_t cap,size_t*written){
 if(written)*written=0;
 if(!out||!effect||!written||cap<65536)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;unsigned char*copy=NULL;size_t n=0;
 ynx_native_core_terminal_observation_v1 v={.version=1,.kind=0};
 if(!d||!q->row)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_fence_enter(q,1);
 if(!s)s=core_store_reference_make(q,v.store_reference);
 if(!s){copy=malloc(65536);if(!copy)s=VEIL_STORE_SQL;}
 if(!s)s=core_store_effect_read(q,copy,65536,&n,5);
 /* Exact original format, not arbitrary application record or a receipt. */
 if(!s)s=core_effect_observed_shape(d,copy,n);
 if(!s&&!SHA256(copy,n,v.receipt_digest))s=VEIL_STORE_UNKNOWN;
 if(!s){v.generation=d->binding.storage_generation;v.deadline=d->binding.deadline;
  memcpy(v.intent,d->binding.intent,32);v.facts_written=1;v.owner_unknown=q->unknown||d->unknown;}
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s){memcpy(effect,copy,n);*written=n;*out=v;}
 if(copy){OPENSSL_cleanse(copy,65536);free(copy);}q->active=0;
 return s?s:(v.owner_unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK);
}

/* SAME final-root retained resource plus genuine account/device key association.
 * A binding-shaped byte array alone cannot obtain a registered store. */
veil_store_status ynx_native_core_resource_driver_product_reference_v1(
 ynx_native_core_resource_loan*p,const ynx_native_core_device_binding_v2*binding,unsigned char out[32]){
 if(!binding||!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 ynx_native_core_device_binding_v2 authenticated={0};uint64_t generation=0;unsigned char ref[32];
 s=core_driver_fence_enter(q,0);
 if(!s)s=(veil_store_status)ynx_sdk_native_core_storage_binding_v2(q->policy,binding->classic,binding->pq,&authenticated,&generation);
 if(!s&&(generation!=q->driver->binding.storage_generation||
  CRYPTO_memcmp(&authenticated,binding,sizeof(authenticated))))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_store_open(q);
 if(!s)s=core_store_reference_make(q,ref);
 if(!s)s=core_driver_policy(q);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(!s)memcpy(out,ref,32);
 OPENSSL_cleanse(&authenticated,sizeof(authenticated));q->active=0;return s;
}


/* Native-only pre-session load. Authentication mathematics below is not a new
 * Source, peer/session or checkpoint grant. Existing same-q coordinator, SDK
 * READ3 policy, participant and BOTH registered domain originals are mandatory.
 */
#include "ynx_native_product_originals_private.h"
extern int32_t ynx_sdk_native_core_operation_kind_v2(void *,uint32_t *);
static uint32_t core_session_u32(const unsigned char *p){return ((uint32_t)p[0]<<24)|((uint32_t)p[1]<<16)|((uint32_t)p[2]<<8)|p[3];
 }
static uint64_t core_session_u64(const unsigned char *p){uint64_t v=0;
 for(unsigned i=0;i<8;i++)v=(v<<8)|p[i];
 return v;
 }
static int core_session_region(const void *p,size_t n,uintptr_t *start,uintptr_t *end){
 uintptr_t a=(uintptr_t)p;
 if(!a||!n||a>UINTPTR_MAX-n)return 0;
 *start=a;
 *end=a+n;
 return 1;
}
static int core_session_disjoint(uintptr_t a,uintptr_t b,uintptr_t c,uintptr_t d){return b<=c||d<=a;
 }
/* Shape/DATA only. Root/device/generation/name/version must separately match
 * the actual source + registered row; the key owner then authenticates ALL
 * original historical bytes with the unchanged REC1 AEAD, including old
 * request/nonce/logical/binding/sourceABI/session/purpose. Do not renew them. */
static veil_store_status core_session_historical_expected(const unsigned char *blob,size_t size,
 ynx_original_bytes name,uint64_t version,uint64_t generation,const unsigned char root[32],
 const unsigned char device_final[32],ynx_storage_expected *out,size_t *plain_size){
 if(!blob||!name.data||!name.size||name.size>128||!out||!plain_size||!root||!device_final||
  !version||version>INT64_MAX||!generation||generation>UINT32_MAX||size<429||size>66092)return VEIL_STORE_BOUND;
 if(memcmp(blob,"YNXREC1",7)||blob[7]||blob[8]||blob[9]!=1||blob[10]||blob[11]!=1)return VEIL_STORE_MISMATCH;
 uint32_t header_size=core_session_u32(blob+12),plain=core_session_u32(blob+16),cipher=core_session_u32(blob+20),stored_name=core_session_u32(blob+64);
 if(stored_name!=name.size||header_size!=412+stored_name||!plain||plain>65536||cipher!=plain+16||size!=(size_t)header_size+cipher||
  core_session_u64(blob+24)!=generation||core_session_u64(blob+40)!=version||core_session_u64(blob+32)>=version||
  core_session_u32(blob+48)!=6||core_session_u32(blob+60)==0||core_session_u32(blob+60)>127||
  (core_session_u32(blob+68)!=1&&core_session_u32(blob+68)!=2)||core_session_u32(blob+400)!=(uint32_t)generation||
  CRYPTO_memcmp(blob+192,root,32)||CRYPTO_memcmp(blob+224,device_final,32)||CRYPTO_memcmp(blob+412,name.data,name.size))return VEIL_STORE_MISMATCH;
 ynx_storage_expected value={0};
 value.generation=generation;
 value.base_version=core_session_u64(blob+32);
 value.next_version=version;
 value.kind=6;
 value.id=core_session_u32(blob+52);
 value.extra_id=core_session_u32(blob+56);
 value.device=core_session_u32(blob+60);
 value.direction=core_session_u32(blob+68);
 value.container_class=YNX_STORAGE_RECORD;
 for(unsigned i=0;i<11;i++)value.binding[i]=core_session_u64(blob+72+8*i);
 memcpy(value.source_abi,blob+160,32);
 memcpy(value.root,blob+192,32);
 memcpy(value.device_final,blob+224,32);
 memcpy(value.session,blob+256,32);
 memcpy(value.purpose,blob+288,32);
 memcpy(value.request,blob+320,32);
 memcpy(value.operation_nonce,blob+352,32);
 memcpy(value.logical,blob+384,16);
 memcpy(value.storage_nonce,blob+400,12);
 value.name=(ynx_original_bytes){blob+412,stored_name};
 *out=value;
 *plain_size=plain;
 return VEIL_STORE_OK;
}
static veil_store_status core_session_read_scope(ynx_native_core_resource_loan *q){
 if(!q||!q->v2||!q->driver||!q->participant||q->participant->originals.purpose!=2||
  q->driver->binding.purpose!=2||q->driver->binding.operations!=4||!q->driver->binding.relation_present)return VEIL_STORE_MISMATCH;
 if(q->unknown||q->driver->unknown||q->driver->sensitive_map)return VEIL_STORE_UNKNOWN;
 uint32_t operation=0;
 veil_store_status s=(veil_store_status)ynx_sdk_native_core_operation_kind_v2(q->policy,&operation);
 if(!s&&operation!=3)s=VEIL_STORE_MISMATCH;
 if(!s)s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,3);
 if(!s)s=core_driver_policy(q);
 return s;
}
static veil_store_status core_session_domains_current(ynx_native_core_resource_loan *q){
 veil_store_status s=core_session_read_scope(q);
 for(unsigned i=0;!s&&i<2;i++){
  unsigned char raw[YNX_DOMAIN_STATE_BYTES];
  ynx_domain_state state={0};
  s=core_driver_domain_read(q,i,raw,&state);
  if(!s&&CRYPTO_memcmp(raw,q->driver->originals[i],sizeof(raw)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(raw,sizeof(raw));
  OPENSSL_cleanse(&state,sizeof(state));
 }
 if(!s&&(!core_store_path(q)||veil_custody_watch_check(q->driver->store,q->driver->store_watch)))s=VEIL_STORE_MISMATCH;
 return s;
}
veil_store_status ynx_native_core_resource_driver_message_session_read_v1(
 ynx_native_core_resource_loan *supplied,veil_native_message_original_child *child,
 ynx_original_bytes name,unsigned char *sink,size_t capacity,size_t *written,
 ynx_native_core_session_read_v1 *facts){
 uintptr_t ns=0,ne=0,ss=0,se=0,ws=0,we=0,fs=0,fe=0;
 if(!child||name.size>128||capacity>65536||(uintptr_t)written%_Alignof(size_t)||(uintptr_t)facts%_Alignof(ynx_native_core_session_read_v1)||
  !core_session_region(name.data,name.size,&ns,&ne)||!core_session_region(sink,capacity,&ss,&se)||!core_session_region(written,sizeof(*written),&ws,&we)||!core_session_region(facts,sizeof(*facts),&fs,&fe)||
  !core_session_disjoint(ns,ne,ss,se)||!core_session_disjoint(ns,ne,ws,we)||!core_session_disjoint(ns,ne,fs,fe)||!core_session_disjoint(ss,se,ws,we)||!core_session_disjoint(ss,se,fs,fe)||!core_session_disjoint(ws,we,fs,fe))return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan *q=core_resource_recognized(supplied);
 if(q){uintptr_t qs=(uintptr_t)q,qe=qs+sizeof(*q);
  if(!core_session_disjoint(qs,qe,ss,se)||!core_session_disjoint(qs,qe,ws,we)||!core_session_disjoint(qs,qe,fs,fe))return VEIL_STORE_BOUND;
  }
 *written=0;
 OPENSSL_cleanse(sink,capacity);
 if(!q)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(q->active)return VEIL_STORE_FROZEN;
 /* Recognize the independent actual READ3 before touching another original. */
 veil_store_status s=core_session_read_scope(q);
 if(s)return s;
 veil_native_message_original_snapshot_v1 source={0};
 s=veil_private_product_message_original_snapshot_v1(child,&source);
 if(s)return s;
 if(source.version!=1||source.size!=sizeof(source)||(source.kind!=1&&source.kind!=2)||!source.device_final.data||!source.device_final.size)return VEIL_STORE_MISMATCH;
 unsigned char selected_name[128];
 memcpy(selected_name,name.data,name.size);
 ynx_original_bytes selected={selected_name,name.size};
 s=core_driver_operation_enter(q,&q);
 if(s)return s;
 core_domain_driver *d=q->driver;
 unsigned char *ciphertext=NULL,*plain=NULL;
 size_t cipher_size=0,pages=0,plain_size=0,opened=0;
 int locked=0,owns_sql=0;
 sqlite3_stmt *statement=NULL;
 ynx_storage_expected expected={0};
 ynx_native_core_device_binding_v2 binding={0};
 uint64_t generation=0,version=0;
 ynx_native_core_session_read_v1 observed={.version=1,.kind=6};
 unsigned char device_final[32];
 s=core_driver_fence_enter(q,0);
 if(!s)s=(veil_store_status)ynx_sdk_native_core_storage_binding_v2(q->policy,source.device_binding.classic,source.device_binding.pq,&binding,&generation);
 if(!s&&(generation!=d->binding.storage_generation||CRYPTO_memcmp(&binding,&source.device_binding,sizeof(binding))))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_store_open(q);
 if(!s)s=core_store_reference_make(q,observed.store_reference);
 if(!s&&CRYPTO_memcmp(observed.store_reference,source.source_reference,32))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_session_domains_current(q);
 if(!s&&(d->store_transaction||!sqlite3_get_autocommit(d->store)))s=VEIL_STORE_FROZEN;
 /* READ transaction only; never reserve/sign/nonce/write a domain or record. */
 if(!s){if(sqlite3_exec(d->store,"BEGIN",NULL,NULL,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
  else{d->store_transaction=1;
   owns_sql=1;
   }}
 if(!s&&sqlite3_prepare_v2(d->store,"SELECT version,ciphertext FROM core_record WHERE name=?1",-1,&statement,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s&&sqlite3_bind_blob(statement,1,selected.data,(int)selected.size,SQLITE_STATIC)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s){int step=sqlite3_step(statement);
  if(step==SQLITE_DONE)s=VEIL_STORE_REQUIRED;
  else if(step!=SQLITE_ROW)s=VEIL_STORE_SQL;
  else{sqlite3_int64 v=sqlite3_column_int64(statement,0);
   int n=sqlite3_column_bytes(statement,1);
   const void *bytes=sqlite3_column_blob(statement,1);
   if(sqlite3_column_type(statement,0)!=SQLITE_INTEGER||v<=0||sqlite3_column_type(statement,1)!=SQLITE_BLOB||n<429||n>66092||!bytes)s=VEIL_STORE_MISMATCH;
   else{version=(uint64_t)v;
    cipher_size=(size_t)n;
    ciphertext=malloc(cipher_size);
    if(!ciphertext)s=VEIL_STORE_SQL;
    else memcpy(ciphertext,bytes,cipher_size);
    }
   if(!s&&sqlite3_step(statement)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
  }
 }
 if(statement){int finalized=sqlite3_finalize(statement);
  statement=NULL;
  if(finalized!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  }
 if(!s&&!SHA256(source.device_final.data,source.device_final.size,device_final))s=VEIL_STORE_UNKNOWN;
 if(!s)s=core_session_historical_expected(ciphertext,cipher_size,selected,version,generation,binding.root,device_final,&expected,&plain_size);
 if(!s&&plain_size>capacity)s=VEIL_STORE_BOUND;
 if(!s){long page=sysconf(_SC_PAGESIZE);
  if(page<=0||page>1048576)s=VEIL_STORE_BOUND;
  else{pages=(plain_size+(size_t)page-1)/(size_t)page*(size_t)page;
   plain=mmap(NULL,pages,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANON,-1,0);
   if(plain==MAP_FAILED){plain=NULL;
    s=VEIL_STORE_SQL;
    }}}
 if(!s){locked=mlock(plain,pages)==0;
  if(!locked)s=VEIL_STORE_SQL;
  }
 if(!s)s=core_session_domains_current(q);
 if(!s)s=core_resource_primitive(ynx_tpm2_owner_storage_open_v1(q->objects[0],q->row->storage_key_identity,&expected,ciphertext,cipher_size,plain,plain_size,&opened));
 if(!s&&opened!=plain_size)s=VEIL_STORE_MISMATCH;
 if(!s)s=core_session_domains_current(q);
 if(!s){if(sqlite3_exec(d->store,"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(d->store))s=VEIL_STORE_UNKNOWN;
  else{d->store_transaction=0;
   owns_sql=0;
   }}
 /* A failed pure-read snapshot may be rolled back for cleanup only; never
  * claim absence, repeat decrypt, or undo an entered write/effect. */
 if(owns_sql){if(sqlite3_exec(d->store,"ROLLBACK",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(d->store)){if(!s)s=VEIL_STORE_UNKNOWN;
   }else{d->store_transaction=0;
   owns_sql=0;
   }}
 if(!s)s=core_session_domains_current(q);
 if(!s&&(!SHA256(ciphertext,cipher_size,observed.ciphertext_digest)||!SHA256(plain,plain_size,observed.record_digest)))s=VEIL_STORE_UNKNOWN;
 if(!s){observed.storage_generation=generation;
  observed.row_version=version;
  }
 if(d&&d->held){veil_store_status released=core_driver_fence_leave(q);
  if(!s)s=released;
  }
 q->active=0;
 /* No network/Source callback under the coordinator. Retained child current
  * and the SAME resource's complete current fence close the read interval. */
 if(!s)s=veil_private_product_message_original_current_v1(child);
 if(!s)s=ynx_native_core_resource_driver_current(q);
 if(!s)memcpy(sink,plain,plain_size);
 if(plain){OPENSSL_cleanse(plain,pages);
  int unresolved=locked&&munlock(plain,pages);
  if(!unresolved)unresolved=munmap(plain,pages);
  if(unresolved){d->sensitive_map=plain;
   d->sensitive_pages=pages;
   d->unknown=1;
   if(!s)s=VEIL_STORE_UNKNOWN;
   }}
 if(ciphertext){OPENSSL_cleanse(ciphertext,cipher_size);
  free(ciphertext);
  }OPENSSL_cleanse(&expected,sizeof(expected));
 OPENSSL_cleanse(&binding,sizeof(binding));
 OPENSSL_cleanse(&source,sizeof(source));
 OPENSSL_cleanse(device_final,sizeof(device_final));
 OPENSSL_cleanse(selected_name,sizeof(selected_name));
 if(s){OPENSSL_cleanse(sink,capacity);
  return core_resource_fail(q,s);
  }
 *facts=observed;
 *written=plain_size;
 return VEIL_STORE_OK;
}
