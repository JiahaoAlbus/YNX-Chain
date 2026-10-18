/* Completion custody of an ALREADY entered original key call. No grant,
 * signature primitive, new once bit, effect replay or network operation. */
#include <openssl/hmac.h>
static int core_m3_parts_valid(const unsigned char*b,size_t n,uint32_t kind){
 if(!b||n<80||n>9462||memcmp(b,"YNXCOREM3PART1",14)||b[14]||b[15]||
  core_engine_u64(b+16)!=kind||core_engine_u64(b+24)>(kind==2?3u:15u)||
  core_engine_u64(b+72))return 0;
 size_t total=80;
 for(unsigned i=0;i<4;i++){uint64_t len=core_engine_u64(b+32+8*i);
  if(len>(i%2?4627u:64u)||(kind==2&&i>1&&len))return 0;total+=(size_t)len;}
 return total==n;
}
static veil_store_status core_m3_parts_mac(core_domain_driver*d,unsigned domain,
 uint32_t kind,ynx_original_bytes capture,ynx_original_bytes parts,unsigned char out[32]){
 if(domain>1||!d->keys||!d->locked||!capture.data||!capture.size||capture.size>100000||
  parts.size>9462||(parts.size&&!parts.data))return VEIL_STORE_REQUIRED;
 unsigned char ad[112]={0},body[112+9462];unsigned len=0;
 memcpy(ad,"YNX/CORE/M3/PARTS/V1",20);memcpy(ad+24,d->binding.intent,32);
 core_store_u64(ad+56,kind);core_store_u64(ad+64,parts.size);
 if(!SHA256(capture.data,capture.size,ad+72))return VEIL_STORE_UNKNOWN;
 core_store_u64(ad+104,domain);memcpy(body,ad,sizeof(ad));
 if(parts.size)memcpy(body+sizeof(ad),parts.data,parts.size);
 int ok=HMAC(EVP_sha256(),d->keys+32*domain,32,body,sizeof(ad)+parts.size,out,&len)!=NULL&&len==32;
 OPENSSL_cleanse(body,sizeof(body));return ok?VEIL_STORE_OK:VEIL_STORE_UNKNOWN;
}
static veil_store_status core_m3_parts_adopt(core_message3_state*m,
 const ynx_native_core_message3_snapshot_v1*s,veil_store_status first){
 if(!core_m3_same(m,s))return VEIL_STORE_MISMATCH;
 if(m->parts_size&&!core_m3_parts_valid(m->parts,m->parts_size,s->kind))return VEIL_STORE_MISMATCH;
 unsigned char next[9462]={0};memcpy(next,"YNXCOREM3PART1",14);
 core_store_u64(next+16,s->kind);core_store_u64(next+24,m->mask);
 core_store_u64(next+64,(uint64_t)first);size_t at=80,oldat=80;
 for(unsigned i=0;i<4;i++){
  ynx_original_bytes v=i%2?s->pq[i/2]:s->classic[i/2];
  size_t old=m->parts_size?(size_t)core_engine_u64(m->parts+32+i*8):0;
  if(v.size>(i%2?4627u:64u)||(v.size&&!v.data)||(i/2>=s->role_count&&v.size)||
   (v.size&&!(m->mask&(1u<<i)))||v.size<old||
   (old&&CRYPTO_memcmp(m->parts+oldat,v.data,old)))return VEIL_STORE_MISMATCH;
  core_store_u64(next+32+i*8,v.size);if(v.size)memcpy(next+at,v.data,v.size);
  at+=v.size;oldat+=old;
 }
 memcpy(m->parts,next,at);m->parts_size=at;return VEIL_STORE_OK;
}
/* No current/permission check precedes observing public partials after the
 * actual key call: revocation/expiry must not discard the call's originals.
 * Same holder/policy, captured id/body/frames and original in-flight fence are
 * mandatory. SDK non-OK is preserved, never converted into signing success. */
