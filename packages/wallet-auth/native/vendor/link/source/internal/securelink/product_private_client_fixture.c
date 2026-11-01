//go:build securelink_product_pay_transport && securelink_product_pay_transport_fixture && cgo && (linux || darwin)

/* PUBLIC transport-only test loan. This TU is never part of a normal archive;
 * it provides no Root/permission qualification and opens no endpoint itself. */
#include "product_pay_transport_private.h"
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

struct ynx_product_pay_source_loan_v1 {
    ynx_product_pay_profile_v1 profile;
    _Atomic int references,full_calls,no_io_calls,request_calls,releases;
    _Atomic int fail_full_at,full_code,native_code,request_code,retain_code;
    _Atomic int release_busy_once;
};
static ynx_product_pay_bytes_v1 copy(ynx_product_pay_bytes_v1 span) {
    unsigned char *p=malloc(span.bytes);if(p)memcpy(p,span.data,span.bytes);
    ynx_product_pay_bytes_v1 out={p,p?span.bytes:0};return out;
}
ynx_product_pay_source_loan_v1 *ynx_product_fixture_new(ynx_product_pay_profile_v1 *profile) {
    ynx_product_pay_source_loan_v1 *p=calloc(1,sizeof(*p));if(!p)return NULL;
    p->profile=*profile;p->profile.resource_ref=copy(profile->resource_ref);p->profile.network_id=copy(profile->network_id);
    p->profile.account=copy(profile->account);p->profile.epoch=copy(profile->epoch);p->profile.origin=copy(profile->origin);p->profile.socket=copy(profile->socket);p->profile.service=copy(profile->service);
    atomic_init(&p->references,1);return p;
}
int32_t ynx_product_pay_source_profile_v1(ynx_product_pay_source_loan_v1 *p,ynx_product_pay_profile_v1 *out) {if(!p||!out)return 1;*out=p->profile;return 0;}
int32_t ynx_product_pay_source_full_current_v1(ynx_product_pay_source_loan_v1 *p) {
    if(!p)return 1;int calls=atomic_fetch_add(&p->full_calls,1)+1,at=atomic_load(&p->fail_full_at);
    return at&&calls>=at?atomic_load(&p->full_code):0;
}
int32_t ynx_product_pay_source_current_no_io_v1(ynx_product_pay_source_loan_v1 *p) {if(!p)return 1;atomic_fetch_add(&p->no_io_calls,1);return atomic_load(&p->native_code);}
int32_t ynx_product_pay_source_retain_v1(ynx_product_pay_source_loan_v1 *p) {if(!p)return 1;int rc=atomic_load(&p->retain_code);if(!rc)atomic_fetch_add(&p->references,1);return rc;}
int32_t ynx_product_pay_source_release_v1(ynx_product_pay_source_loan_v1 *p) {if(!p)return 1;if(atomic_exchange(&p->release_busy_once,0))return 2;atomic_fetch_add(&p->releases,1);atomic_fetch_sub(&p->references,1);return 0;}
void ynx_product_fixture_release_busy(ynx_product_pay_source_loan_v1 *p){atomic_store(&p->release_busy_once,1);}
int32_t ynx_product_fixture_request_current(void *raw) {ynx_product_pay_source_loan_v1 *p=raw;atomic_fetch_add(&p->request_calls,1);return atomic_load(&p->request_code);}
void ynx_product_fixture_set(ynx_product_pay_source_loan_v1 *p,int full_at,int full_code,int native_code,int request_code) {
    atomic_store(&p->fail_full_at,full_at);atomic_store(&p->full_code,full_code);atomic_store(&p->native_code,native_code);atomic_store(&p->request_code,request_code);
}
void ynx_product_fixture_counts(ynx_product_pay_source_loan_v1 *p,int *refs,int *releases,int *full,int *native,int *request) {
    *refs=atomic_load(&p->references);*releases=atomic_load(&p->releases);*full=atomic_load(&p->full_calls);*native=atomic_load(&p->no_io_calls);*request=atomic_load(&p->request_calls);
}
int32_t ynx_product_fixture_destroy(ynx_product_pay_source_loan_v1 *p) {
    if(!p||atomic_load(&p->references)!=1)return 5;
    free((void*)p->profile.resource_ref.data);free((void*)p->profile.network_id.data);free((void*)p->profile.account.data);free((void*)p->profile.epoch.data);free((void*)p->profile.origin.data);free((void*)p->profile.socket.data);free((void*)p->profile.service.data);free(p);return 0;
}
void ynx_product_fixture_prepare(ynx_product_pay_request_v1 *request,ynx_product_pay_source_loan_v1 *loan) {request->fence_context=loan;request->current_no_io=ynx_product_fixture_request_current;}
