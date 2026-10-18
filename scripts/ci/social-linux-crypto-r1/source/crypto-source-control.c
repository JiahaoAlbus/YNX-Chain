#include "veil_pq_auth.h"
#include <oqs/oqs.h>
#include <sodium.h>
#include "sign.h"
#include <stdio.h>
#include <string.h>
#define REQUIRE(x) do { if (!(x)) { fprintf(stderr,"control failed line %d\n",__LINE__); return 1; } } while (0)
int main(void) {
 REQUIRE(sodium_init() >= 0);
 veil_pq_key *key=veil_pq_key_generate(); REQUIRE(key != NULL);
 unsigned char pk[2592], sig[4627]; size_t n=0;
 unsigned char message[]="YNX Linux source-bound QA proof";
 REQUIRE(veil_pq_public(key,pk,sizeof(pk)) == 1);
 REQUIRE(veil_pq_sign(key,message,sizeof(message)-1,sig,sizeof(sig),&n) == 1 && n == sizeof(sig));
 REQUIRE(veil_pq_verify(pk,sizeof(pk),message,sizeof(message)-1,sig,n) == 1);
 message[0]^=1; REQUIRE(veil_pq_verify(pk,sizeof(pk),message,sizeof(message)-1,sig,n) == 0); message[0]^=1;
 sig[0]^=1; REQUIRE(veil_pq_verify(pk,sizeof(pk),message,sizeof(message)-1,sig,n) == 0); sig[0]^=1;
 OQS_SIG *a=OQS_SIG_new(OQS_SIG_alg_ml_dsa_87); REQUIRE(a != NULL);
 REQUIRE(a->length_public_key==2592 && a->length_secret_key==4896 && a->length_signature==4627 && a->sig_with_ctx_support);
 REQUIRE(OQS_SIG_verify_with_ctx_str(a,message,sizeof(message)-1,sig,n,(const unsigned char *)"YNX/SOCIAL/PQ-AUTH/V1",22,pk) != OQS_SUCCESS);
 unsigned char *secret=sodium_malloc(4896); REQUIRE(secret != NULL); REQUIRE(sodium_mlock(secret,4896)==0);
 unsigned char original[2592], restored[2592];
 REQUIRE(OQS_SIG_keypair(a,original,secret)==OQS_SUCCESS);
 REQUIRE(mld_sign_pk_from_sk(restored,secret,NULL)==0);
 REQUIRE(sodium_memcmp(original,restored,sizeof(original))==0);
 REQUIRE(veil_pq_verify(original,sizeof(original),message,sizeof(message)-1,sig,n)==0);
 sodium_free(secret); OQS_SIG_free(a); veil_pq_key_destroy(key);
 sodium_memzero(pk,sizeof(pk)); sodium_memzero(sig,sizeof(sig)); sodium_memzero(original,sizeof(original)); sodium_memzero(restored,sizeof(restored));
 puts("PASS real ML-DSA-87 proof/context/rejection/selected-pk-from-sk; not device authorization"); return 0;
}
