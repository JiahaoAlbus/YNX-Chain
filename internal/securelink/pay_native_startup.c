//go:build securelink_pay_native_startup && cgo && (linux || darwin)

#include "../../cmd/ynx-secure-link-caller/private_client_startup_v1.h"
#include "pay_native_actual_context_private.h"
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

extern int32_t goYNXPayStartupOpen(void*,ynx_wallet_pay_root_transport_profile_v1*,uintptr_t*);
extern int32_t goYNXPayStartupAdopt(uintptr_t,void**);
extern int32_t goYNXPayStartupRetire(uintptr_t);
extern int32_t goYNXPayStartupJoin(uintptr_t,uint32_t);
extern int32_t goYNXPayStartupClose(uintptr_t);
extern int32_t goYNXPayStartupError(uintptr_t,ynx_link_private_client_packet_v1**);
extern int32_t goYNXPayStartupFree(uintptr_t);

struct ynx_link_pay_native_startup_v1 {
    ynx_wallet_pay_actual_context_v1 *ctx;
    ynx_wallet_pay_root_transport_loan_v1 *loan;
    ynx_link_private_client_source_fence_v1 ctx_fence,root_fence;
    uintptr_t go;
    unsigned refs;
    int ctx_retained,root_retained,joined;
    _Atomic int active,closing,closed,native_first,diagnostic_first;
    struct ynx_link_pay_native_startup_v1 *next;
};
static pthread_mutex_t startup_mutex=PTHREAD_MUTEX_INITIALIZER;
static ynx_link_pay_native_startup_v1 *startup_inventory;

static ynx_link_pay_native_startup_v1 *pin(ynx_link_pay_native_startup_v1 *p) {
    pthread_mutex_lock(&startup_mutex);ynx_link_pay_native_startup_v1 *s=startup_inventory;
    while(s&&s!=p)s=s->next;if(s)s->refs++;
    pthread_mutex_unlock(&startup_mutex);return s;
}
static void unpin(ynx_link_pay_native_startup_v1 *s) {pthread_mutex_lock(&startup_mutex);s->refs--;pthread_mutex_unlock(&startup_mutex);}
static void diagnostic(ynx_link_pay_native_startup_v1 *s,int32_t rc){if(rc){int zero=0;atomic_compare_exchange_strong(&s->diagnostic_first,&zero,rc);}}
static int32_t native_failure(ynx_link_pay_native_startup_v1 *s,int32_t rc){if(rc){int zero=0;atomic_compare_exchange_strong(&s->native_first,&zero,rc);diagnostic(s,6);return 6;}return 0;}
static int valid_fence(ynx_link_private_client_source_fence_v1 *f,void *ctx){return f->ctx==ctx&&f->current&&f->retain&&f->release;}

/* These helpers run while an outer startup call owns its native pin. Foreign
 * native current/constructor callbacks NEVER execute under startup_mutex. */
int32_t ynx_pay_startup_native_current(void *raw) {
    ynx_link_pay_native_startup_v1 *s=raw;if(!s||!atomic_load(&s->active))return 7;
    int32_t rc=s->ctx_fence.current(s->ctx_fence.ctx);
    if(!rc)rc=s->root_fence.current(s->root_fence.ctx);
    if(rc){native_failure(s,rc);return rc;}
    return atomic_load(&s->active)?0:7;
}
int32_t ynx_pay_startup_native_code(void *raw){ynx_link_pay_native_startup_v1*s=raw;return s?atomic_load(&s->native_first):0;}
int32_t ynx_pay_startup_native_adopt(void *raw,void *borrow,void **out) {
    if(!out)return 2;*out=NULL;ynx_link_pay_native_startup_v1 *s=raw;
    int32_t rc=ynx_pay_startup_native_current(s);if(rc)return rc;
    ynx_wallet_pay_source_lease_v1 *source=NULL;
    rc=ynx_wallet_pay_source_adopt_registration_v1(s->ctx,borrow,&source);
    *out=source; /* nonnull actual Source ALWAYS adopts before late status */
    if(rc)native_failure(s,rc);
    return rc;
}

int32_t ynx_link_pay_native_startup_open_v1(ynx_wallet_pay_actual_context_v1 *ctx,ynx_link_pay_native_startup_v1 **out) {
    if(!out)return 1;*out=NULL;if(!ctx)return 1;
    ynx_link_pay_native_startup_v1 *s=calloc(1,sizeof(*s));if(!s)return 3;
    s->ctx=ctx;atomic_init(&s->active,1);atomic_init(&s->closing,0);atomic_init(&s->closed,0);atomic_init(&s->native_first,0);atomic_init(&s->diagnostic_first,0);
    pthread_mutex_lock(&startup_mutex);s->next=startup_inventory;startup_inventory=s;s->refs=1;pthread_mutex_unlock(&startup_mutex);
    *out=s;
    int32_t rc=ynx_wallet_pay_ctx_get_fence_v1(ctx,&s->ctx_fence);
    if(!rc&&!valid_fence(&s->ctx_fence,ctx))rc=2;
    if(!rc){rc=s->ctx_fence.retain(s->ctx_fence.ctx);if(!rc)s->ctx_retained=1;}
    if(!rc)rc=ynx_wallet_pay_ctx_get_original_loan_v1(ctx,&s->loan);
    if(!rc&&!s->loan)rc=2;
    if(!rc)rc=ynx_wallet_pay_root_transport_fence_v1(s->loan,&s->root_fence);
    if(!rc&&!valid_fence(&s->root_fence,s->loan))rc=2;
    if(!rc){rc=s->root_fence.retain(s->root_fence.ctx);if(!rc)s->root_retained=1;}
    ynx_wallet_pay_root_transport_profile_v1 profile={0};
    if(!rc)rc=ynx_wallet_pay_root_transport_profile_read_v1(s->loan,&profile);
    int32_t result;
    if(rc)result=native_failure(s,rc);
    else {result=goYNXPayStartupOpen(s,&profile,&s->go);diagnostic(s,result);}
    if(result)atomic_store(&s->active,0);
    unpin(s);return result;
}

