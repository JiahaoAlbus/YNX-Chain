//go:build securelink_product_pay_transport && cgo && (linux || darwin)

#include "product_pay_transport_private.h"
#include "../../cmd/ynx-secure-link-caller/private_client_v1.h"
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

extern int32_t goYNXProductClientOpen(ynx_product_pay_profile_v1*,uintptr_t*);
extern int32_t goYNXProductClientRequest(uintptr_t,ynx_product_pay_request_v1*,void*,void*,ynx_link_private_client_packet_v1*,ynx_link_private_client_packet_v1**,uint32_t*);
extern int32_t goYNXProductClientReleaseResponse(uintptr_t,void*);
extern int32_t goYNXProductClientRetire(uintptr_t);
extern int32_t goYNXProductClientDrain(uintptr_t,uint32_t*);
extern int32_t goYNXProductClientDispose(uintptr_t);

struct ynx_product_pay_transport_v1 {
    ynx_product_pay_source_loan_v1 *loan;
    uintptr_t go;
    unsigned refs;
    int retained;
    _Atomic int active,closed,closing,cleanup_started,cleanup_first,first,native_first;
    _Atomic unsigned responses;
    struct ynx_product_pay_transport_v1 *next;
};
typedef struct product_response {
    ynx_product_pay_transport_v1 *transport;
    ynx_link_private_client_packet_v1 *packet;
    int32_t first,native;
    uint32_t complete;
    _Atomic int active;
    struct product_response *next;
} product_response;
static pthread_mutex_t product_inventory_mutex=PTHREAD_MUTEX_INITIALIZER;
static ynx_product_pay_transport_v1 *product_transports;
static product_response *product_responses;
static unsigned product_transport_count,product_response_count;
enum { product_maximum_nodes=65536 };
#ifdef YNX_PRODUCT_TRANSPORT_FIXTURE
static _Atomic int product_fault;
void ynx_product_fixture_transport_fault(int code){atomic_store(&product_fault,code);}
static int product_take_fault(int code){int expected=code;return atomic_compare_exchange_strong(&product_fault,&expected,0);}
#else
static int product_take_fault(int code){(void)code;return 0;}
#endif
int32_t ynx_product_link_packet_fault(void){return product_take_fault(2);}

static ynx_product_pay_transport_v1 *product_pin(ynx_product_pay_transport_v1 *raw) {
    pthread_mutex_lock(&product_inventory_mutex);
    ynx_product_pay_transport_v1 *p=product_transports;
    while(p&&p!=raw)p=p->next;
    if(p&&atomic_load(&p->closing))p=NULL;
    if(p)p->refs++;
    pthread_mutex_unlock(&product_inventory_mutex);return p;
}
static void product_unpin(ynx_product_pay_transport_v1 *p) {
    pthread_mutex_lock(&product_inventory_mutex);p->refs--;pthread_mutex_unlock(&product_inventory_mutex);
}
#ifdef YNX_PRODUCT_TRANSPORT_FIXTURE
uintptr_t ynx_product_fixture_transport_go(ynx_product_pay_transport_v1 *raw) {
    ynx_product_pay_transport_v1 *p=product_pin(raw);if(!p)return 0;uintptr_t id=p->go;product_unpin(p);return id;
}
#endif
static void product_first(ynx_product_pay_transport_v1 *p,int32_t rc) {
    if(rc){int zero=0;atomic_compare_exchange_strong(&p->first,&zero,rc);}
}
static int32_t product_native(ynx_product_pay_transport_v1 *p,int32_t rc) {
    if(!rc)return 0;int zero=0;atomic_compare_exchange_strong(&p->native_first,&zero,rc);product_first(p,6);return 6;
}
typedef struct product_write_guard {
    ynx_product_pay_transport_v1 *owner;
    void *context;
    int32_t (*current)(void*);
    int32_t native;
} product_write_guard;

