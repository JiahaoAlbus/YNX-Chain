#include "ynx_native_product_record_limits.h"
/* Same registered-store/domain owner. Schema is provisioned by legitimate
 * original enrollment, NEVER synthesized by a product begin:
 * core_product_index(name BLOB PRIMARY KEY,record_class INTEGER NOT NULL).
 * YNXDOM2 authenticates the complete product map root at original bytes288..319.
 * A v1/zero root is NOT an empty-map proof and cannot bootstrap itself here. */
static void product_sql_catalog_u32(unsigned char*p,uint32_t v){for(unsigned i=0;i<4;i++)p[3-i]=(unsigned char)(v>>(8*i));}
static int core_product_nonzero(const unsigned char*p,size_t n){unsigned char v=0;for(size_t i=0;i<n;i++)v|=p[i];return v!=0;}
static veil_store_status core_product_catalog_measure(ynx_native_core_resource_loan*q,unsigned char out[32]){
 core_domain_driver*d=q->driver;if(!d||!d->held||!out)return VEIL_STORE_LIFETIME;
 veil_store_status s=core_store_open(q);if(s)return s;unsigned char store[32];s=core_store_reference_make(q,store);if(s)return s;
 EVP_MD_CTX*hash=EVP_MD_CTX_new();if(!hash)return VEIL_STORE_SQL;
 static const unsigned char domain[]="YNX/PRODUCT/REGISTERED-CATALOG/V1";
 unsigned char gen[8];core_store_u64(gen,d->binding.storage_generation);
 if(EVP_DigestInit_ex(hash,EVP_sha256(),NULL)!=1||EVP_DigestUpdate(hash,domain,sizeof(domain))!=1||EVP_DigestUpdate(hash,store,32)!=1||EVP_DigestUpdate(hash,gen,8)!=1)s=VEIL_STORE_UNKNOWN;
 sqlite3_stmt*st=NULL;
 if(!s&&sqlite3_prepare_v2(d->store,"SELECT i.name,i.record_class,r.version,r.ciphertext FROM core_product_index AS i LEFT JOIN core_record AS r ON r.name=i.name ORDER BY i.name",-1,&st,NULL)!=SQLITE_OK)s=VEIL_STORE_SQL;
 size_t count=0,total=0;unsigned char previous[32]={0};
 while(!s){int step=sqlite3_step(st);if(step==SQLITE_DONE)break;if(step!=SQLITE_ROW){s=VEIL_STORE_SQL;break;}
  const unsigned char*name=sqlite3_column_blob(st,0),*cipher=sqlite3_column_blob(st,3);int namesize=sqlite3_column_bytes(st,0),n=sqlite3_column_bytes(st,3);
  sqlite3_int64 kind=sqlite3_column_int64(st,1),version=sqlite3_column_int64(st,2);
  if(sqlite3_column_type(st,0)!=SQLITE_BLOB||namesize!=32||!name||
   sqlite3_column_type(st,1)!=SQLITE_INTEGER||(kind!=1&&kind!=2)||sqlite3_column_type(st,2)!=SQLITE_INTEGER||version<=0||
   sqlite3_column_type(st,3)!=SQLITE_BLOB||!cipher||n<352||(size_t)n>YNX_PRODUCT_ROW_CIPHER_MAX||count>=8192||(count&&memcmp(previous,name,32)>=0)||
   total>YNX_PRODUCT_CATALOG_CIPHER_MAX-(size_t)n){s=VEIL_STORE_MISMATCH;break;}
  /* Headers are authenticated only by the independently protected full map;
   * matching public header fields alone never authorizes decryption/current. */
  if(memcmp(cipher,"YNXPRD1\0",8)||core_engine_u32(cipher+8)!=1||core_engine_u32(cipher+12)!=320||
   core_engine_u32(cipher+16)!=(uint32_t)n-336||core_engine_u32(cipher+20)!=(uint32_t)kind||
   core_engine_u64(cipher+32)!=d->binding.storage_generation||core_engine_u64(cipher+48)!=(uint64_t)version||
   CRYPTO_memcmp(cipher+72,store,32)||CRYPTO_memcmp(cipher+200,name,32)){s=VEIL_STORE_MISMATCH;break;}
  unsigned char row[76];memcpy(row,name,32);product_sql_catalog_u32(row+32,(uint32_t)kind);core_store_u64(row+36,(uint64_t)version);
  if(!SHA256(cipher,(size_t)n,row+44)||EVP_DigestUpdate(hash,row,sizeof(row))!=1){s=VEIL_STORE_UNKNOWN;break;}
  memcpy(previous,name,32);count++;total+=(size_t)n;
  if((count&31)==0)s=core_driver_policy(q);
 }
 if(st&&sqlite3_finalize(st)!=SQLITE_OK&&!s)s=VEIL_STORE_SQL;
 unsigned char digest[32],trailer[8];unsigned got=0;core_store_u64(trailer,count);
 if(!s&&(EVP_DigestUpdate(hash,trailer,sizeof(trailer))!=1||EVP_DigestFinal_ex(hash,digest,&got)!=1||got!=32))s=VEIL_STORE_UNKNOWN;
 EVP_MD_CTX_free(hash);if(!s)s=core_driver_policy(q);if(!s)memcpy(out,digest,32);OPENSSL_cleanse(digest,sizeof(digest));return s;
}
static veil_store_status core_product_catalog_current(ynx_native_core_resource_loan*q){
 core_domain_driver*d=q->driver;if(!d||!d->held)return VEIL_STORE_LIFETIME;
 if(!core_product_nonzero(d->state[0].product_catalog,32)||!core_product_nonzero(d->state[1].product_catalog,32))return VEIL_STORE_REQUIRED;
 if(CRYPTO_memcmp(d->state[0].product_catalog,d->state[1].product_catalog,32))return VEIL_STORE_UNKNOWN;
 for(unsigned i=0;i<2;i++){unsigned char raw[YNX_DOMAIN_STATE_BYTES];ynx_domain_state actual={0};
  veil_store_status s=core_driver_domain_read(q,i,raw,&actual);
  if(!s&&CRYPTO_memcmp(raw,d->originals[i],sizeof(raw)))s=VEIL_STORE_MISMATCH;
  OPENSSL_cleanse(raw,sizeof(raw));OPENSSL_cleanse(&actual,sizeof(actual));if(s)return s;
 }
 unsigned char measured[32];veil_store_status s=core_product_catalog_measure(q,measured);
 if(!s&&CRYPTO_memcmp(measured,d->state[0].product_catalog,32))s=VEIL_STORE_MISMATCH;
 OPENSSL_cleanse(measured,sizeof(measured));return s;
}