int32_t ynx_link_pay_native_startup_adopt_source_v1(ynx_link_pay_native_startup_v1 *raw,ynx_wallet_pay_source_lease_v1 **out) {
    if(!out)return 1;*out=NULL;ynx_link_pay_native_startup_v1*s=pin(raw);if(!s)return 1;
    void *source=NULL;
    int32_t rc=(!atomic_load(&s->active)||!s->go)?1:goYNXPayStartupAdopt(s->go,&source);
    *out=source;
    diagnostic(s,rc);unpin(s);return rc;
}
int32_t ynx_link_pay_native_startup_retire_v1(ynx_link_pay_native_startup_v1 *raw) {
    ynx_link_pay_native_startup_v1*s=pin(raw);if(!s)return 1;atomic_store(&s->active,0);
    int32_t rc=s->go?goYNXPayStartupRetire(s->go):0;diagnostic(s,rc);unpin(s);return rc;
}
int32_t ynx_link_pay_native_startup_join_v1(ynx_link_pay_native_startup_v1 *raw,uint32_t ms) {
    ynx_link_pay_native_startup_v1*s=pin(raw);if(!s)return 1;
    int32_t rc=(!ms||ms>60000)?2:atomic_load(&s->active)?1:s->go?goYNXPayStartupJoin(s->go,ms):0;
    if(!rc){pthread_mutex_lock(&startup_mutex);s->joined=1;pthread_mutex_unlock(&startup_mutex);}
    diagnostic(s,rc);unpin(s);return rc;
}
int32_t ynx_link_pay_native_startup_close_v1(ynx_link_pay_native_startup_v1 *raw) {
    ynx_link_pay_native_startup_v1*s=pin(raw);if(!s)return 1;
    if(atomic_load(&s->closed)){unpin(s);return 0;}
    atomic_store(&s->active,0);
    int32_t rc=s->go?goYNXPayStartupClose(s->go):0;
    pthread_mutex_lock(&startup_mutex);if(!rc&&!s->joined)rc=5;pthread_mutex_unlock(&startup_mutex);
    /* Exactly one close selects release; joining/freeing cannot discard a
     * borrowed Root/Main/context parent. Their actual Native owner closes them. */
    if(!rc) {
        int expected=0;
        if(atomic_compare_exchange_strong(&s->closing,&expected,1)) {
            if(s->root_retained){s->root_fence.release(s->root_fence.ctx);s->root_retained=0;}
            if(s->ctx_retained){s->ctx_fence.release(s->ctx_fence.ctx);s->ctx_retained=0;}
            atomic_store(&s->closed,1);
        } else if(!atomic_load(&s->closed))rc=5;
    }
    diagnostic(s,rc);unpin(s);return rc;
}
int32_t ynx_link_pay_native_startup_closed_v1(ynx_link_pay_native_startup_v1 *raw){ynx_link_pay_native_startup_v1*s=pin(raw);if(!s)return 0;int result=atomic_load(&s->closed);unpin(s);return result;}
int32_t ynx_link_pay_native_startup_error_v1(ynx_link_pay_native_startup_v1 *raw,ynx_link_private_client_packet_v1 **out) {
    if(!out)return 1;*out=NULL;ynx_link_pay_native_startup_v1*s=pin(raw);if(!s)return 1;
    int32_t rc=s->go?goYNXPayStartupError(s->go,out):0;
    if(!*out){*out=calloc(1,sizeof(**out));if(!*out){unpin(s);return 3;}}
    int32_t native=atomic_load(&s->native_first),first=atomic_load(&s->diagnostic_first);
    if(native)(*out)->native_current_code=native;
    if(!(*out)->error_code&&first){(*out)->error_code=first;rc=first;}
    if(native&&!(*out)->error_message){static const char text[]="original Auth native startup failure";(*out)->error_message=malloc(sizeof(text)-1);if((*out)->error_message){memcpy((*out)->error_message,text,sizeof(text)-1);(*out)->error_message_size=sizeof(text)-1;}}
    unpin(s);return rc;
}
int32_t ynx_link_pay_native_startup_free_v1(ynx_link_pay_native_startup_v1 *raw) {
    pthread_mutex_lock(&startup_mutex);ynx_link_pay_native_startup_v1 **at=&startup_inventory;while(*at&&*at!=raw)at=&(*at)->next;
    if(!*at){pthread_mutex_unlock(&startup_mutex);return 1;}
    if(raw->refs||!atomic_load(&raw->closed)){pthread_mutex_unlock(&startup_mutex);return 5;}
    *at=raw->next;pthread_mutex_unlock(&startup_mutex);
    int32_t rc=raw->go?goYNXPayStartupFree(raw->go):0;
    if(rc){pthread_mutex_lock(&startup_mutex);raw->next=startup_inventory;startup_inventory=raw;pthread_mutex_unlock(&startup_mutex);return rc;}
    free(raw);return 0;
}
