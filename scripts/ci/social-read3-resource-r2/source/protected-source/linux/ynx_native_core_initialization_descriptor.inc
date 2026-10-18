#include <openssl/evp.h>
/* Included only in SAME real protected resource/store TU. No constructor from
 * SourceView, Accepted DTO, generic catalog Actor or public expected tuple. */
static veil_store_status core_initialization_descriptor_make(
 ynx_native_core_resource_loan*q,const ynx_core_initialization_record_v1*r,
 ynx_storage_initialization_aad_v1*out){
 if(!q||!q->driver||!q->participant||!r||!out)return VEIL_STORE_REQUIRED;
 core_domain_driver*d=q->driver;const ynx_native_core_participant_originals_v2*v=&q->participant->originals;
 static const unsigned char kind[]="first-device-bootstrap-v1";
 if(d->binding.purpose!=1||v->version!=2||v->purpose!=1||r->version!=1||r->purpose!=1||
  v->storage_generation!=d->binding.storage_generation||r->storage_generation!=v->storage_generation||
  CRYPTO_memcmp(v->intent_digest,d->binding.intent,32)||CRYPTO_memcmp(r->request_digest,d->binding.intent,32)||
  !r->kind.data||r->kind.size!=sizeof(kind)||memcmp(r->kind.data,kind,sizeof(kind))||
  !r->id.data||r->id.size!=65||r->id.data[64]||!r->plaintext.data||r->plaintext.size<152||r->plaintext.size>65536)return VEIL_STORE_MISMATCH;
 const unsigned char*p=r->plaintext.data;size_t left=r->plaintext.size;
 if(memcmp(p,"YNXFDI01",8)||p[8]||p[9]||p[10]||p[11]!=1||p[12]||p[13]||p[14]||p[15]!=7||
  core_initialization_be64(p+16)!=v->storage_generation||CRYPTO_memcmp(p+56,d->binding.intent,32))return VEIL_STORE_MISMATCH;
 ynx_original_bytes fields[7];const unsigned char*cursor=p+152;left-=152;
 for(unsigned i=0;i<7;i++){
  if(left<4)return VEIL_STORE_BOUND;
  uint32_t n=((uint32_t)cursor[0]<<24)|((uint32_t)cursor[1]<<16)|((uint32_t)cursor[2]<<8)|cursor[3];
  cursor+=4;
  left-=4;
  if(!n||n>left)return VEIL_STORE_BOUND;
  fields[i]=(ynx_original_bytes){cursor,n};
  cursor+=n;
  left-=n;
 }
 if(left)return VEIL_STORE_MISMATCH;
 for(unsigned i=0;i<3;i++){if(fields[i].size>512)return VEIL_STORE_BOUND;for(size_t j=0;j<fields[i].size;j++)if(fields[i].data[j]<33||fields[i].data[j]>126)return VEIL_STORE_MISMATCH;}
 if(fields[3].size>512||memchr(fields[3].data,0,fields[3].size))return VEIL_STORE_MISMATCH;
 if(fields[4].size!=47||fields[5].size<22||fields[5].size>19600||fields[6].size!=2657||fields[6].data[0]!=5||
  CRYPTO_memcmp(fields[6].data+2625,p+24,32)||memcmp(fields[5].data,"YNXOKJ01",8))return VEIL_STORE_MISMATCH;
 if(core_engine_u32(fields[5].data+8)!=1)return VEIL_STORE_MISMATCH;
 uint32_t pq=core_engine_u32(fields[5].data+12),classic=core_engine_u32(fields[5].data+16);
 if(!pq||!classic||pq>fields[5].size-20||classic!=fields[5].size-20-pq)return VEIL_STORE_MISMATCH;
 unsigned char encoded[45];int z=EVP_EncodeBlock(encoded,p+24,32);if(z!=44)return VEIL_STORE_UNKNOWN;
 for(unsigned i=0;i<43;i++){if(encoded[i]=='+')encoded[i]='-';else if(encoded[i]=='/')encoded[i]='_';}
 if(memcmp(fields[4].data,"fd1-",4)||memcmp(fields[4].data+4,encoded,43))return VEIL_STORE_MISMATCH;
 static const unsigned char domain[]="YNX/SOCIAL/FIRST-DEVICE-BOOTSTRAP-RECORD/V1";
 unsigned char selector[2048];size_t used=sizeof(domain);memcpy(selector,domain,sizeof(domain));
 for(unsigned i=0;i<3;i++){size_t n=fields[i].size;if(n>sizeof(selector)-used-4)return VEIL_STORE_BOUND;
  selector[used++]=(unsigned char)(n>>24);selector[used++]=(unsigned char)(n>>16);selector[used++]=(unsigned char)(n>>8);selector[used++]=(unsigned char)n;
  memcpy(selector+used,fields[i].data,n);used+=n;}
 ynx_storage_initialization_aad_v1 a={.version=1,.size=528,.generation=v->storage_generation,.base_version=0,.next_version=1};
 if(!SHA256(selector,used,a.selector_digest))return VEIL_STORE_UNKNOWN;
 static const char hex[]="0123456789abcdef";for(unsigned i=0;i<32;i++)if(r->id.data[2*i]!=(unsigned char)hex[a.selector_digest[i]>>4]||r->id.data[2*i+1]!=(unsigned char)hex[a.selector_digest[i]&15])return VEIL_STORE_MISMATCH;
 const ynx_original_bytes originals[3]={v->approval,v->origin[0],v->origin[4]};unsigned char*hashes[3]={a.approval_digest,a.root_digest,a.namespace_digest};
 for(unsigned i=0;i<3;i++){if(!originals[i].data||!originals[i].size||originals[i].size>1048576)return VEIL_STORE_BOUND;if(!SHA256(originals[i].data,originals[i].size,hashes[i]))return VEIL_STORE_UNKNOWN;}
 if(!SHA256(fields[6].data,2625,a.native_device_digest)||CRYPTO_memcmp(a.native_device_digest,d->binding.device,32))return VEIL_STORE_MISMATCH;
 unsigned char*labels[4]={a.account_digest,a.identity_digest,a.device_label_digest,a.alias_digest};
 for(unsigned i=0;i<4;i++)if(!SHA256(fields[i].data,fields[i].size,labels[i]))return VEIL_STORE_UNKNOWN;
 if(!SHA256(fields[4].data,fields[4].size,a.source_operation_digest)||!SHA256(p,r->plaintext.size,a.plaintext_digest))return VEIL_STORE_UNKNOWN;
 memcpy(a.request_digest,d->binding.intent,32);memcpy(a.operation_ids,p+24,32);memcpy(a.source_nonce,p+88,32);memcpy(a.account_nonce,p+120,32);
 veil_store_status s=core_driver_policy(q);if(s)return s;*out=a;return VEIL_STORE_OK;
}
/* Existing registered store, not absent-row permission or schema creation.
 * Initial create refuses ANY prior same-selector row; restore is a separate
 * read-only exact original path, never replacement/reseal under this entry. */
