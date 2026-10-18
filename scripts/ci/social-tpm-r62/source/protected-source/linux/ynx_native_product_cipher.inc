/* Included by the ORIGINAL qualified storage serializer TU. Key remains in
 * actual owner for normal callers. Public key fixtures test only this codec. */
#include "ynx_native_product_cipher_private.h"
#define PRODUCT_CIPHER_HEADER 320u
#define PRODUCT_PLAINTEXT_MAX YNX_PRODUCT_ROW_PLAIN_MAX
static veil_store_status product_cipher_header(const ynx_product_cipher_expected_v1*e,size_t n,unsigned char out[320]){
 if(!e||e->version!=1||e->reserved||(e->namespace_id!=1&&e->namespace_id!=2)||e->tombstone>1||
  (e->tombstone&&e->namespace_id!=1)||!e->storage_generation||e->storage_generation>UINT32_MAX||
  !e->policy_generation||!e->deadline||e->base_version>=INT64_MAX||e->next_version!=e->base_version+1||
  n<16||n>PRODUCT_PLAINTEXT_MAX||get32(e->storage_nonce)!=(uint32_t)e->storage_generation)return VEIL_STORE_BOUND;
 if(!e->base_version){unsigned char empty[32];if(!SHA256((const unsigned char*)"",0,empty)||CRYPTO_memcmp(empty,e->previous_cipher_digest,32))return VEIL_STORE_MISMATCH;}
 memset(out,0,320);memcpy(out,"YNXPRD1",7);put32(out+8,1);put32(out+12,320);put32(out+16,(uint32_t)n);
 put32(out+20,e->namespace_id);put32(out+24,e->tombstone);put64(out+32,e->storage_generation);
 put64(out+40,e->base_version);put64(out+48,e->next_version);put64(out+56,e->policy_generation);put64(out+64,e->deadline);
 memcpy(out+72,e->store_reference,32);memcpy(out+104,e->device_binding_digest,32);memcpy(out+136,e->intent,32);
 memcpy(out+168,e->policy_head,32);memcpy(out+200,e->selector,32);memcpy(out+232,e->previous_cipher_digest,32);
 memcpy(out+264,e->plaintext_digest,32);memcpy(out+296,e->storage_nonce,12);return VEIL_STORE_OK;
}
veil_store_status ynx_product_cipher_seal_v1(const unsigned char key[32],const ynx_product_cipher_expected_v1*e,
 ynx_original_bytes plain,ynx_storage_ciphertext*out){
 if(!key||!out||out->bytes||out->size||!plain.data)return VEIL_STORE_BOUND;
 unsigned char aad[320],digest[32];veil_store_status s=product_cipher_header(e,plain.size,aad);if(s)return s;
 if(!SHA256(plain.data,plain.size,digest)||CRYPTO_memcmp(digest,e->plaintext_digest,32))return VEIL_STORE_MISMATCH;
 size_t total=320+plain.size+16;unsigned char*blob=malloc(total);if(!blob)return VEIL_STORE_SQL;memcpy(blob,aad,320);
 EVP_CIPHER_CTX*ctx=EVP_CIPHER_CTX_new();int n=0,written=0,tail=0;
 int ok=ctx&&EVP_EncryptInit_ex(ctx,EVP_aes_256_gcm(),NULL,NULL,NULL)==1&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_IVLEN,12,NULL)==1&&
  EVP_EncryptInit_ex(ctx,NULL,NULL,key,e->storage_nonce)==1&&EVP_EncryptUpdate(ctx,NULL,&n,aad,320)==1&&
  EVP_EncryptUpdate(ctx,blob+320,&written,plain.data,(int)plain.size)==1&&EVP_EncryptFinal_ex(ctx,blob+320+written,&tail)==1&&
  (size_t)(written+tail)==plain.size&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_GET_TAG,16,blob+320+plain.size)==1;
 EVP_CIPHER_CTX_free(ctx);if(!ok){OPENSSL_cleanse(blob,total);free(blob);return VEIL_STORE_UNKNOWN;}
 out->bytes=blob;out->size=total;return VEIL_STORE_OK;
}
veil_store_status ynx_product_cipher_open_v1(const unsigned char key[32],const ynx_product_cipher_expected_v1*e,
 ynx_original_bytes blob,unsigned char*sink,size_t cap,size_t*written){
 if(written)*written=0;
 if(!key||!e||!sink||!written||cap>PRODUCT_PLAINTEXT_MAX)return VEIL_STORE_BOUND;
 veil_store_status s=VEIL_STORE_BOUND;if(!blob.data||blob.size<352||blob.size>320+PRODUCT_PLAINTEXT_MAX+16)goto reject;
 size_t size=get32(blob.data+16);unsigned char aad[320];s=product_cipher_header(e,size,aad);
 if(s)goto reject;
 if(size>cap||blob.size!=320+size+16||CRYPTO_memcmp(aad,blob.data,320)){s=VEIL_STORE_MISMATCH;
 goto reject;
 }
 EVP_CIPHER_CTX*ctx=EVP_CIPHER_CTX_new();int n=0,got=0,tail=0;
 int ok=ctx&&EVP_DecryptInit_ex(ctx,EVP_aes_256_gcm(),NULL,NULL,NULL)==1&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_IVLEN,12,NULL)==1&&
  EVP_DecryptInit_ex(ctx,NULL,NULL,key,e->storage_nonce)==1&&EVP_DecryptUpdate(ctx,NULL,&n,blob.data,320)==1&&
  EVP_DecryptUpdate(ctx,sink,&got,blob.data+320,(int)size)==1&&EVP_CIPHER_CTX_ctrl(ctx,EVP_CTRL_GCM_SET_TAG,16,(void*)(blob.data+320+size))==1&&
  EVP_DecryptFinal_ex(ctx,sink+got,&tail)==1&&(size_t)(got+tail)==size;
 EVP_CIPHER_CTX_free(ctx);unsigned char digest[32];if(!ok||!SHA256(sink,size,digest)||CRYPTO_memcmp(digest,e->plaintext_digest,32)){s=VEIL_STORE_MISMATCH;goto reject;}
 *written=size;return VEIL_STORE_OK;
reject:OPENSSL_cleanse(sink,cap);return s;
}
