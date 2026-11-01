#pragma once
#include <stddef.h>
#include <stdint.h>

/* Private REQUIRED Auth producer contract proposed to the original owner.
 * Not implemented by this module and not an admission/provider registration.
 * Strong link only; no weak success, callback table, JS credential or fallback.
 * All functions run on the same dedicated native thread. Original Auth owns
 * vault/current/review/approval, durable once records and authenticated IO.
 * Never export these pointers, spans or credentials through JNI/JSI/Swift UI. */
#ifdef __cplusplus
extern "C" {
#endif
typedef struct YNXMobilePQCapture YNXMobilePQCapture;
typedef struct YNXMobilePQLoan YNXMobilePQLoan;
typedef struct { const uint8_t *bytes; size_t length; } YNXMobilePQSpan;
typedef struct {
 uint32_t version, size;
 YNXMobilePQSpan binding, message, policy, key_version, execution_height;
 uint64_t native_chain_id;
} YNXMobilePQInputs;
typedef struct {
 uint32_t version,size;
 uint8_t account[20],network_id[32],request_digest[32],transaction_hash[32];
 uint32_t transaction_hash_present;
} YNXMobilePQProjection;
enum { YNX_MOBILE_PQ_TRANSACTION=1, YNX_MOBILE_PQ_REGISTERED_RESTORE=2, YNX_MOBILE_PQ_ORIGINAL_QUERY=3 };
enum { YNX_MOBILE_PQ_CURRENT_CAPTURE=1, YNX_MOBILE_PQ_CURRENT_SIGN=2,
 YNX_MOBILE_PQ_CURRENT_BROADCAST=3, YNX_MOBILE_PQ_CURRENT_RESTORE=4,
 YNX_MOBILE_PQ_CURRENT_QUERY=5 };
/* reference is DATA selection, never approval. Capture must bind the real
 * selected account/network/vault revision/nonce/body/budget/deadline and mode.
 * Partial capture is adopted even on error and remains closeable. */
int32_t ynx_auth_mobile_pq_capture_v1(const uint8_t*,size_t,uint32_t,YNXMobilePQCapture**);
int32_t ynx_auth_mobile_pq_current_v1(YNXMobilePQCapture*,uint32_t);
int32_t ynx_auth_mobile_pq_inputs_v1(YNXMobilePQCapture*,YNXMobilePQInputs*);
/* Recovery reads the original account-owned durable operation, including a
 * lost SIGN_ENTERED ACK. Flags are original journal facts, never JS input. */
enum { YNX_MOBILE_PQ_SIGN_ENTERED=1,YNX_MOBILE_PQ_SIGNED_ACK=2,
 YNX_MOBILE_PQ_SUBMIT_ENTERED=4,YNX_MOBILE_PQ_RESTORE_ENTERED=8,YNX_MOBILE_PQ_RESTORED_ACK=16 };
int32_t ynx_auth_mobile_pq_read_original_state_v1(YNXMobilePQCapture*,uint32_t*);
/* Exact 43-byte protected credential + existing encrypted original only.
 * No classic keys. A partial loan must be released even if acquisition fails.
 * Spans stay live until release; producer wipes its credential on release. */
int32_t ynx_auth_mobile_pq_borrow_backup43_v1(YNXMobilePQCapture*,YNXMobilePQLoan**,YNXMobilePQSpan*,YNXMobilePQSpan*);
int32_t ynx_auth_mobile_pq_release_loan_v1(YNXMobilePQLoan*);
/* Independent actual review/current/nonce+SAME ordinary owner binding AND
 * durable SIGN_ENTERED before calling transaction_once. Lost ACK forbids sign,
 * cold recapture of the same reference may only query, never renew/re-sign. */
int32_t ynx_auth_mobile_pq_begin_sign_once_v1(YNXMobilePQCapture*,uint64_t);
/* Durable retained signed original ACK; never invokes transport. Idempotent
 * SAME bytes may be saved after UI lock/retire for the original journal only.
 * Different originals refuse; this is not signing or broadcast permission. */
int32_t ynx_auth_mobile_pq_retain_signed_v1(YNXMobilePQCapture*,const uint8_t*,size_t);
/* Independent broadcast approval AND original durable UNKNOWN before IO.
 * begin consumes once even on ambiguous failure. dispatch never retries. */
int32_t ynx_auth_mobile_pq_begin_submit_once_v1(YNXMobilePQCapture*);
int32_t ynx_auth_mobile_pq_dispatch_once_v1(YNXMobilePQCapture*);
int32_t ynx_auth_mobile_pq_query_original_v1(YNXMobilePQCapture*);
/* Cancels new effects, retains original query and public outcome custody. */
int32_t ynx_auth_mobile_pq_cancel_v1(YNXMobilePQCapture*);
/* Registered account only: verify actual on-chain public binding and original
 * backup against it, CAS EMPTY protected slot. Nonempty always refuses. Does
 * not create keys, call open_initial, publish, register or change the account.
 * Producer MUST independently call the actual original custody exact-binding
 * getter (or same-open ACK), not accept a numeric owner ID as qualification.
 * After successful CAS current(restore) validates the NEW matching terminal
 * slot, instead of incorrectly requiring that the slot is still empty.
 * Opened ordinary owner remains the module's owner, never transferred. */
int32_t ynx_auth_mobile_pq_restore_registered_empty_once_v1(YNXMobilePQCapture*,uint64_t);
/* Fixed sanitized public review/observation snapshot only, never secrets or
 * raw server exception. Copy usable after errors/retirement. capacity<=2MiB;
 * no sizing effect/signing/IO. Producer retains first response before return.
 * selected=1 means snapshot exists; length0 is permitted; no JSON authority. */
int32_t ynx_auth_mobile_pq_copy_public_v1(YNXMobilePQCapture*,uint32_t,uint8_t*,size_t,size_t*,uint32_t*);
/* Only fixed public identity digests may cross Hermes. Never signed Member,
 * envelope, private key, backup, credential, Source handle or replay packet. */
int32_t ynx_auth_mobile_pq_copy_projection_v1(YNXMobilePQCapture*,YNXMobilePQProjection*);
int32_t ynx_auth_mobile_pq_retire_v1(YNXMobilePQCapture*);
int32_t ynx_auth_mobile_pq_close_v1(YNXMobilePQCapture*);
/* Refuse release while original signature/IO/query result ACK or loan/child
 * cleanup remains uncertain. Sticky close error can coexist with truly closed;
 * release is the sole actual closed gate, never discarded by GC. */
int32_t ynx_auth_mobile_pq_release_closed_v1(YNXMobilePQCapture*);
#ifdef __cplusplus
}
#endif
