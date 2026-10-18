#include "veil_classic_protection.h"
#include <sodium.h>
#include <string.h>
static const uint8_t classic_domain[]="YNX/SOCIAL/OWN-CLASSIC-STORAGE/V1";
static void b32(uint8_t *p,uint32_t n){p[0]=n>>24;p[1]=n>>16;p[2]=n>>8;p[3]=n;}
veil_own_result veil_classic_aad(const veil_own_binding *b,const uint8_t pk[2592],size_t length,uint8_t out[VEIL_OWN_AAD_MAX],size_t *written){
 if(written)*written=0;
 if(!out||!written||length<1||length>256)return VEIL_OWN_INVALID;
 uint8_t pq[VEIL_OWN_AAD_MAX];size_t pn=0;veil_own_result v=veil_own_aad(b,pk,pq,&pn);if(v!=VEIL_OWN_OK)return v;
 size_t head=sizeof("YNX/SOCIAL/OWN-PQ-STORAGE/V1")-1,cn=sizeof(classic_domain)-1;
 size_t total=cn+pn-head+4;if(total>VEIL_OWN_AAD_MAX){sodium_memzero(pq,sizeof(pq));return VEIL_OWN_INVALID;}
 memcpy(out,classic_domain,cn);memcpy(out+cn,pq+head,pn-head);b32(out+cn+4,1); /* selected classic storage profile, not a new curve/wire. */
 b32(out+total-4,(uint32_t)length);sodium_memzero(pq,sizeof(pq));*written=total;return VEIL_OWN_OK;
}
veil_own_result veil_classic_seal_native(const veil_own_binding *b,const uint8_t pk[2592],const uint8_t *clear,size_t n,const veil_classic_protector *p,veil_classic_record *r){
 if(!r||!clear||!p||!p->seal)return VEIL_OWN_INVALID;
 memset(r,0,sizeof(*r));size_t a=0;veil_own_result v=veil_classic_aad(b,pk,n,r->aad,&a);
 if(v!=VEIL_OWN_OK)return v;
 size_t written=0;v=p->seal(p->context,r->aad,a,clear,n,r->nonce,r->ciphertext,n+16,&written);
 if(v!=VEIL_OWN_OK||written!=n+16){sodium_memzero(r,sizeof(*r));return v==VEIL_OWN_OK?VEIL_OWN_UNKNOWN:v;}
 r->version=1;r->aad_size=(uint32_t)a;r->ciphertext_size=(uint32_t)written;return VEIL_OWN_OK;
}
veil_own_result veil_classic_unseal_native(const veil_own_binding *b,const uint8_t pk[2592],const veil_classic_record *r,const veil_classic_protector *p,uint8_t *clear,size_t cap,size_t *written){
 if(written)*written=0;
 if(!clear||cap<1||cap>256)return VEIL_OWN_INVALID;
 sodium_memzero(clear,cap);
 if(!written||!r||!p||!p->unseal||r->version!=1||r->aad_size>VEIL_OWN_AAD_MAX||r->ciphertext_size<17||r->ciphertext_size>272)return VEIL_OWN_INVALID;
 size_t n=r->ciphertext_size-16;if(cap!=n)return VEIL_OWN_INVALID;
 uint8_t aad[VEIL_OWN_AAD_MAX];size_t a=0;veil_own_result v=veil_classic_aad(b,pk,n,aad,&a);
 if(v!=VEIL_OWN_OK||a!=r->aad_size||sodium_memcmp(aad,r->aad,a)!=0){sodium_memzero(aad,sizeof(aad));return VEIL_OWN_INVALID;}sodium_memzero(aad,sizeof(aad));
 size_t actual=0;v=p->unseal(p->context,r->aad,r->aad_size,r->nonce,r->ciphertext,r->ciphertext_size,clear,cap,&actual);
 if(v!=VEIL_OWN_OK||actual!=n){sodium_memzero(clear,cap);return v==VEIL_OWN_OK?VEIL_OWN_UNKNOWN:v;}*written=n;return VEIL_OWN_OK;
}
