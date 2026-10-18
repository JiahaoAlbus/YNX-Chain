/* Facts-only original source context. The normal storage serializer is
 * ynx_source_platform_qualified.c::header, not an inferred tuple grammar. */
#include "ynx_native_core_engine_context_private.h"
static veil_store_status core_engine_read(ynx_native_core_resource_loan*,unsigned char*,size_t,size_t*);
/* Private type comes only from the recognized retained finish. A journal's
 * last row, public string or absence of queue never selects this subtype. */
static veil_store_status core_engine_typed_count(uint32_t type,uint32_t steps,uint32_t count){
 if(type>VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE||!count||count>32)return VEIL_STORE_BOUND;
 if(type==VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE)return steps==1&&count==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
 return steps<32&&steps+1==count?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
}
static veil_store_status core_engine_typed_row(uint32_t type,uint32_t count,uint32_t ix,
 const unsigned char*kind,uint32_t kn,const unsigned char*id,uint32_t idn,
 const unsigned char*envelope,int*queue){
 static const unsigned char bootstrap[]="first-device-bootstrap-v1";
 if(!kind||!id||!envelope||!queue||!count||ix>=count)return VEIL_STORE_BOUND;
 int reserved=kn==sizeof(bootstrap)-1&&!memcmp(kind,bootstrap,sizeof(bootstrap)-1);
 int network=(kn==5&&!memcmp(kind,"inbox",5))||(kn==6&&!memcmp(kind,"outbox",6));
 if(type==VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE){
  if(count!=1||ix||!reserved||idn!=64||envelope[8]||envelope[9]!=2||envelope[10]||envelope[11]!=1||core_engine_u32(envelope+24)!=7)return VEIL_STORE_MISMATCH;
  for(uint32_t i=0;i<idn;i++)if(!((id[i]>='0'&&id[i]<='9')||(id[i]>='a'&&id[i]<='f')))return VEIL_STORE_MISMATCH;
  *queue=0;return VEIL_STORE_OK;
 }
 if(type!=VEIL_PRIVATE_NATIVE_MESSAGE||reserved||core_engine_u32(envelope+48)==7)return VEIL_STORE_MISMATCH;
 *queue=ix+1==count;
 return network==*queue?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
}
static veil_store_status core_engine_context_parse(const core_domain_driver*d,
 ynx_original_bytes journal,unsigned char out[120]){
 if(!d||!out||!journal.data||journal.size<12||memcmp(journal.data,"YNXJRN1\0",8))return VEIL_STORE_BOUND;
 /* Tagged init AAD intentionally has NO message SourceABI/11 coordinates.
  * Until normal same-owner Source/storage descriptor factory is supplied,
  * do not map digests/zero fields/post-commit observations into that context. */
 if(d->engine_native_kind==VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE)return VEIL_STORE_REQUIRED;
 const unsigned char*p=journal.data;uint32_t count=core_engine_u32(p+8);
 if(!count||count>32||d->engine_native_kind>VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE||
  (d->engine_native_kind==VEIL_PRIVATE_NATIVE_FIRST_DEVICE_INITIALIZE_STORAGE&&count!=1))return VEIL_STORE_BOUND;
 p+=12;size_t left=journal.size-12;
 unsigned char common[120]={0};
 for(unsigned i=0;i<count;i++){
  if(left<16)return VEIL_STORE_BOUND;
  uint32_t sequence=core_engine_u32(p),kn=core_engine_u32(p+4),idn=core_engine_u32(p+8),cn=core_engine_u32(p+12);
  if(sequence!=i||!kn||kn>32||!idn||idn>1024||cn<428||cn>1049132||
   (size_t)kn+idn+cn>left-16)return VEIL_STORE_BOUND;
  int queue=0;const unsigned char*kind=p+16,*b=kind+kn+idn;
  veil_store_status typed=core_engine_typed_row(d->engine_native_kind,count,i,kind,kn,kind+kn,idn,b,&queue);if(typed)return typed;
  uint32_t name=core_engine_u32(b+64),header=core_engine_u32(b+12),plain=core_engine_u32(b+16);
  if(memcmp(b,queue?"YNXQUE1":"YNXREC1",7)||b[7]||b[8]||b[9]!=1||b[10]||b[11]!=1||
   !name||name>128||header!=412+name||plain>(queue?1048576u:65536u)||
   cn!=(size_t)header+plain+16||core_engine_u32(b+20)!=plain+16||
   core_engine_u64(b+24)!=d->binding.storage_generation||
   CRYPTO_memcmp(b+320,d->binding.intent,32))return VEIL_STORE_MISMATCH;
  unsigned char actual[120];memcpy(actual,b+160,32);memcpy(actual+32,b+72,88);
  if(!i)memcpy(common,actual,sizeof(common));
  else if(CRYPTO_memcmp(common,actual,sizeof(common)))return VEIL_STORE_MISMATCH;
  size_t n=16+(size_t)kn+idn+cn;p+=n;left-=n;
 }
 if(left)return VEIL_STORE_BOUND;
 /* Facts need not be interpreted as valid rights here. The actual normal
  * Source/SDK independently verifies their values before any signing. */
 memcpy(out,common,sizeof(common));return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_engine_context_query(
 ynx_native_core_resource_loan*p,unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;
 if(!out||!written||cap<120)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;unsigned char binding[416],context[120];size_t checked=0;
 if(!d||!d->engine_prepared||!d->effect_entered)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_fence_enter(q,1);
 if(!s)s=core_store_open(q);
 if(!s)s=core_engine_read(q,binding,sizeof(binding),&checked);
 sqlite3_stmt*st=NULL;
 if(!s&&sqlite3_prepare_v2(d->store,"SELECT journal FROM core_engine_binding WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 if(!s){
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||sqlite3_step(st)!=SQLITE_ROW)s=VEIL_STORE_MISMATCH;
  else{const unsigned char*raw=sqlite3_column_blob(st,0);int n=sqlite3_column_bytes(st,0);
   if(sqlite3_column_type(st,0)!=SQLITE_BLOB||n<=0||!raw||(size_t)n!=d->engine_journal_size||
    CRYPTO_memcmp(raw,d->engine_journal,(size_t)n))s=VEIL_STORE_MISMATCH;
   else s=core_engine_context_parse(d,(ynx_original_bytes){raw,(size_t)n},context);
   if(!s&&sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
  }
 }
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 if(!s){memcpy(out,context,sizeof(context));*written=sizeof(context);}
 if(d&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;return s?s:q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
