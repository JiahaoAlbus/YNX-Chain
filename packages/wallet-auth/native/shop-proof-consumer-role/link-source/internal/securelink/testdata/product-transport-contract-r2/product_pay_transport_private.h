#ifndef YNX_PRODUCT_PAY_TRANSPORT_PRIVATE_V1_H
#define YNX_PRODUCT_PAY_TRANSPORT_PRIVATE_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* Private, strongly linked SAME-image ABI. No constructor from JSON/config,
 * registration pointer, URL, renderer handle, or Member/WPC five-slot owner.
 * Auth alone mints the source loan after genuine Product Root/current math.
 * LINK alone mints its transport owner from that loan. Every nonnull partial
 * output is adopted BEFORE status/error interpretation. */
typedef struct ynx_product_pay_source_loan_v1 ynx_product_pay_source_loan_v1;
typedef struct ynx_product_pay_transport_v1 ynx_product_pay_transport_v1;
enum ynx_product_pay_operation_v1 {
 YNX_PRODUCT_CREATE_INTENT=0,YNX_PRODUCT_LOOKUP_INTENT=1,
 YNX_PRODUCT_TERMS_REVIEW=2,YNX_PRODUCT_READ_INTENT=3,
 YNX_PRODUCT_READ_INVOICE=4,YNX_PRODUCT_READ_EVENTS=5,
 YNX_PRODUCT_SETTLEMENT_REVIEW=6,YNX_PRODUCT_REFUND_REVIEW=7,
 YNX_PRODUCT_RECONCILE_INTENT=8,YNX_PRODUCT_RECONCILE_OPERATION=9,
 YNX_PRODUCT_ORIGINAL_INTENT=10, /* LOCAL Main/Shop/Cloud: never HTTP */
 YNX_PRODUCT_INVOICE_ORIGINALS=11,YNX_PRODUCT_ARCHIVE_RECEIPT=12,
 YNX_PRODUCT_ARCHIVE_RECONCILIATION=13
};
typedef struct { const unsigned char *data; size_t bytes; } ynx_product_pay_bytes_v1;
typedef struct {
 uint32_t version,size;
 ynx_product_pay_bytes_v1 resource_ref,network_id,account,epoch,origin,socket,service;
 uint32_t peer_uid; int32_t peer_pid;
 uint64_t timeout_ms,max_header_bytes,max_response_bytes;
 uint32_t enabled_operations; /* 14 low bits only, explicit signed intersection */
} ynx_product_pay_profile_v1;
typedef struct {
 uint32_t version,size,operation;
 ynx_product_pay_bytes_v1 method,path,content_type,body;
 /* Actual Auth same-operation permission + Main retirement + cancellation.
  * Invoked immediately pre-write; synchronous, bounded, NO IO/NAPI/locks.
  * Not an independent remote Store/Auth globally-atomic revocation fence. */
 void *fence_context;
 int32_t (*current_no_io)(void *);
} ynx_product_pay_request_v1;
typedef struct {
 uint32_t version,size,status;
 ynx_product_pay_bytes_v1 method,request_path,content_type,body;
 uint32_t dispatch_possible;
 /* Immutable original body even on late error, owned until release_response.
  * Auth must retain partial first and withhold usable DATA after late revoke. */
 void *response_owner;
} ynx_product_pay_response_v1;
/* Fixed readonly diagnostics of the SAME response packet, including partial
 * bytes on failure. No arbitrary/native exception text may contain credentials.
 * All spans belong to response_owner, not the transport or an input buffer.
 * Initialize this whole struct to zero before the getter. */
typedef struct {
 uint32_t version,size;
 int32_t first_code,native_current_code;
 uint32_t error_present,response_complete,dispatch_possible;
 ynx_product_pay_bytes_v1 error_code,error_message,headers_original;
 uint64_t partial_response_bytes;
} ynx_product_pay_response_diagnostics_v1;
/* Auth source loan: profile spans are held until loan release; full_current is
 * mandatory on actor OUTSIDE write locks, before dispatch and after result.
 * current_no_io only reads the already-qualified fixed-deadline native guard.
 * No call refreshes an expired/retired operation grant. */
int32_t ynx_product_pay_source_profile_v1(ynx_product_pay_source_loan_v1*,ynx_product_pay_profile_v1*);
int32_t ynx_product_pay_source_full_current_v1(ynx_product_pay_source_loan_v1*);
int32_t ynx_product_pay_source_current_no_io_v1(ynx_product_pay_source_loan_v1*);
int32_t ynx_product_pay_source_retain_v1(ynx_product_pay_source_loan_v1*);
int32_t ynx_product_pay_source_release_v1(ynx_product_pay_source_loan_v1*);
/* LINK actual client/New/Register/Borrow belongs to this dedicated ABI. */
int32_t ynx_product_pay_transport_open_v1(ynx_product_pay_source_loan_v1*,ynx_product_pay_transport_v1**);
int32_t ynx_product_pay_transport_request_v1(ynx_product_pay_transport_v1*,const ynx_product_pay_request_v1*,ynx_product_pay_response_v1*);
int32_t ynx_product_pay_transport_response_diagnostics_v1(const ynx_product_pay_response_v1*,ynx_product_pay_response_diagnostics_v1*);
/* Idempotent on a zero response. Releasing a recognized response clears its
 * spans/owner; never close a parent while response_owner remains nonnull. */
void ynx_product_pay_transport_release_response_v1(ynx_product_pay_response_v1*);
int32_t ynx_product_pay_transport_cancel_v1(ynx_product_pay_transport_v1*);
int32_t ynx_product_pay_transport_retire_v1(ynx_product_pay_transport_v1*);
/* Nonblocking local drain observation, not another IO/dispatch attempt.
 * completed=0 preserves SAME opaque owner; never drop/reopen/retry UNKNOWN.
 * join requires prior retire; close also retires. Repeating these only drains
 * the original call and repeats its first result. completed=1 means physical
 * resources/loan refs are released, even if rc preserves an earlier failure.
 * Opaque identities remain non-reused bounded tombstones for process lifetime,
 * with no FDs, private data or parent retained. No caller free/delete API.
 * request is synchronous; caller keeps request spans/fence_context valid until
 * it returns, and response_owner independently owns immutable retained bytes.
 * LINK retains source loan through actual drain, never a borrowed stack ptr.
 * There is NO automatic request retry, including GET, reconnect or POST.
 * Auth independently burns each original per-operation permission/once slot. */
int32_t ynx_product_pay_transport_join_v1(ynx_product_pay_transport_v1*,uint32_t *completed);
int32_t ynx_product_pay_transport_close_v1(ynx_product_pay_transport_v1*,uint32_t *completed);
#ifdef __cplusplus
}
#endif
#endif
