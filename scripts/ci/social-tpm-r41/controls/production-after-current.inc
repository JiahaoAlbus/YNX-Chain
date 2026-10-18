static veil_store_status state_current(const ynx_server_independent_state_borrow *p,ynx_original_bytes request,uint32_t role,uint64_t *counter){
 if(!counter)return VEIL_STORE_REQUIRED;
 *counter=0;if(!p)return VEIL_STORE_REQUIRED;
 ynx_server_independent_state_borrow *held=state_recognize(p);
 if(!held)return VEIL_STORE_REQUIRED;
 if(!pthread_equal(held->thread,pthread_self()))return VEIL_STORE_THREAD;
 if(held->unknown)return VEIL_STORE_UNKNOWN;
 /* This is already a retained original borrow. A first budget refusal is
  * just as final for THIS owner as a late platform refusal. Do not let clock
  * restoration renew it or publish its old numeric floor/counter. */
 struct timespec now;if(!held->deadline_ns||clock_gettime(CLOCK_MONOTONIC,&now))return state_uncertain(held,VEIL_STORE_LIFETIME);
 uint64_t ns=(uint64_t)now.tv_sec*1000000000u+(uint64_t)now.tv_nsec;if(ns>=held->deadline_ns)return state_uncertain(held,VEIL_STORE_LIFETIME);
 int32_t canonical=ynx_sdk_execution_original_validate_v1(request.data,request.size);if(canonical)return (veil_store_status)canonical;
 unsigned char digest[32];if(!request.data||!SHA256(request.data,request.size,digest)||held->role!=role||CRYPTO_memcmp(digest,held->request_digest,32))return VEIL_STORE_MISMATCH;
 /* This is an existing independent borrow, not an acquisition probe. Once
  * its original current fence refuses, later restoration of the underlying
  * observation must not make this same borrow green again. */
 veil_store_status st=ynx_platform_current(held->original,0);if(st)return state_uncertain(held,st);
 /* The same original resource may outlive its budget while current executes.
  * Do not publish a counter after the retained deadline; no window renewal. */
 if(clock_gettime(CLOCK_MONOTONIC,&now))return state_uncertain(held,VEIL_STORE_LIFETIME);
 ns=(uint64_t)now.tv_sec*1000000000u+(uint64_t)now.tv_nsec;
 if(ns>=held->deadline_ns)return state_uncertain(held,VEIL_STORE_LIFETIME);
 *counter=held->counter;return VEIL_STORE_OK;
}
