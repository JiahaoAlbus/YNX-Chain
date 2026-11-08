//go:build cgo && (linux || darwin)

#include "../../cmd/ynx-secure-link-caller/private_client_v1.h"
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

extern int32_t goYNXPrivateClientCapture(uintptr_t,void*,uint8_t,uintptr_t*);
extern int32_t goYNXPrivateClientCall(uintptr_t,uint8_t,void*,size_t,ynx_link_private_client_packet_v1**);
extern int32_t goYNXPrivateClientError(uintptr_t,ynx_link_private_client_packet_v1**);
extern int32_t goYNXPrivateClientRetire(uintptr_t);
extern int32_t goYNXPrivateClientJoin(uintptr_t,uint32_t);
extern int32_t goYNXPrivateClientClose(uintptr_t);
extern int32_t goYNXPrivateClientFree(uintptr_t);
extern int32_t goYNXPrivateRegistrationBorrowRelease(uintptr_t,void*);

struct ynx_link_private_client_registration_v1 {
    uintptr_t go;
    _Atomic int active;
    unsigned refs,holders,borrows;
    struct ynx_link_private_client_registration_v1 *next;
};
struct ynx_link_private_client_holder_v1 {
    uintptr_t go;
    ynx_link_private_client_registration_v1 *registration;
    ynx_link_private_client_source_fence_v1 fence;
    _Atomic int active,native_first;
    unsigned refs;
    int joined,closed,query,fence_retained;
    struct ynx_link_private_client_holder_v1 *next;
};
static pthread_mutex_t inventory_mu=PTHREAD_MUTEX_INITIALIZER;
static ynx_link_private_client_registration_v1 *registrations;
static ynx_link_private_client_holder_v1 *holders;
struct ynx_link_private_client_registration_borrow_v1 {
    ynx_link_private_client_registration_v1 *registration;
    _Atomic int active;
    struct ynx_link_private_client_registration_borrow_v1 *next;
};
static ynx_link_private_client_registration_borrow_v1 *borrows;

static ynx_link_private_client_registration_v1 *registration_pin(ynx_link_private_client_registration_v1 *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_registration_v1 *r=registrations;
    while(r&&r!=p)r=r->next;
    if(r)r->refs++;
    pthread_mutex_unlock(&inventory_mu);return r;
}
static void registration_unpin(ynx_link_private_client_registration_v1 *r) {
    pthread_mutex_lock(&inventory_mu);r->refs--;pthread_mutex_unlock(&inventory_mu);
}
static ynx_link_private_client_holder_v1 *holder_pin(ynx_link_private_client_holder_v1 *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_holder_v1 *h=holders;
    while(h&&h!=p)h=h->next;
    if(h)h->refs++;
    pthread_mutex_unlock(&inventory_mu);return h;
}
static void holder_unpin(ynx_link_private_client_holder_v1 *h) {
    pthread_mutex_lock(&inventory_mu);h->refs--;pthread_mutex_unlock(&inventory_mu);
}
static int32_t local_current(ynx_link_private_client_holder_v1 *h) {
    return atomic_load(&h->active)&&atomic_load(&h->registration->active)?0:YNX_LINK_PRIVATE_CLOSED_V1;
}