static veil_store_status core_m3_partial_snapshot(ynx_native_core_resource_loan*q,
 void*holder,uint32_t kind,ynx_native_core_message3_snapshot_v1*out,veil_store_status*sdk){
 core_domain_driver*d=q->driver;core_message3_state*m=&d->m3[kind-1];
 if(!q->active||!d->held||!m->borrowed||!m->entered||m->holder!=holder||!m->observation_pending)return VEIL_STORE_LIFETIME;
 ynx_native_core_message3_effect_v1 f={0};f.version=1;f.kind=kind;
 f.storage_generation=d->binding.storage_generation;f.policy_generation=d->binding.policy_generation;f.deadline=d->binding.deadline;
 memcpy(f.intent,d->binding.intent,32);memcpy(f.effect_digest,d->effect_digest,32);
 f.effect_original=(ynx_original_bytes){d->effect_original,d->effect_original_size};
 if(d->checkpoint_committed)f.checkpoint_original=(ynx_original_bytes){d->checkpoint_original,d->checkpoint_size};
 for(unsigned i=0;i<2;i++)f.domain_originals[i]=(ynx_original_bytes){d->effect_domain_originals[i],YNX_DOMAIN_STATE_BYTES};
 memset(out,0,sizeof(*out));*sdk=(veil_store_status)ynx_sdk_native_message3_snapshot_v1(holder,q->policy,&f,out);
 if(out->version!=1||out->kind!=kind||out->role_count!=(kind==2?1u:2u)||
  out->storage_generation!=f.storage_generation||out->policy_generation!=f.policy_generation||
  out->deadline!=f.deadline||CRYPTO_memcmp(out->intent,f.intent,32)||!core_m3_same(m,out))return VEIL_STORE_MISMATCH;
 for(unsigned i=0;i<out->role_count;i++)if(!core_m3_frame(out,i))return VEIL_STORE_MISMATCH;
 return VEIL_STORE_OK;
}
static veil_store_status core_m3_parts_read_domain(ynx_native_core_resource_loan*q,
 uint32_t kind,unsigned domain,unsigned char*out,size_t cap,size_t*written){
 *written=0;core_domain_driver*d=q->driver;
 if(domain>1||!d->held||!d->db[domain]||d->transaction[domain]||
  !sqlite3_get_autocommit(d->db[domain]))return VEIL_STORE_UNKNOWN;
 veil_store_status s=veil_custody_watch_check(d->db[domain],d->watch[domain]);if(s)return s;
 sqlite3_stmt*st=NULL;
 if(sqlite3_prepare_v2(d->db[domain],"SELECT original,signing_mask,state,parts,parts_mac FROM core_message3 WHERE intent=?1 AND kind=?2",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 s=VEIL_STORE_MISMATCH;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&
  sqlite3_bind_int64(st,2,kind)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
  int cn=sqlite3_column_bytes(st,0),pn=sqlite3_column_bytes(st,3);const unsigned char*c=sqlite3_column_blob(st,0),*p=sqlite3_column_blob(st,3),*mac=sqlite3_column_blob(st,4);
  sqlite3_int64 mask=sqlite3_column_int64(st,1),state=sqlite3_column_int64(st,2);unsigned char expected[32];
  if(sqlite3_column_type(st,0)==SQLITE_BLOB&&cn>=80&&cn<=100000&&c&&
   !memcmp(c,"YNXCOREM3CAP1",13)&&core_engine_u64(c+16)==kind&&
   core_engine_u64(c+24)==d->binding.storage_generation&&core_engine_u64(c+32)==d->binding.policy_generation&&
   core_engine_u64(c+40)==d->binding.deadline&&sqlite3_column_type(st,1)==SQLITE_INTEGER&&mask>=0&&mask<=(kind==2?3:15)&&
   sqlite3_column_type(st,2)==SQLITE_INTEGER&&(state==1||state==2)&&sqlite3_column_type(st,3)==SQLITE_BLOB&&
   pn>0&&core_m3_parts_valid(p,(size_t)pn,kind)&&core_engine_u64(p+24)<=(uint64_t)mask&&
   !(core_engine_u64(p+24)&~(uint64_t)mask)&&sqlite3_column_type(st,4)==SQLITE_BLOB&&sqlite3_column_bytes(st,4)==32&&mac){
   s=core_m3_parts_mac(d,domain,kind,(ynx_original_bytes){c,(size_t)cn},(ynx_original_bytes){p,(size_t)pn},expected);
   if(!s&&CRYPTO_memcmp(mac,expected,32))s=VEIL_STORE_MISMATCH;
   if(!s&&(size_t)pn>cap)s=VEIL_STORE_BOUND;
   if(!s){memcpy(out,p,(size_t)pn);*written=(size_t)pn;if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;}
  }
 }
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;return s;
}
/* Append public observation of this single in-flight key call. Even if SDK
 * current failed, this cleanup cannot sign, change mask, create an attempt,
 * resume effects or clear UNKNOWN. Complete old BLOB+MAC CAS in BOTH stores. */
static veil_store_status core_m3_parts_persist(ynx_native_core_resource_loan*q,uint32_t kind){
 core_domain_driver*d=q->driver;core_message3_state*m=&d->m3[kind-1];
 if(!q->active||!d->held||!m->observation_pending||!m->parts_size)return VEIL_STORE_LIFETIME;
 for(unsigned i=0;i<2;i++){
  if(d->transaction[i]||!sqlite3_get_autocommit(d->db[i]))return VEIL_STORE_UNKNOWN;
  veil_store_status s=veil_custody_watch_check(d->db[i],d->watch[i]);if(s)return s;
  unsigned char previous[32],next[32];
  s=core_m3_parts_mac(d,i,kind,(ynx_original_bytes){m->capture,m->capture_size},
   (ynx_original_bytes){m->domain_parts[i],m->domain_parts_size[i]},previous);if(s)return s;
  s=core_m3_parts_mac(d,i,kind,(ynx_original_bytes){m->capture,m->capture_size},
   (ynx_original_bytes){m->parts,m->parts_size},next);if(s)return s;
  if(sqlite3_exec(d->db[i],"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;d->transaction[i]=1;
  sqlite3_stmt*st=NULL;const char*sql="UPDATE core_message3 SET parts=?4,parts_mac=?5 WHERE intent=?1 AND kind=?2 AND original=?3 AND signing_mask=?6 AND state=1 AND parts=?7 AND parts_mac=?8";
  if(sqlite3_prepare_v2(d->db[i],sql,-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  s=VEIL_STORE_SQL;
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_int64(st,2,kind)==SQLITE_OK&&
   sqlite3_bind_blob(st,3,m->capture,(int)m->capture_size,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_blob(st,4,m->parts,(int)m->parts_size,SQLITE_STATIC)==SQLITE_OK&&sqlite3_bind_blob(st,5,next,32,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_int64(st,6,m->domain_mask[i])==SQLITE_OK&&sqlite3_bind_blob(st,7,m->domain_parts[i],(int)m->domain_parts_size[i],SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_blob(st,8,previous,32,SQLITE_STATIC)==SQLITE_OK)
   s=sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(d->db[i])==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;if(s)return s;
  if(sqlite3_exec(d->db[i],"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(d->db[i]))return VEIL_STORE_UNKNOWN;
  d->transaction[i]=0;unsigned char original[9462];size_t n=0;
  s=core_m3_parts_read_domain(q,kind,i,original,sizeof(original),&n);
  if(s||n!=m->parts_size||CRYPTO_memcmp(original,m->parts,n))return s?s:VEIL_STORE_MISMATCH;
  memcpy(m->domain_parts[i],original,n);m->domain_parts_size[i]=n;
 }
 m->observation_pending=0;return VEIL_STORE_OK;
}
static veil_store_status core_m3_parts_match(ynx_native_core_resource_loan*q,uint32_t kind,
 const ynx_native_core_message3_snapshot_v1*s){
 core_message3_state*m=&q->driver->m3[kind-1];
 if(m->observation_pending||!core_m3_parts_valid(m->parts,m->parts_size,kind))return VEIL_STORE_UNKNOWN;
 size_t at=80;
 for(unsigned i=0;i<4;i++){ynx_original_bytes p=i%2?s->pq[i/2]:s->classic[i/2];
  size_t n=(size_t)core_engine_u64(m->parts+32+i*8);
  if(n!=p.size||(n&&(!p.data||CRYPTO_memcmp(m->parts+at,p.data,n))))return VEIL_STORE_MISMATCH;at+=n;}
 for(unsigned i=0;i<2;i++){unsigned char original[9462];size_t n=0;
  veil_store_status z=core_m3_parts_read_domain(q,kind,i,original,sizeof(original),&n);
  if(z||n!=m->parts_size||CRYPTO_memcmp(original,m->parts,n))return z?z:VEIL_STORE_MISMATCH;}
 return VEIL_STORE_OK;
}
static veil_store_status core_m3_parts_close_check(ynx_native_core_resource_loan*q,uint32_t kind){
 core_domain_driver*d=q->driver;core_message3_state*m=&d->m3[kind-1];
 int acquired=!d->held;veil_store_status s=acquired?core_driver_fence_enter(q,1):VEIL_STORE_OK;
 for(unsigned i=0;!s&&i<2;i++){unsigned char original[9462];size_t n=0;
  s=core_m3_parts_read_domain(q,kind,i,original,sizeof(original),&n);
  if(!s&&(n!=m->parts_size||CRYPTO_memcmp(original,m->parts,n)))s=VEIL_STORE_MISMATCH;
 }
 if(acquired&&d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 return s;
}
