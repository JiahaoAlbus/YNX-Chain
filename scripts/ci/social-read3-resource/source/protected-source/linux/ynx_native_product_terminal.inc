/* Original independent domain tables, provisioned at legitimate enrollment:
 * core_product_terminal(intent BLOB PRIMARY KEY,original BLOB).
 * Private data terminal, NOT Message3/signing output or a device grant. */
extern int32_t ynx_sdk_native_core_own_records_current_v1(void *);
static veil_store_status core_product_terminal_read_one(ynx_native_core_resource_loan*q,unsigned slot,unsigned char out[288]){
 core_domain_driver*d=q->driver;sqlite3_stmt*st=NULL;
 if(slot>1||!d->held||!d->keys)return VEIL_STORE_LIFETIME;
 if(sqlite3_prepare_v2(d->db[slot],"SELECT original FROM core_product_terminal WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK)return VEIL_STORE_SQL;
 veil_store_status s=VEIL_STORE_REQUIRED;
 if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK)s=VEIL_STORE_SQL;
 else{int step=sqlite3_step(st);if(step==SQLITE_ROW){
  const void*bytes=sqlite3_column_blob(st,0);int n=sqlite3_column_bytes(st,0);
  if(sqlite3_column_type(st,0)!=SQLITE_BLOB||n!=288||!bytes)s=VEIL_STORE_MISMATCH;
  else{unsigned char tag[32];unsigned got=0;
   if(!HMAC(EVP_sha256(),d->keys+32*slot,32,bytes,256,tag,&got)||got!=32)s=VEIL_STORE_UNKNOWN;
   else if(CRYPTO_memcmp(tag,(const unsigned char*)bytes+256,32))s=VEIL_STORE_MISMATCH;
   else{memcpy(out,bytes,288);s=sqlite3_step(st)==SQLITE_DONE?VEIL_STORE_OK:VEIL_STORE_MISMATCH;}
   OPENSSL_cleanse(tag,sizeof(tag));}
 }else if(step!=SQLITE_DONE)s=VEIL_STORE_SQL;}
 if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;return s;
}
static veil_store_status core_product_terminal_query(ynx_native_core_resource_loan*q,const unsigned char store_ref[32]){
 core_domain_driver*d=q->driver;if(!d||!d->held||!store_ref)return VEIL_STORE_LIFETIME;
 unsigned char originals[2][288];veil_store_status s=core_store_open(q);
 for(unsigned i=0;!s&&i<2;i++)s=core_product_terminal_read_one(q,i,originals[i]);
 const unsigned char*b=originals[0];
 if(!s&&(CRYPTO_memcmp(originals[0],originals[1],256)||memcmp(b,"YNXPRODUCTENDV1\0",16)||
  core_engine_u32(b+16)!=1||core_engine_u32(b+20)!=256||CRYPTO_memcmp(b+24,d->binding.intent,32)||
  CRYPTO_memcmp(b+56,store_ref,32)||core_engine_u64(b+184)!=d->binding.storage_generation||
  core_engine_u64(b+192)!=d->binding.deadline||core_engine_u32(b+232)!=1))s=VEIL_STORE_MISMATCH;
 for(size_t i=236;!s&&i<256;i++)if(b[i])s=VEIL_STORE_MISMATCH;
 for(unsigned i=0;!s&&i<2;i++){
  sqlite3_stmt*st=NULL;if(sqlite3_prepare_v2(d->db[i],"SELECT original FROM core_checkpoint WHERE intent=?1",-1,&st,NULL)!=SQLITE_OK){s=VEIL_STORE_SQL;break;}
  s=VEIL_STORE_MISMATCH;
  if(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)==SQLITE_OK&&sqlite3_step(st)==SQLITE_ROW){
   const unsigned char*p=sqlite3_column_blob(st,0);int n=sqlite3_column_bytes(st,0);unsigned char hash[32];
   if(sqlite3_column_type(st,0)==SQLITE_BLOB&&p&&n>128&&n<=16384&&!memcmp(p,"YNXCORECHECKPOINTV1",19)&&
    !CRYPTO_memcmp(p+24,d->binding.intent,32)&&core_engine_u64(p+56)==d->binding.storage_generation&&
    core_engine_u64(p+64)==d->binding.deadline&&!CRYPTO_memcmp(p+80,b+120,32)&&
    SHA256(p,(size_t)n,hash)&&!CRYPTO_memcmp(hash,b+152,32)&&sqlite3_step(st)==SQLITE_DONE)s=VEIL_STORE_OK;
   OPENSSL_cleanse(hash,sizeof(hash));}
  if(sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 }
 if(!s){unsigned char effect[65536],digest[32];size_t n=0;s=core_store_effect_read(q,effect,sizeof(effect),&n,9);
  if(!s&&(n<320||memcmp(effect,"YNXPRODUCTCASV1",15)||CRYPTO_memcmp(effect+24,d->binding.intent,32)||
    CRYPTO_memcmp(effect+80,store_ref,32)||CRYPTO_memcmp(effect+144,b+88,32)||
    !SHA256(effect,n,digest)||CRYPTO_memcmp(digest,b+120,32)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(effect,sizeof(effect));OPENSSL_cleanse(digest,sizeof(digest));}
 OPENSSL_cleanse(originals,sizeof(originals));return s;
}
static veil_store_status core_product_terminal_write(ynx_native_core_resource_loan*q,const unsigned char store_ref[32]){
 core_domain_driver*d=q->driver;if(!d||!d->local_committed||!d->checkpoint_committed||d->terminal_committed||
  !d->checkpoint_size||d->checkpoint_size>16384)return VEIL_STORE_REQUIRED;
 veil_store_status s=core_driver_fence_enter(q,0);if(s)return s;
 s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);
 if(!s)s=core_product_catalog_current(q);
 unsigned char body[256]={0};memcpy(body,"YNXPRODUCTENDV1",15);product_sql_catalog_u32(body+16,1);product_sql_catalog_u32(body+20,256);
 memcpy(body+24,d->binding.intent,32);memcpy(body+56,store_ref,32);memcpy(body+88,d->state[0].product_catalog,32);memcpy(body+120,d->effect_digest,32);
 if(!s&&!SHA256(d->checkpoint_original,d->checkpoint_size,body+152))s=VEIL_STORE_UNKNOWN;
 core_store_u64(body+184,d->binding.storage_generation);core_store_u64(body+192,d->binding.deadline);product_sql_catalog_u32(body+232,1);
 for(unsigned i=0;!s&&i<2;i++){
  if(!d->counter_observed[i+1]||d->state[i].phase!=4||d->state[i].sequence==UINT64_MAX||
   d->state[i].floor!=q->row->domain_floor[i].expected_counter+1){s=VEIL_STORE_MISMATCH;break;}
  s=core_counter_current(q,i+1);core_store_u64(body+200+8*i,d->state[i].floor);core_store_u64(body+216+8*i,d->state[i].sequence+1);
 }
 for(unsigned i=0;!s&&i<2;i++){
  s=(veil_store_status)ynx_sdk_native_core_own_records_current_v1(q->policy);if(s)break;
  ynx_domain_state next=d->state[i];next.phase=6;next.sequence++;
  if(!SHA256(d->originals[i],YNX_DOMAIN_STATE_BYTES,next.predecessor))s=VEIL_STORE_UNKNOWN;
  if(!s)s=core_driver_domain_cas(q,i,&next);OPENSSL_cleanse(&next,sizeof(next));if(s)break;
  unsigned char original[288];memcpy(original,body,256);unsigned got=0;
  if(!HMAC(EVP_sha256(),d->keys+32*i,32,body,256,original+256,&got)||got!=32){s=VEIL_STORE_UNKNOWN;break;}
  if(sqlite3_exec(d->db[i],"BEGIN IMMEDIATE",NULL,NULL,NULL)!=SQLITE_OK){s=VEIL_STORE_SQL;OPENSSL_cleanse(original,sizeof(original));break;}d->transaction[i]=1;
  sqlite3_stmt*st=NULL;if(sqlite3_prepare_v2(d->db[i],"INSERT INTO core_product_terminal(intent,original) VALUES(?1,?2)",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
  if(!s&&(sqlite3_bind_blob(st,1,d->binding.intent,32,SQLITE_STATIC)!=SQLITE_OK||sqlite3_bind_blob(st,2,original,288,SQLITE_STATIC)!=SQLITE_OK))s=VEIL_STORE_SQL;
  if(!s&&(sqlite3_step(st)!=SQLITE_DONE||sqlite3_changes(d->db[i])!=1))s=VEIL_STORE_MISMATCH;
  if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
  if(!s)s=core_driver_policy(q);
  if(!s&&(sqlite3_exec(d->db[i],"COMMIT",NULL,NULL,NULL)!=SQLITE_OK||!sqlite3_get_autocommit(d->db[i])))s=VEIL_STORE_UNKNOWN;
  if(!s)d->transaction[i]=0;
  unsigned char readback[288];if(!s)s=core_product_terminal_read_one(q,i,readback);
  if(!s&&CRYPTO_memcmp(original,readback,288))s=VEIL_STORE_MISMATCH;OPENSSL_cleanse(readback,sizeof(readback));OPENSSL_cleanse(original,sizeof(original));
 }
 if(!s)s=core_product_terminal_query(q,store_ref);if(!s)d->terminal_committed=1;
 OPENSSL_cleanse(body,sizeof(body));if(d->held){veil_store_status z=core_driver_fence_leave(q);if(!s)s=z;}
 if(s){d->unknown=1;return core_resource_fail(q,s);}return VEIL_STORE_OK;
}