/* Go-owner-only helpers: no C header configuration/route installer exists. */
ynx_link_private_client_registration_v1 *ynx_link_owner_register(uintptr_t go) {
    if(!go)return NULL;
    ynx_link_private_client_registration_v1 *r=calloc(1,sizeof(*r));if(!r)return NULL;
    r->go=go;atomic_init(&r->active,1);
    pthread_mutex_lock(&inventory_mu);r->next=registrations;registrations=r;pthread_mutex_unlock(&inventory_mu);return r;
}
void ynx_link_owner_retire(ynx_link_private_client_registration_v1 *p) {
    ynx_link_private_client_registration_v1 *r=registration_pin(p);if(!r)return;
    atomic_store(&r->active,0);registration_unpin(r);
}
int32_t ynx_link_owner_free(ynx_link_private_client_registration_v1 *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_registration_v1 **at=&registrations;while(*at&&*at!=p)at=&(*at)->next;
    if(!*at){pthread_mutex_unlock(&inventory_mu);return 1;}
    if(p->refs||p->holders||p->borrows||atomic_load(&p->active)){pthread_mutex_unlock(&inventory_mu);return 5;}
    *at=p->next;pthread_mutex_unlock(&inventory_mu);free(p);return 0;
}
void *ynx_link_owner_borrow(ynx_link_private_client_registration_v1 *p) {
    ynx_link_private_client_registration_borrow_v1 *b=calloc(1,sizeof(*b));if(!b)return NULL;
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_registration_v1 *r=registrations;while(r&&r!=p)r=r->next;
    if(!r||!atomic_load(&r->active)||r->borrows>=64){pthread_mutex_unlock(&inventory_mu);free(b);return NULL;}
    b->registration=r;atomic_init(&b->active,1);b->next=borrows;borrows=b;r->borrows++;
    pthread_mutex_unlock(&inventory_mu);return b;
}
uint32_t ynx_link_owner_borrows(ynx_link_private_client_registration_v1 *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_registration_v1 *r=registrations;while(r&&r!=p)r=r->next;
    uint32_t count=r?r->borrows+r->holders:0;pthread_mutex_unlock(&inventory_mu);return count;
}
int32_t ynx_link_private_client_registration_borrow_current_v1(ynx_link_private_client_registration_borrow_v1 *b) {
    if(!b)return 1;return atomic_load(&b->active)&&atomic_load(&b->registration->active)?0:7;
}
int32_t ynx_link_private_client_registration_from_borrow_v1(ynx_link_private_client_registration_borrow_v1 *b,ynx_link_private_client_registration_v1 **out) {
    if(!out)return 1;*out=NULL;
    int32_t rc=ynx_link_private_client_registration_borrow_current_v1(b);if(rc)return rc;
    *out=b->registration;return 0;
}
int32_t ynx_link_private_client_registration_borrow_release_v1(ynx_link_private_client_registration_borrow_v1 *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_registration_borrow_v1 *b=borrows;while(b&&b!=p)b=b->next;
    if(!b||!atomic_exchange(&b->active,0)){pthread_mutex_unlock(&inventory_mu);return 1;}
    uintptr_t go=b->registration->go;pthread_mutex_unlock(&inventory_mu);
    /* Go serializes drop with owner Close. The original borrow remains in the
     * native inventory/count until that lock is held; no raw-pointer ABA gap. */
    return goYNXPrivateRegistrationBorrowRelease(go,b);
}
int32_t ynx_link_owner_drop_borrow(void *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_registration_borrow_v1 **at=&borrows;while(*at&&*at!=p)at=&(*at)->next;
    if(!*at){pthread_mutex_unlock(&inventory_mu);return 1;}
    ynx_link_private_client_registration_borrow_v1 *b=*at;*at=b->next;b->registration->borrows--;
    pthread_mutex_unlock(&inventory_mu);free(b);return 0;
}
void ynx_link_owner_holder_retire(void *p) {
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return;
    atomic_store(&h->active,0);holder_unpin(h);
}
int32_t ynx_link_owner_native_code(void *p) {
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return 0;
    int32_t code=atomic_load(&h->native_first);holder_unpin(h);return code;
}
int32_t ynx_link_private_client_current_local_v1(ynx_link_private_client_holder_v1 *p) {
    /* Valid private OWNED handle only. Its normal owner retains it until all
     * current users finish; free/reusing its pointer is outside this ABI.
     * No inventory mutex, Go callback, OS, or FD operation is performed. */
    if(!p)return 1;
    return local_current(p);
}
int32_t ynx_link_private_client_current_source_v1(ynx_link_private_client_holder_v1 *p) {
    ynx_link_private_client_holder_v1 *h=p;if(!h)return 1;
    int32_t rc=local_current(h);
    if(!rc) {
        int32_t native=atomic_load(&h->native_first);
        if(!native)native=h->fence.current(h->fence.ctx);
        if(native){int zero=0;atomic_compare_exchange_strong(&h->native_first,&zero,native);rc=6;}
        if(!rc)rc=local_current(h);
    }
    return rc;
}
int32_t ynx_link_owner_current(void *p){return ynx_link_private_client_current_source_v1(p);}
int32_t ynx_link_private_client_recheck_v1(ynx_link_private_client_holder_v1 *p){return ynx_link_private_client_current_source_v1(p);}