// Called only by the original private Go beforeWrite hook. No inventory,
// transport, Store or Go mutex is held around the original native callbacks.
int32_t ynx_product_link_write_current(void *raw) {
    product_write_guard *guard=raw;
    if(!guard||!atomic_load(&guard->owner->active))return 7;
    int32_t rc=ynx_product_pay_source_current_no_io_v1(guard->owner->loan);
    if(!rc)rc=guard->current(guard->context);
    if(rc){guard->native=rc;product_native(guard->owner,rc);return rc;}
    return atomic_load(&guard->owner->active)?0:7;
}

int32_t ynx_product_pay_transport_open_v1(ynx_product_pay_source_loan_v1 *loan,ynx_product_pay_transport_v1 **out) {
    if(!out)return 1;*out=NULL;if(!loan)return 1;
    ynx_product_pay_transport_v1 *p=calloc(1,sizeof(*p));if(!p)return 3;
    p->loan=loan;atomic_init(&p->active,1);
    pthread_mutex_lock(&product_inventory_mutex);
    if(product_transport_count>=product_maximum_nodes){pthread_mutex_unlock(&product_inventory_mutex);free(p);return 3;}
    product_transport_count++;p->next=product_transports;product_transports=p;p->refs=1;
    pthread_mutex_unlock(&product_inventory_mutex);*out=p;
    int32_t rc=ynx_product_pay_source_retain_v1(loan);
    if(!rc){p->retained=1;rc=ynx_product_pay_source_full_current_v1(loan);}
    ynx_product_pay_profile_v1 profile={0};
    if(!rc)rc=ynx_product_pay_source_profile_v1(loan,&profile);
    if(rc)rc=product_native(p,rc);
    else {rc=goYNXProductClientOpen(&profile,&p->go);product_first(p,rc);}
    if(rc)atomic_store(&p->active,0);
    product_unpin(p);return rc;
}

static ynx_link_private_client_packet_v1 *product_error_packet(int32_t rc,int32_t native) {
    ynx_link_private_client_packet_v1 *packet=calloc(1,sizeof(*packet));
    if(packet){packet->error_code=rc;packet->native_current_code=native;}
    return packet;
}
static ynx_product_pay_bytes_v1 product_bytes(const void *p,size_t bytes) {
    ynx_product_pay_bytes_v1 out={(const unsigned char*)p,bytes};return out;
}
static product_response *product_reserve_response(ynx_product_pay_transport_v1 *p,ynx_product_pay_response_v1 *out) {
    /* Every bounded identity, error packet and response debt is reserved before
     * any full-current/dispatch. Capacity/OOM here cannot lose received DATA. */
    if(product_take_fault(1)||product_take_fault(3))return NULL;
    ynx_link_private_client_packet_v1 *packet=product_error_packet(0,0);if(!packet)return NULL;
    product_response *owner=calloc(1,sizeof(*owner));
    if(!owner){ynx_link_private_client_packet_free_v1(packet);return NULL;}
    owner->transport=p;owner->packet=packet;atomic_init(&owner->active,1);
    pthread_mutex_lock(&product_inventory_mutex);
    if(product_response_count>=product_maximum_nodes||atomic_load(&p->responses)>=64){pthread_mutex_unlock(&product_inventory_mutex);free(owner);ynx_link_private_client_packet_free_v1(packet);return NULL;}
    product_response_count++;owner->next=product_responses;product_responses=owner;atomic_fetch_add(&p->responses,1);
    pthread_mutex_unlock(&product_inventory_mutex);
    ynx_product_pay_response_v1 result={0};result.version=1;result.size=sizeof(result);result.response_owner=owner;*out=result;return owner;
}
static int32_t product_publish_response(product_response *owner,ynx_link_private_client_packet_v1 *packet,int32_t rc,int32_t native,uint32_t complete,ynx_product_pay_response_v1 *out) {
    if(packet){ynx_link_private_client_packet_free_v1(owner->packet);owner->packet=packet;}
    else packet=owner->packet;
    owner->first=rc;owner->native=native?native:packet->native_current_code;owner->complete=complete;
    ynx_product_pay_response_v1 result={0};result.version=1;result.size=sizeof(result);
    result.status=(uint32_t)packet->status_code;result.method=product_bytes(packet->method,packet->method_size);
    result.request_path=product_bytes(packet->request_path,packet->request_path_size);
    result.content_type=product_bytes(packet->content_type,packet->content_type_size);result.body=product_bytes(packet->body,packet->body_size);
    result.dispatch_possible=packet->dispatch_possible||packet->packet_present;result.response_owner=owner;*out=result;return rc;
}

