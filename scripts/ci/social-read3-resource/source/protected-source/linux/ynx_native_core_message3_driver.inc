/* Same original resource owner Message3 callee. Native Rust supplies only
 * recognized same-holder snapshots through fixed compiled exports; no callback
 * installer, Root constructor, Rust Accepted input or caller success flag. */
#include "ynx_native_core_message3_private.h"
#include <openssl/evp.h>
#include <stdio.h>
static veil_store_status core_m3_terminal_domains(ynx_native_core_resource_loan*);
static const char*core_m3_kind_name(uint32_t k){
 return k==1?"engineCommit":k==2?"engineCheckpoint":k==3?"engineTerminal":NULL;
}
static const char*core_m3_role(uint32_t k,unsigned i){
 static const char*roles[3][2]={
  {"first-device-engine-commit-issuer","first-device-engine-commit-anchor"},
  {"first-device-independent-checkpoint-anchor",NULL},
  {"first-device-independent-terminal-issuer","first-device-independent-terminal-anchor"}};
 return k>=1&&k<=3&&i<2?roles[k-1][i]:NULL;
}
static const char*core_m3_domain(uint32_t k){
 return k==1?"YNX/SOCIAL/FIRST-DEVICE-ENGINE-COMMIT/V1":
  k==2?"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-CHECKPOINT/V1":
  k==3?"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-TERMINAL/V1":NULL;
}
static veil_store_status core_m3_effect_facts_inner(ynx_native_core_resource_loan*q,
 uint32_t kind,ynx_native_core_message3_effect_v1*out){
 if(!out||!core_m3_kind_name(kind))return VEIL_STORE_BOUND;memset(out,0,sizeof(*out));
 core_domain_driver*d=q->driver;
 if(!d||!d->held||!d->local_committed||!d->effect_original||!d->engine_committed)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_driver_policy(q);if(s)return s;
 if(kind>1&&!d->checkpoint_committed)return VEIL_STORE_REQUIRED;
 if(kind>1&&!d->m3[kind-2].retired)return VEIL_STORE_REQUIRED;
 out->version=1;out->kind=kind;out->storage_generation=d->binding.storage_generation;
 out->policy_generation=d->binding.policy_generation;out->deadline=d->binding.deadline;
 memcpy(out->intent,d->binding.intent,32);memcpy(out->effect_digest,d->effect_digest,32);
 out->effect_original=(ynx_original_bytes){d->effect_original,d->effect_original_size};
 if(d->checkpoint_committed)out->checkpoint_original=(ynx_original_bytes){d->checkpoint_original,d->checkpoint_size};
 for(unsigned i=0;i<2;i++)out->domain_originals[i]=(ynx_original_bytes){d->effect_domain_originals[i],YNX_DOMAIN_STATE_BYTES};
 return VEIL_STORE_OK;
}
static int core_m3_frame(const ynx_native_core_message3_snapshot_v1*s,unsigned i){
 const char*dom=core_m3_domain(s->kind),*role=core_m3_role(s->kind,i);
 if(!dom||!role)return 0;size_t dn=strlen(dom)+1,rn=strlen(role);
 ynx_original_bytes f=s->frames[i];
 if(!f.data||!s->body.data||!s->body.size||s->body.size>32768||
  f.size!=dn+1+rn+4+s->body.size||f.size>33280)return 0;
 const unsigned char*b=f.data;if(memcmp(b,dom,dn)||b[dn]!=rn||memcmp(b+dn+1,role,rn))return 0;
 uint32_t size=0;for(unsigned j=0;j<4;j++)size=(size<<8)|b[dn+1+rn+j];
 return size==s->body.size&&!CRYPTO_memcmp(b+dn+1+rn+4,s->body.data,s->body.size);
}
static veil_store_status core_m3_snapshot(ynx_native_core_resource_loan*q,void*holder,
 uint32_t kind,ynx_native_core_message3_snapshot_v1*out){
 ynx_native_core_message3_effect_v1 facts={0};
 veil_store_status s=core_m3_effect_facts_inner(q,kind,&facts);if(s)return s;
 memset(out,0,sizeof(*out));
 /* This actual Rust export must recognize inventory/role/current and match
  * the typed original operation/body. Tuple comparison below is NOT admission. */
 s=(veil_store_status)ynx_sdk_native_message3_snapshot_v1(holder,q->policy,&facts,out);
 if(s)return s;
 core_domain_driver*d=q->driver;
 if(out->version!=1||out->kind!=kind||out->role_count!=(kind==2?1u:2u)||
  out->storage_generation!=d->binding.storage_generation||
  out->policy_generation!=d->binding.policy_generation||out->deadline!=d->binding.deadline||
  CRYPTO_memcmp(out->intent,d->binding.intent,32)||
  !out->id.data||!out->id.size||out->id.size>512)return VEIL_STORE_MISMATCH;
 for(size_t i=0;i<out->id.size;i++)if(out->id.data[i]<32||out->id.data[i]>126)return VEIL_STORE_BOUND;
 for(unsigned i=0;i<out->role_count;i++)if(!core_m3_frame(out,i))return VEIL_STORE_MISMATCH;
 return VEIL_STORE_OK;
}
static veil_store_status core_m3_capture(core_message3_state*m,
 const ynx_native_core_message3_snapshot_v1*s){
 size_t n=80+s->id.size+s->body.size+s->frames[0].size+s->frames[1].size;
 if(n>100000||!n)return VEIL_STORE_BOUND;
 unsigned char*p=malloc(n);if(!p)return VEIL_STORE_SQL;
 m->capture=p;m->capture_size=n;size_t at=80;
 memset(p,0,80);memcpy(p,"YNXCOREM3CAP1",13);
 core_store_u64(p+16,s->kind);core_store_u64(p+24,s->storage_generation);
 core_store_u64(p+32,s->policy_generation);core_store_u64(p+40,s->deadline);
 const ynx_original_bytes *in[]={&s->id,&s->body,&s->frames[0],&s->frames[1]};
 ynx_original_bytes*out[]={&m->id,&m->body,&m->frames[0],&m->frames[1]};
 for(unsigned i=0;i<4;i++){core_store_u64(p+48+i*8,in[i]->size);*out[i]=(ynx_original_bytes){p+at,in[i]->size};
  if(in[i]->size)memcpy(p+at,in[i]->data,in[i]->size);at+=in[i]->size;}
 return VEIL_STORE_OK;
}
static veil_store_status core_m3_fail(ynx_native_core_resource_loan*q,core_message3_state*m,veil_store_status s){
 m->unknown=1;q->driver->unknown=1;
 if(!q->first)q->first=s?s:VEIL_STORE_UNKNOWN;
 q->unknown=1;return VEIL_STORE_UNKNOWN;
}
static int core_m3_same(const core_message3_state*m,const ynx_native_core_message3_snapshot_v1*s){
 const ynx_original_bytes*a[]={&m->id,&m->body,&m->frames[0],&m->frames[1]};
 const ynx_original_bytes*b[]={&s->id,&s->body,&s->frames[0],&s->frames[1]};
 for(unsigned i=0;i<4;i++)if((b[i]->size&&!b[i]->data)||a[i]->size!=b[i]->size||
  (a[i]->size&&CRYPTO_memcmp(a[i]->data,b[i]->data,a[i]->size)))return 0;
 return 1;
}
#include "ynx_native_core_message3_parts.inc"
/* Pre-existing domain table:
 * core_message3(intent BLOB,kind INTEGER,original BLOB,signing_mask INTEGER,
 * state INTEGER,receipt BLOB,parts BLOB NOT NULL,parts_mac BLOB NOT NULL,
 * PRIMARY KEY(intent,kind)).
 * Never CREATE/REPLACE/reset an old signed attempt. */