int32_t ynx_link_private_client_capture_v1(ynx_link_private_client_registration_v1 *p,const ynx_link_private_client_source_fence_v1 *f,uint8_t query,ynx_link_private_client_holder_v1 **out) {
    if(!out)return 1;*out=NULL;
    if(!f||!f->ctx||!f->current||!f->retain||!f->release||query>1)return 1;
    ynx_link_private_client_registration_v1 *r=registration_pin(p);if(!r)return 3;
    if(!atomic_load(&r->active)){registration_unpin(r);return 7;}
    ynx_link_private_client_holder_v1 *h=calloc(1,sizeof(*h));
    if(!h){registration_unpin(r);return 3;}
    h->registration=r;h->fence=*f;h->query=query;atomic_init(&h->active,1);atomic_init(&h->native_first,0);
    pthread_mutex_lock(&inventory_mu);r->holders++;h->next=holders;holders=h;pthread_mutex_unlock(&inventory_mu);
    *out=h; /* Adopt even a nonnull error partial before interpreting rc. */
    int32_t rc=goYNXPrivateClientCapture(r->go,h,query,&h->go);
    if(!rc) {
        int32_t retained=f->retain(f->ctx);
        if(retained){atomic_store(&h->native_first,retained);rc=6;}
        else {h->fence_retained=1;rc=ynx_link_private_client_current_source_v1(h);}
    }
    if(rc)atomic_store(&h->active,0);
    registration_unpin(r);return rc;
}
static int32_t apply_native_error(ynx_link_private_client_holder_v1 *h,int32_t rc,ynx_link_private_client_packet_v1 **out) {
    int32_t code=atomic_load(&h->native_first);
    if(code&&out&&*out) {
        (*out)->native_current_code=code;
        if((*out)->error_code==0||(*out)->error_code==7||(*out)->error_code==3) {
            static const char text[]="original native source current rejected";
            free((*out)->error_message);(*out)->error_message=NULL;(*out)->error_message_size=0;
            (*out)->error_code=6;(*out)->error_message=malloc(sizeof(text)-1);
            if((*out)->error_message){memcpy((*out)->error_message,text,sizeof(text)-1);(*out)->error_message_size=sizeof(text)-1;}
            rc=6;
        }
    }
    return rc;
}
int32_t ynx_link_private_client_call_v1(ynx_link_private_client_holder_v1 *p,uint8_t op,const uint8_t *body,size_t size,ynx_link_private_client_packet_v1 **out) {
    if(!out)return 1;*out=NULL;
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return 1;
    /* Source-current is independently invoked by Go immediately at Write. */
    int32_t rc;
    if(!h->go)rc=3;
    else if(local_current(h)) {
        rc=goYNXPrivateClientError(h->go,out);
        if(!rc&&*out){(*out)->error_code=7;rc=7;}
    } else rc=goYNXPrivateClientCall(h->go,op,(void*)body,size,out);
    rc=apply_native_error(h,rc,out);holder_unpin(h);return rc;
}
int32_t ynx_link_private_client_error_v1(ynx_link_private_client_holder_v1 *p,ynx_link_private_client_packet_v1 **out) {
    if(!out)return 1;*out=NULL;
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return 1;
    int32_t rc=h->go?goYNXPrivateClientError(h->go,out):3;
    if(!h->go){*out=calloc(1,sizeof(**out));if(*out)(*out)->error_code=3;}
    rc=apply_native_error(h,rc,out);holder_unpin(h);return rc;
}
void ynx_link_private_client_packet_free_v1(ynx_link_private_client_packet_v1 *p) {
    if(!p)return;
    free(p->method);free(p->request_path);free(p->header_json);free(p->content_type);free(p->cache_control);free(p->body);free(p->error_message);free(p);
}
int32_t ynx_link_private_client_retire_v1(ynx_link_private_client_holder_v1 *p) {
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return 1;
    atomic_store(&h->active,0);int32_t rc=h->go?goYNXPrivateClientRetire(h->go):0;holder_unpin(h);return rc;
}
int32_t ynx_link_private_client_join_v1(ynx_link_private_client_holder_v1 *p,uint32_t ms) {
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return 1;
    int32_t rc=(!ms||ms>60000)?2:(h->go?goYNXPrivateClientJoin(h->go,ms):0);
    if(!rc){pthread_mutex_lock(&inventory_mu);h->joined=1;pthread_mutex_unlock(&inventory_mu);}
    holder_unpin(h);return rc;
}
int32_t ynx_link_private_client_close_v1(ynx_link_private_client_holder_v1 *p) {
    ynx_link_private_client_holder_v1 *h=holder_pin(p);if(!h)return 1;
    atomic_store(&h->active,0);int32_t rc=h->go?goYNXPrivateClientClose(h->go):0;
    if(!rc){pthread_mutex_lock(&inventory_mu);if(h->joined)h->closed=1;else rc=5;pthread_mutex_unlock(&inventory_mu);}
    holder_unpin(h);return rc;
}
int32_t ynx_link_private_client_free_v1(ynx_link_private_client_holder_v1 *p) {
    pthread_mutex_lock(&inventory_mu);
    ynx_link_private_client_holder_v1 **at=&holders;while(*at&&*at!=p)at=&(*at)->next;
    if(!*at){pthread_mutex_unlock(&inventory_mu);return 1;}
    if(p->refs||!p->joined||!p->closed){pthread_mutex_unlock(&inventory_mu);return 5;}
    *at=p->next;pthread_mutex_unlock(&inventory_mu);
    int32_t rc=p->go?goYNXPrivateClientFree(p->go):0;
    if(rc){pthread_mutex_lock(&inventory_mu);p->next=holders;holders=p;pthread_mutex_unlock(&inventory_mu);return rc;}
    if(p->fence_retained)p->fence.release(p->fence.ctx);
    pthread_mutex_lock(&inventory_mu);p->registration->holders--;pthread_mutex_unlock(&inventory_mu);free(p);return 0;
}