int32_t ynx_product_pay_transport_request_v1(ynx_product_pay_transport_v1 *raw,const ynx_product_pay_request_v1 *request,ynx_product_pay_response_v1 *out) {
    if(!out||out->response_owner)return 1;memset(out,0,sizeof(*out));
    ynx_product_pay_transport_v1 *p=product_pin(raw);if(!p)return 1;
    /* Terminal identities cannot mint fresh response debt or private storage. */
    if(!atomic_load(&p->active)||!p->go){product_unpin(p);return 7;}
    product_response *response=product_reserve_response(p,out);
    if(!response){product_first(p,3);product_unpin(p);return 3;}
    int32_t rc=0,native=0;uint32_t complete=0;ynx_link_private_client_packet_v1 *packet=NULL;
    if(!request||request->version!=1||request->size!=sizeof(*request)||request->operation>=14||request->operation==10||!request->fence_context||!request->current_no_io)rc=1;
    else if(!atomic_load(&p->active)||!p->go)rc=7;
    else {native=ynx_product_pay_source_full_current_v1(p->loan);if(native)rc=product_native(p,native);}
    product_write_guard guard={p,request?request->fence_context:NULL,request?request->current_no_io:NULL,0};
    if(!rc){
        ynx_product_pay_request_v1 copied=*request;
        rc=goYNXProductClientRequest(p->go,&copied,&guard,response,response->packet,&packet,&complete);
        product_first(p,rc);
        if(guard.native)native=guard.native;
        /* Fresh full check is OUTSIDE every owner/write lock. Keep the first
         * IO/native failure and immutable packet even when this late check fails. */
        int32_t after=ynx_product_pay_source_full_current_v1(p->loan);
        if(after){if(!native)native=after;product_native(p,after);if(!rc)rc=6;}
    }
    product_first(p,rc);
    rc=product_publish_response(response,packet,rc,native,complete,out);
    product_first(p,rc);product_unpin(p);return rc;
}

int32_t ynx_product_pay_transport_response_diagnostics_v1(const ynx_product_pay_response_v1 *response,ynx_product_pay_response_diagnostics_v1 *out) {
    if(!response||!out)return 1;memset(out,0,sizeof(*out));
    pthread_mutex_lock(&product_inventory_mutex);product_response *p=product_responses;
    while(p&&p!=response->response_owner)p=p->next;
    if(!p||!atomic_load(&p->active)){pthread_mutex_unlock(&product_inventory_mutex);return 1;}
    ynx_link_private_client_packet_v1 *packet=p->packet;
    out->version=1;out->size=sizeof(*out);out->first_code=p->first;out->native_current_code=p->native;out->error_present=p->first!=0;out->response_complete=p->complete;
    out->dispatch_possible=packet->dispatch_possible||packet->packet_present;
    static const char code[]="PRODUCT_TRANSPORT_ERROR",message[]="original Product transport request failed";
    if(p->first){out->error_code=product_bytes(code,sizeof(code)-1);out->error_message=product_bytes(message,sizeof(message)-1);}
    out->headers_original=product_bytes(packet->header_json,packet->header_json_size);
    out->partial_response_bytes=packet->partial_response_bytes?packet->partial_response_bytes:packet->body_size;
    pthread_mutex_unlock(&product_inventory_mutex);return 0;
}