static veil_store_status core_initialization_record_absent(ynx_native_core_resource_loan*q,ynx_original_bytes name){
 core_domain_driver*d=q->driver;sqlite3_stmt*st=NULL;
 if(!d->held||!d->store||!sqlite3_get_autocommit(d->store))return VEIL_STORE_LIFETIME;
 if(sqlite3_prepare_v2(d->store,"SELECT version FROM core_record WHERE name=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_SQL;
 if(sqlite3_bind_blob(st,1,name.data,(int)name.size,SQLITE_STATIC)==SQLITE_OK){int rc=sqlite3_step(st);s=rc==SQLITE_DONE?VEIL_STORE_OK:rc==SQLITE_ROW?VEIL_STORE_DUPLICATE:VEIL_STORE_SQL;}
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 return s;
}

#include "ynx_native_core_initialization_journal_private.h"
/* Canonical single ordered record, same existing producer journal grammar.
 * Header and exact ciphertext are copied before any checked-store mutation.
 * No caller selects row0: this subtype's actual producer must have exactly ONE
 * sealed initialization record; messages still use the unmodified multistep path. */
static veil_store_status core_initialization_journal_capture(core_domain_driver*d){
 static const unsigned char kind[]="first-device-bootstrap-v1";
 if(!d||!d->sealed_initialization||!d->seal_entered||d->sealed_count!=1)return VEIL_STORE_REQUIRED;
 if(d->initialization_journal)return VEIL_STORE_DUPLICATE;
 const ynx_storage_ciphertext*r=&d->sealed_rows[0];
 if(!r->bytes||r->size<640||r->size>66176||d->initialization_name[64]||
  strlen(d->initialization_name)!=64)return VEIL_STORE_MISMATCH;
 const unsigned char*b=r->bytes;uint32_t plain=core_engine_u32(b+16);
 if(memcmp(b,"YNXREC1\0",8)||b[8]||b[9]!=2||b[10]||b[11]!=1||core_engine_u32(b+12)!=624||
  plain>65536||core_engine_u32(b+20)!=plain+16||r->size!=624+(size_t)plain+16||
  core_engine_u32(b+24)!=7||core_engine_u32(b+28)||
  CRYPTO_memcmp(b+560,d->initialization_name,64))return VEIL_STORE_MISMATCH;
 /* Recompute exact authenticated header from the same held AAD. */
 unsigned char header[688];size_t hs=0;
 ynx_storage_expected expected={.generation=d->initialization_aad.generation,.base_version=0,.next_version=1,
  .kind=7,.container_class=YNX_STORAGE_RECORD,.name={(const unsigned char*)d->initialization_name,64},
  .initialization=&d->initialization_aad};
 memcpy(expected.request,d->initialization_aad.request_digest,32);memcpy(expected.storage_nonce,d->initialization_aad.storage_nonce,12);
 /* Existing codec serialization is the sole header definition, not a duplicate
  * struct memcpy with platform endianness or a caller metadata comparison. */
 extern veil_store_status ynx_storage_initialization_header_exact_v1(const ynx_storage_expected*,size_t,unsigned char*,size_t,size_t*);
 veil_store_status s=ynx_storage_initialization_header_exact_v1(&expected,plain,header,sizeof(header),&hs);
 if(s)return s;
 if(hs!=624||CRYPTO_memcmp(header,b,624))return VEIL_STORE_MISMATCH;
 size_t total=12+16+(sizeof(kind)-1)+64+r->size;unsigned char*p=malloc(total);if(!p)return VEIL_STORE_SQL;
 memcpy(p,"YNXJRN1\0",8);p[8]=p[9]=p[10]=0;p[11]=1;
 uint32_t fields[4]={0,sizeof(kind)-1,64,(uint32_t)r->size};
 for(unsigned j=0;j<4;j++)for(unsigned k=0;k<4;k++)p[12+4*j+k]=(unsigned char)(fields[j]>>(24-8*k));
 size_t off=28;memcpy(p+off,kind,sizeof(kind)-1);off+=sizeof(kind)-1;memcpy(p+off,d->initialization_name,64);off+=64;
 memcpy(p+off,r->bytes,r->size);
 unsigned char journal[32],cipher[32];if(!SHA256(p,total,journal)||!SHA256(r->bytes,r->size,cipher)){free(p);return VEIL_STORE_SQL;}
 d->initialization_journal=p;d->initialization_journal_size=total;
 memcpy(d->initialization_journal_digest,journal,32);memcpy(d->initialization_cipher_digest,cipher,32);return VEIL_STORE_OK;
}
veil_store_status ynx_native_core_resource_driver_seal_initialization_v2(ynx_native_core_resource_loan*p){
 ynx_native_core_resource_loan*q=NULL;veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;ynx_core_initialization_record_v1 original={0};ynx_storage_initialization_aad_v1 a={0};
 if(!d||q->unknown||d->unknown||d->seal_entered||d->effect_entered){q->active=0;return VEIL_STORE_UNKNOWN;}
 s=(veil_store_status)ynx_sdk_native_core_initialization_record_borrow_v1(q->policy,&original);
 if(!s)s=core_initialization_descriptor_make(q,&original,&a);
 for(unsigned op=2;!s&&op<=6;op++)if(op!=3)s=(veil_store_status)ynx_sdk_native_core_gate_v2(q->policy,op);
 if(!s)s=core_driver_fence_enter(q,0);
 if(!s)s=core_store_open(q);
 if(!s)s=core_initialization_record_absent(q,(ynx_original_bytes){original.id.data,64});
 if(!s)s=core_store_allocator_ready(q);
 if(!s){memcpy(a.storage_nonce,d->nonce,12);a.storage_nonce[10]=0;a.storage_nonce[11]=0;
  s=(veil_store_status)ynx_sdk_native_core_initialization_aad_verify_v1(q->policy,&a);
  if(!s)s=core_driver_policy(q);
 }
 if(!s){d->initialization_aad=a;
  memcpy(d->initialization_name,original.id.data,65);
  ynx_storage_expected expected={.generation=a.generation,.base_version=0,.next_version=1,.kind=7,.container_class=YNX_STORAGE_RECORD,
   .name={(const unsigned char*)d->initialization_name,64},.initialization=&d->initialization_aad};
  memcpy(expected.request,a.request_digest,32);memcpy(expected.storage_nonce,a.storage_nonce,12);
  ynx_native_core_plain_cas row={.expected=&expected,.plaintext={original.plaintext.data,original.plaintext.size}};ynx_native_core_cipher_cas cas[32]={0};
  s=core_seal_rows(q,&row,1,1,cas);
  if(!s)s=core_initialization_journal_capture(d);
 }
 if(!s)s=core_driver_policy(q);
 if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 q->active=0;if(s&&(d->seal_entered||d->counter_entered[0])){d->unknown=1;return core_resource_fail(q,s);}return q->unknown?VEIL_STORE_UNKNOWN:s;
}
veil_store_status ynx_native_core_resource_driver_initialization_aad_query(
 ynx_native_core_resource_loan*p,ynx_storage_initialization_aad_v1*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);
 if(s)return s;
 core_domain_driver*d=q->driver;if(!d||!d->sealed_initialization||!d->seal_entered||!d->sealed_rows[0].bytes||d->initialization_aad.version!=1)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_policy(q);
 if(!s)*out=d->initialization_aad;
 q->active=0;
 return s;
}

veil_store_status ynx_native_core_resource_driver_initialization_journal_borrow_v1(
 ynx_native_core_resource_loan*p,ynx_native_core_initialization_journal_v1*out){
 if(!out)return VEIL_STORE_BOUND;
 ynx_native_core_resource_loan*q=NULL;
 veil_store_status s=core_driver_operation_enter(p,&q);if(s)return s;
 core_domain_driver*d=q->driver;
 if(!d||!d->initialization_journal||!d->initialization_journal_size||!d->sealed_initialization)s=VEIL_STORE_REQUIRED;
 if(!s)s=core_driver_policy(q);
 if(!s){ynx_native_core_initialization_journal_v1 v={.version=1,.native_kind=1,.journal_steps=1,.queue_count=0,
   .journal={d->initialization_journal,d->initialization_journal_size}};
  memcpy(v.journal_digest,d->initialization_journal_digest,32);memcpy(v.cipher_digest,d->initialization_cipher_digest,32);*out=v;
 }q->active=0;return s;
}