static veil_store_status core_m3_persist(ynx_native_core_resource_loan*q,uint32_t kind,
 unsigned mask,unsigned state,ynx_original_bytes receipt,int entering){
 core_domain_driver*d=q->driver;core_message3_state*m=&d->m3[kind-1];
 if(!d->held||!m->capture||(!mask&&!entering&&state!=2))return VEIL_STORE_BOUND;
 for(unsigned i=0;i<2;i++){
  if(d->transaction[i])return VEIL_STORE_UNKNOWN;
  if(sqlite3_exec(d->db[i],"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  d->transaction[i]=1;sqlite3_stmt*st=NULL;
  const char*sql=entering?
   "INSERT INTO core_message3(intent,kind,original,signing_mask,state,receipt,parts,parts_mac) VALUES(?1,?2,?3,?4,?5,?6,?8,?9)":
   "UPDATE core_message3 SET signing_mask=?4,state=?5,receipt=?6 WHERE intent=?1 AND kind=?2 AND original=?3 AND signing_mask=?7 AND state=1 AND parts=?8 AND parts_mac=?9";
  unsigned char parts_mac[32];veil_store_status mac_status=core_m3_parts_mac(d,i,kind,
   (ynx_original_bytes){m->capture,m->capture_size},
   (ynx_original_bytes){m->domain_parts[i],m->domain_parts_size[i]},parts_mac);
  if(mac_status)return mac_status;
  if(sqlite3_prepare_v2(d->db[i],sql,-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  veil_store_status s=VEIL_STORE_SQL;
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_int64(st,2,kind)==SQLITE_OK&&sqlite3_bind_blob(st,3,m->capture,(int)m->capture_size,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_int64(st,4,mask)==SQLITE_OK&&sqlite3_bind_int64(st,5,state)==SQLITE_OK&&
   sqlite3_bind_blob(st,6,receipt.data,(int)receipt.size,SQLITE_STATIC)==SQLITE_OK&&
   (entering||sqlite3_bind_int64(st,7,m->domain_mask[i])==SQLITE_OK)&&
   sqlite3_bind_blob(st,8,m->domain_parts[i],(int)m->domain_parts_size[i],SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_blob(st,9,parts_mac,32,SQLITE_STATIC)==SQLITE_OK)
   s=sqlite3_step(st)==SQLITE_DONE&&sqlite3_changes(d->db[i])==1?VEIL_STORE_OK:VEIL_STORE_MISMATCH;
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(!s)s=core_driver_policy(q);
  if(!s&&(sqlite3_exec(d->db[i],"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||
    !sqlite3_get_autocommit(d->db[i])))s=VEIL_STORE_UNKNOWN;
  if(s)return s;
  d->transaction[i]=0;m->domain_mask[i]=mask;
 }
 return core_driver_policy(q);
}
static veil_store_status core_m3_read_receipt(ynx_native_core_resource_loan*q,uint32_t kind,
 unsigned char*out,size_t cap,size_t*written){
 core_domain_driver*d=q->driver;*written=0;
 for(unsigned i=0;i<2;i++){
  sqlite3_stmt*st=NULL;
  if(sqlite3_prepare_v2(d->db[i],"SELECT receipt FROM core_message3 WHERE intent=?1 AND kind=?2 AND state=2",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
  veil_store_status s=VEIL_STORE_MISMATCH;
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&
   sqlite3_bind_int64(st,2,kind)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
   const void*p=sqlite3_column_blob(st,0);int n=sqlite3_column_bytes(st,0);
   if(sqlite3_column_type(st,0)==SQLITE_BLOB&&n>0&&n<=65536&&(size_t)n<=cap&&p){
    if(!i){memcpy(out,p,(size_t)n);*written=(size_t)n;s=VEIL_STORE_OK;}
    else if((size_t)n==*written&&!CRYPTO_memcmp(out,p,*written))s=VEIL_STORE_OK;
    if(sqlite3_step(st)!=SQLITE_DONE)s=VEIL_STORE_MISMATCH;
   }
  }
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(s)return s; /* preserve first domain's REAL partial readback, not echo */
 }
 return VEIL_STORE_OK;
}
static char*core_m3_b64(ynx_original_bytes v){
 if(!v.data||!v.size||v.size>32768)return NULL;
 size_t n=4*((v.size+2)/3);char*b=malloc(n+1);if(!b)return NULL;
 int z=EVP_EncodeBlock((unsigned char*)b,v.data,(int)v.size);
 if(z<0||(size_t)z!=n){free(b);return NULL;}
 while(n&&b[n-1]=='=')n--;
 for(size_t i=0;i<n;i++){if(b[i]=='+')b[i]='-';else if(b[i]=='/')b[i]='_';}b[n]=0;return b;
}
static void core_m3_hex(const unsigned char*b,char*out){
 static const char h[]="0123456789abcdef";for(unsigned i=0;i<32;i++){out[2*i]=h[b[i]>>4];out[2*i+1]=h[b[i]&15];}out[64]=0;
}
static char*core_m3_id_json(ynx_original_bytes id){
 char*out=malloc(id.size*6+1);if(!out)return NULL;size_t n=0;
 for(size_t i=0;i<id.size;i++){unsigned char c=id.data[i];
  if(c=='"'||c=='\\'){out[n++]='\\';out[n++]=(char)c;}
  else if(c=='&'||c=='<'||c=='>'){const char*h=c=='&'?"\\u0026":c=='<'?"\\u003c":"\\u003e";memcpy(out+n,h,6);n+=6;}
  else out[n++]=(char)c;
 }out[n]=0;return out;
}
/* Construct the original receipt from retained REAL signature parts. No input
 * receipt can supply bytes, hashes or roles. Auth's five old domains unchanged. */
static veil_store_status core_m3_receipt(const ynx_native_core_message3_snapshot_v1*s,
 unsigned char*out,size_t cap,size_t*written){
 *written=0;char*body=core_m3_b64(s->body),*id=core_m3_id_json(s->id);
 if(!body||!id){free(body);free(id);return VEIL_STORE_SQL;}
 unsigned char digest[32];char bodyhash[65],hash[2][65];size_t bytes[2]={0};
 veil_store_status result=VEIL_STORE_OK;
 if(!SHA256(s->body.data,s->body.size,digest)){result=VEIL_STORE_UNKNOWN;goto done;}core_m3_hex(digest,bodyhash);
 for(unsigned i=0;i<s->role_count;i++){
  if(s->classic[i].size!=64||s->pq[i].size!=4627){result=VEIL_STORE_MISMATCH;goto done;}
  char*c=core_m3_b64(s->classic[i]),*p=core_m3_b64(s->pq[i]);if(!c||!p){free(c);free(p);result=VEIL_STORE_SQL;goto done;}
  const char*fmt="{\"version\":1,\"role\":\"%s\",\"body\":\"%s\",\"signature\":{\"classic\":\"%s\",\"pq\":\"%s\"}}";
  int n=snprintf(NULL,0,fmt,core_m3_role(s->kind,i),body,c,p);
  char*envelope=n>0&&n<=65536?malloc((size_t)n+1):NULL;
  if(!envelope){free(c);free(p);result=VEIL_STORE_BOUND;goto done;}
  snprintf(envelope,(size_t)n+1,fmt,core_m3_role(s->kind,i),body,c,p);free(c);free(p);
  bytes[i]=(size_t)n;if(!SHA256((unsigned char*)envelope,(size_t)n,digest)){free(envelope);result=VEIL_STORE_UNKNOWN;goto done;}
  core_m3_hex(digest,hash[i]);free(envelope);
 }
 const char*one="{\"version\":1,\"id\":\"%s\",\"kind\":\"%s\",\"bodyDigest\":\"%s\",\"originals\":[{\"bytes\":%zu,\"sha256\":\"%s\"}]}";
 const char*two="{\"version\":1,\"id\":\"%s\",\"kind\":\"%s\",\"bodyDigest\":\"%s\",\"originals\":[{\"bytes\":%zu,\"sha256\":\"%s\"},{\"bytes\":%zu,\"sha256\":\"%s\"}]}";
 int n=s->role_count==1?snprintf((char*)out,cap,one,id,core_m3_kind_name(s->kind),bodyhash,bytes[0],hash[0]):
  snprintf((char*)out,cap,two,id,core_m3_kind_name(s->kind),bodyhash,bytes[0],hash[0],bytes[1],hash[1]);
 if(n<0||n>65536||(size_t)n>=cap){result=VEIL_STORE_BOUND;goto done;}*written=(size_t)n;
done:OPENSSL_cleanse(digest,sizeof(digest));free(body);free(id);return result;
}
static veil_store_status core_m3_close(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d)return VEIL_STORE_OK;
 for(unsigned k=0;k<3;k++){core_message3_state*m=&d->m3[k];
  /* Never release the only live original after a failed signer/observation.
   * Both stores must contain the exact public originals first. No retry here. */
  if(m->observation_pending)return core_resource_fail(q,VEIL_STORE_UNKNOWN);
  if(m->parts_size&&(m->domain_parts_size[0]!=m->parts_size||m->domain_parts_size[1]!=m->parts_size||
   CRYPTO_memcmp(m->domain_parts[0],m->parts,m->parts_size)||
   CRYPTO_memcmp(m->domain_parts[1],m->parts,m->parts_size)))return core_resource_fail(q,VEIL_STORE_UNKNOWN);
  if(m->parts_size){veil_store_status z=core_m3_parts_close_check(q,k+1);
   if(z)return core_resource_fail(q,z);}
  if(m->borrowed){
   veil_store_status s=(veil_store_status)ynx_sdk_native_message3_release_v1(m->holder,q->policy);
   if(s)return core_resource_fail(q,s);m->borrowed=0;
  }
  if(m->capture){OPENSSL_cleanse(m->capture,m->capture_size);free(m->capture);m->capture=NULL;}
 }
 return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_message3_effect_facts(
 ynx_native_core_resource_loan*p,uint32_t kind,ynx_native_core_message3_effect_v1*out){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,sizeof(*out));
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_driver_fence_enter(q,0);if(!s)s=core_m3_effect_facts_inner(q,kind,out);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;if(s)return s;return q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_message3_enter(
 ynx_native_core_resource_loan*p,void*holder,uint32_t kind){
 if(!holder||!core_m3_kind_name(kind))return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 core_message3_state*m=&d->m3[kind-1];if(m->entered||m->holder){q->active=0;return VEIL_STORE_DUPLICATE;}
 s=core_driver_fence_enter(q,0);
 if(!s&&kind>1&&d->m3[kind-2].holder!=holder)s=VEIL_STORE_MISMATCH;
 if(!s){s=(veil_store_status)ynx_sdk_native_message3_retain_v1(holder,q->policy);
  if(!s){m->holder=holder;m->borrowed=1;}}
 ynx_native_core_message3_snapshot_v1 snap={0};
 if(!s)s=core_m3_snapshot(q,holder,kind,&snap);
 if(!s)s=core_m3_capture(m,&snap);
 if(!s){for(unsigned i=0;i<2;i++)if(snap.classic[i].size||snap.pq[i].size){
   /* Existing public output without this attempt's durable once bit is not
    * a fresh signable attempt. Keep actual Native custody, never adopt a bit. */
   m->observation_pending=1;s=VEIL_STORE_UNKNOWN;break;}
  if(snap.receipt.size){m->observation_pending=1;s=VEIL_STORE_UNKNOWN;}}
 if(!s){m->entered=1;s=core_m3_persist(q,kind,0,1,(ynx_original_bytes){0},1);}
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;
 if(s&&m->holder)return core_m3_fail(q,m,s);return s;
}
veil_store_status ynx_native_core_resource_driver_message3_key_enter(
 ynx_native_core_resource_loan*p,void*holder,uint32_t kind,uint32_t role,uint32_t pq){
 if(!holder||!core_m3_kind_name(kind)||role>=(kind==2?1u:2u)||pq>1)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 core_message3_state*m=&d->m3[kind-1];unsigned bit=1u<<(2*role+pq);
 if(!m->entered||m->holder!=holder||m->unknown||m->retire_entered||m->mask&bit){q->active=0;return VEIL_STORE_UNKNOWN;}
 s=core_driver_fence_enter(q,0);ynx_native_core_message3_snapshot_v1 snap={0};
 if(!s)s=core_m3_snapshot(q,holder,kind,&snap);
 if(!s&&!core_m3_same(m,&snap))s=VEIL_STORE_MISMATCH;
 if(!s&&m->parts_size){s=core_m3_parts_match(q,kind,&snap);
  if(s)m->observation_pending=1;}
 if(!s&&(pq?snap.pq[role].size:snap.classic[role].size)){
  m->observation_pending=1;s=VEIL_STORE_UNKNOWN;}
 if(!s&&pq&&(!(m->mask&(1u<<(2*role)))||snap.classic[role].size!=64))s=VEIL_STORE_MISMATCH;
 if(!s){m->mask|=bit;s=core_m3_persist(q,kind,m->mask,1,(ynx_original_bytes){0},0);}
 if(!s){m->observation_pending=1;d->m3_key_kind=kind;d->m3_key_role=role;d->m3_key_pq=pq;return VEIL_STORE_OK;}
 if(d->held)core_driver_fence_leave(q);q->active=0;return core_m3_fail(q,m,s);
}
veil_store_status ynx_native_core_resource_driver_message3_key_leave(
 ynx_native_core_resource_loan*p,void*holder,uint32_t kind,veil_store_status actual){
 ynx_native_core_resource_loan*q=core_resource_recognized(p);
 if(!q)return VEIL_STORE_REQUIRED;if(!pthread_equal(q->thread,pthread_self()))return VEIL_STORE_THREAD;
 core_domain_driver*d=q->driver;
 if(!d||!q->active||!d->held||d->m3_key_kind!=kind||kind<1||kind>3||
  d->m3[kind-1].holder!=holder)return core_resource_fail(q,VEIL_STORE_LIFETIME);
 core_message3_state*m=&d->m3[kind-1];veil_store_status s=actual,sdk=VEIL_STORE_OK;
 if(actual&&!q->first)q->first=actual;
 ynx_native_core_message3_snapshot_v1 snap={0};
 /* Observe/preserve public output even on original signer refusal or expired
  * current. The non-OK Native status is NEVER converted into permission. */
 veil_store_status observation=core_m3_partial_snapshot(q,holder,kind,&snap,&sdk);
 if(!s&&sdk)s=sdk;if(s&&!q->first)q->first=s;
 if(!observation)observation=core_m3_parts_adopt(m,&snap,q->first?q->first:s);
 if(!observation)observation=core_m3_parts_persist(q,kind);
 if(!s&&observation)s=observation;
 if(!s&&(d->m3_key_pq?snap.pq[d->m3_key_role].size!=4627:snap.classic[d->m3_key_role].size!=64))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_driver_policy(q);
 d->m3_key_kind=0;veil_store_status z=core_driver_fence_leave(q);q->active=0;
 if(!s&&z)s=z;if(s)return core_m3_fail(q,m,s);return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_message3_retire(
 ynx_native_core_resource_loan*p,void*holder,uint32_t kind,unsigned char*out,size_t cap,size_t*written){
 if(!out||!written||!cap||cap>65536||!core_m3_kind_name(kind))return VEIL_STORE_BOUND;*written=0;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 core_message3_state*m=&d->m3[kind-1];
 if(m->holder!=holder||m->unknown||m->retire_entered||m->mask!=(kind==2?3u:15u)){q->active=0;return VEIL_STORE_UNKNOWN;}
 s=core_driver_fence_enter(q,0);ynx_native_core_message3_snapshot_v1 snap={0};
 if(!s)s=core_m3_snapshot(q,holder,kind,&snap);
 if(!s&&!core_m3_same(m,&snap))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_m3_parts_match(q,kind,&snap);
 unsigned char expected[4096];size_t n=0;
 if(!s)s=core_m3_receipt(&snap,expected,sizeof(expected),&n);
 if(!s&&(!snap.receipt.data||snap.receipt.size!=n||CRYPTO_memcmp(snap.receipt.data,expected,n)))s=VEIL_STORE_MISMATCH;
 if(!s){m->retire_entered=1;s=core_m3_persist(q,kind,m->mask,2,(ynx_original_bytes){expected,n},0);}
 if(!s)s=core_m3_read_receipt(q,kind,out,cap,written);
 if(!s&&(*written!=n||CRYPTO_memcmp(out,expected,n)))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_m3_snapshot(q,holder,kind,&snap);
 if(!s&&!core_m3_same(m,&snap))s=VEIL_STORE_MISMATCH;
 if(!s)s=core_driver_policy(q);
 if(!s&&kind==3)s=core_m3_terminal_domains(q);
 if(!s){m->retired=1;if(kind==3)d->terminal_committed=1;}
 OPENSSL_cleanse(expected,sizeof(expected));
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}q->active=0;
 if(s&&m->entered)return core_m3_fail(q,m,s);return s;
}


/* Final transition is reachable ONLY after the same Native holder returned a
 * verified complete five-role chain and actual two-domain receipt readback. */
veil_store_status ynx_native_core_resource_driver_message3_parts_query(
 ynx_native_core_resource_loan*p,uint32_t kind,uint32_t domain,
 unsigned char*out,size_t cap,size_t*written){
 if(written)*written=0;if(!out||!written||!core_m3_kind_name(kind)||domain>1)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;if(!d){q->active=0;return VEIL_STORE_REQUIRED;}
 s=core_driver_fence_enter(q,1);
 if(!s)s=core_m3_parts_read_domain(q,kind,domain,out,cap,written);
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;return s?s:q->unknown?VEIL_STORE_UNKNOWN:VEIL_STORE_OK;
}
static veil_store_status core_m3_terminal_domains(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d->held||!d->checkpoint_committed||!d->m3[0].retired||!d->m3[1].retired)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_driver_policy(q);if(s)return s;
 for(unsigned k=0;!s&&k<3;k++)s=core_counter_current(q,k);
 for(unsigned i=0;!s&&i<2;i++){
  ynx_domain_state next=d->state[i];
  if(next.phase!=4||next.sequence==UINT64_MAX||next.floor!=q->row->domain_floor[i].expected_counter+1){s=VEIL_STORE_MISMATCH;break;}
  next.phase=6;next.sequence++;
  if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor))s=VEIL_STORE_UNKNOWN;
  if(!s)s=core_driver_domain_cas(q,i,&next);OPENSSL_cleanse(&next,sizeof(next));
 }
 return s;
}
static veil_store_status core_m3_qualified_current_inner(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;
 if(!d||!d->held||!d->terminal_committed||!d->checkpoint_committed)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_driver_policy(q);
 for(unsigned k=0;!s&&k<3;k++){
  core_message3_state*m=&d->m3[k];
  if(!m->retired||m->unknown||!m->holder){s=VEIL_STORE_REQUIRED;break;}
  s=core_counter_current(q,k);if(s)break;
  ynx_native_core_message3_snapshot_v1 snap={0};s=core_m3_snapshot(q,m->holder,k+1,&snap);
  if(!s&&!core_m3_same(m,&snap))s=VEIL_STORE_MISMATCH;
  if(!s)s=core_m3_parts_match(q,k+1,&snap);
  unsigned char expected[4096];size_t n=0;
  if(!s)s=core_m3_receipt(&snap,expected,sizeof(expected),&n);
  size_t got=0;
  if(!s)s=core_m3_read_receipt(q,k+1,m->readback,sizeof(m->readback),&got);
  if(!s&&(n!=got||CRYPTO_memcmp(expected,m->readback,n)))s=VEIL_STORE_MISMATCH;
  if(!s)m->readback_size=got;
  OPENSSL_cleanse(expected,sizeof(expected));
 }
 for(unsigned i=0;!s&&i<2;i++){
  ynx_domain_state actual={0};unsigned char raw[YNX_DOMAIN_STATE_BYTES];
  s=core_driver_domain_read(q,i,raw,&actual);
  if(!s&&(actual.phase!=6||actual.floor!=q->row->domain_floor[i].expected_counter+1||
   CRYPTO_memcmp(raw,d->originals[i],sizeof(raw))))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(raw,sizeof(raw));OPENSSL_cleanse(&actual,sizeof(actual));
 }
 if(!s)s=core_driver_policy(q);return s;
}
veil_store_status ynx_native_core_resource_driver_qualified_current(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_driver_fence_enter(q,0);if(!s)s=core_m3_qualified_current_inner(q);
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}q->active=0;
 if(s&&s!=VEIL_STORE_REQUIRED)return core_resource_fail(q,s);return s;
}
veil_store_status ynx_native_core_resource_driver_qualified_projection(ynx_native_core_resource_loan*p,
 ynx_native_core_qualified_projection_v1*out){
 if(!out)return VEIL_STORE_BOUND;memset(out,0,sizeof(*out));
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 s=core_driver_fence_enter(q,0);if(!s)s=core_m3_qualified_current_inner(q);
 if(!s){
  core_domain_driver*d=q->driver;out->version=1;out->size=sizeof(*out);
  out->original_binding=d->binding; /* original authorized floor/head NOT edited */
  for(unsigned i=0;i<2;i++){out->committed_floor[i]=d->state[i].floor;memcpy(out->committed_head[i],d->state[i].head,32);}
  for(unsigned k=0;k<3;k++)out->receipts[k]=(ynx_original_bytes){d->m3[k].readback,d->m3[k].readback_size};
 }
 if(q->driver&&q->driver->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;if(s){memset(out,0,sizeof(*out));if(s!=VEIL_STORE_REQUIRED)return core_resource_fail(q,s);}return s;
}

#include "ynx_native_core_checkpoint_original.inc"