void ynx_product_pay_transport_release_response_v1(ynx_product_pay_response_v1 *response) {
    if(!response)return;
    pthread_mutex_lock(&product_inventory_mutex);product_response *p=product_responses;
    while(p&&p!=response->response_owner)p=p->next;
    if(p&&atomic_exchange(&p->active,0)){
        ynx_link_private_client_packet_v1 *packet=p->packet;p->packet=NULL;
        ynx_product_pay_transport_v1 *transport=p->transport;p->transport=NULL;
        pthread_mutex_unlock(&product_inventory_mutex);ynx_link_private_client_packet_free_v1(packet);
        if(transport->go)goYNXProductClientReleaseResponse(transport->go,p);
        atomic_fetch_sub(&transport->responses,1);
    }else pthread_mutex_unlock(&product_inventory_mutex);
    memset(response,0,sizeof(*response));
}

int32_t ynx_product_pay_transport_retire_v1(ynx_product_pay_transport_v1 *raw) {
    ynx_product_pay_transport_v1 *p=product_pin(raw);if(!p)return 1;
    atomic_store(&p->active,0);int32_t rc=p->go?goYNXProductClientRetire(p->go):0;
    product_first(p,rc);product_unpin(p);return rc;
}
int32_t ynx_product_pay_transport_cancel_v1(ynx_product_pay_transport_v1 *raw) {return ynx_product_pay_transport_retire_v1(raw);}

static int32_t product_drain(ynx_product_pay_transport_v1 *p,uint32_t *completed) {
    *completed=0;if(atomic_load(&p->closed)){*completed=1;return atomic_load(&p->first);}
    if(atomic_load(&p->active))return 1;
    pthread_mutex_lock(&product_inventory_mutex);int busy=p->refs!=1||atomic_load(&p->responses)!=0;
    if(!busy)atomic_store(&p->closing,1);
    pthread_mutex_unlock(&product_inventory_mutex);
    if(busy)return 5;
    uint32_t done=1;int32_t rc=p->go?goYNXProductClientDrain(p->go,&done):0;
    if(!done){atomic_store(&p->closing,0);return rc?rc:5;}product_first(p,rc);
    if(atomic_exchange(&p->cleanup_started,1)){atomic_store(&p->closing,0);return atomic_load(&p->cleanup_first);}
    int32_t released=p->retained?ynx_product_pay_source_release_v1(p->loan):0;
    /* Auth source-loan-r1 defines 2 as a known, still-active SAME release
     * debt: no reference was dropped. Only this non-dispatch drain may retry.
     * Other unknown release failures remain selected once and retained. */
    if(released==2){atomic_store(&p->cleanup_started,0);atomic_store(&p->closing,0);return 5;}
    if(released){atomic_store(&p->cleanup_first,released);product_native(p,released);atomic_store(&p->closing,0);return released;}
    p->retained=0;p->loan=NULL;
    int32_t disposed=p->go?goYNXProductClientDispose(p->go):0;
    if(disposed){atomic_store(&p->cleanup_first,disposed);product_first(p,disposed);atomic_store(&p->closing,0);return disposed;}
    p->go=0;atomic_store(&p->closed,1);*completed=1;atomic_store(&p->closing,0);return atomic_load(&p->first);
}
int32_t ynx_product_pay_transport_join_v1(ynx_product_pay_transport_v1 *raw,uint32_t *completed) {
    if(!completed)return 1;*completed=0;ynx_product_pay_transport_v1 *p=product_pin(raw);if(!p)return 1;
    int32_t rc=product_drain(p,completed);product_unpin(p);return rc;
}
int32_t ynx_product_pay_transport_close_v1(ynx_product_pay_transport_v1 *raw,uint32_t *completed) {
    if(!completed)return 1;*completed=0;ynx_product_pay_transport_v1 *p=product_pin(raw);if(!p)return 1;
    atomic_store(&p->active,0);if(p->go)goYNXProductClientRetire(p->go);
    int32_t rc=product_drain(p,completed);product_unpin(p);return rc;
}
