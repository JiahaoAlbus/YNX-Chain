/* Runs the real selected production function verbatim. PUBLIC clock/platform
 * seams only: no actual Source registration, independent owner or TPM grant. */
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <pthread.h>
#include <time.h>
typedef int veil_store_status;
enum{VEIL_STORE_OK=0,VEIL_STORE_REQUIRED=1,VEIL_STORE_THREAD=2,VEIL_STORE_UNKNOWN=3,VEIL_STORE_LIFETIME=4,VEIL_STORE_MISMATCH=5};
typedef struct {const unsigned char*data;size_t size;}ynx_original_bytes;
typedef struct ynx_server_independent_state_borrow{pthread_t thread;uint32_t role;unsigned char request_digest[32];uint64_t counter,deadline_ns;veil_store_status first;int unknown;void*original;}ynx_server_independent_state_borrow;
static ynx_server_independent_state_borrow original,foreign;
static uint64_t now_ns;static int clock_bad,platform_calls,platform_status;
static int test_clock_gettime(clockid_t id,struct timespec*out){(void)id;if(clock_bad)return -1;out->tv_sec=(time_t)(now_ns/1000000000u);out->tv_nsec=(long)(now_ns%1000000000u);return 0;}
static int32_t ynx_sdk_execution_original_validate_v1(const unsigned char*p,size_t n){return !p||n!=32?VEIL_STORE_MISMATCH:0;}
static unsigned char*test_SHA256(const unsigned char*p,size_t n,unsigned char*out){if(!p||n!=32)return NULL;memcpy(out,p,32);return out;}
static int test_CRYPTO_memcmp(const void*a,const void*b,size_t n){return memcmp(a,b,n);}
static ynx_server_independent_state_borrow*state_recognize(const ynx_server_independent_state_borrow*p){return p==&original?&original:NULL;}
static veil_store_status state_uncertain(ynx_server_independent_state_borrow*h,veil_store_status cause){if(!h->first)h->first=cause;h->unknown=1;return VEIL_STORE_UNKNOWN;}
static veil_store_status ynx_platform_current(void*p,int cleanup){(void)p;(void)cleanup;platform_calls++;return platform_status;}
#define clock_gettime test_clock_gettime
#define SHA256 test_SHA256
#define CRYPTO_memcmp test_CRYPTO_memcmp
#ifndef PRODUCTION_CURRENT
#define PRODUCTION_CURRENT "production-before-current.inc"
#endif
#include PRODUCTION_CURRENT
static void reset(void){memset(&original,0,sizeof(original));original.thread=pthread_self();original.role=1;original.counter=42;original.deadline_ns=1000;memset(original.request_digest,7,32);now_ns=900;clock_bad=platform_calls=platform_status=0;}
static int failed;
#define CHECK(x) do{if(!(x)){fprintf(stderr,"case=%s line=%d FAILED\n",label,__LINE__);failed++;}}while(0)
int main(void){
 unsigned char request[32];memset(request,7,32);ynx_original_bytes raw={request,32};uint64_t counter;const char*label;
 reset();label="first_expiry_is_sticky";counter=999;now_ns=1000;
 CHECK(state_current(&original,raw,1,&counter)==VEIL_STORE_UNKNOWN);CHECK(counter==0);CHECK(original.first==VEIL_STORE_LIFETIME);now_ns=900;
 CHECK(state_current(&original,raw,1,&counter)==VEIL_STORE_UNKNOWN);CHECK(counter==0);CHECK(platform_calls==0);
 reset();label="first_clock_failure_is_sticky";counter=999;clock_bad=1;
 CHECK(state_current(&original,raw,1,&counter)==VEIL_STORE_UNKNOWN);CHECK(counter==0);CHECK(original.first==VEIL_STORE_LIFETIME);clock_bad=0;
 CHECK(state_current(&original,raw,1,&counter)==VEIL_STORE_UNKNOWN);CHECK(counter==0);CHECK(platform_calls==0);
 reset();label="missing_original_has_no_counter_projection";counter=999;CHECK(state_current(NULL,raw,1,&counter)==VEIL_STORE_REQUIRED);CHECK(counter==0);
 reset();label="foreign_original_has_no_projection";counter=999;CHECK(state_current(&foreign,raw,1,&counter)==VEIL_STORE_REQUIRED);CHECK(counter==0);
 reset();label="same_valid_original_observation";counter=999;CHECK(state_current(&original,raw,1,&counter)==VEIL_STORE_OK);CHECK(counter==42);CHECK(platform_calls==1);CHECK(!original.first&&!original.unknown);
 printf("physical_original_budget_new_controls=5 failed_assertions=%d real_resource_or_grant=false\n",failed);return failed?1:0;
}
