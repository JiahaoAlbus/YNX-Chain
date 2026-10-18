#ifndef YNX_SOURCE_SERVER_RESOURCE_OWNER_H
#define YNX_SOURCE_SERVER_RESOURCE_OWNER_H
#include "ynx_source_platform_qualified.h"
#include "../ynx_message_platform_owner.h"
/* Static Native protection-service ABI, not N-API/public possession facts.
 * Opaque references MUST be recognized in the same Native inventory before
 * dereference. No callback installer, numeric-counter constructor or JS key. */
typedef struct ynx_selected_server_backend ynx_selected_server_backend;
typedef struct ynx_registered_native_connection ynx_registered_native_connection;
typedef struct ynx_native_server_listener ynx_native_server_listener;
typedef struct ynx_server_execution_attempt ynx_server_execution_attempt;
typedef struct ynx_server_key_row_borrow ynx_server_key_row_borrow;
typedef struct ynx_server_joint_fence ynx_server_joint_fence;
typedef struct ynx_server_independent_state_borrow ynx_server_independent_state_borrow;
#define YNX_PRIVATE_ATTEST_HEADER 20u
#define YNX_PRIVATE_ATTEST_MAX 16404u
/* Borrowed original spans only. Decode is NOT signature verification/admission. */
typedef struct {ynx_message_bytes attestation,signature;} ynx_private_attestation_parts;
veil_store_status ynx_server_attestation_decode(ynx_original_bytes,uint32_t kind,ynx_private_attestation_parts *);
/* Retained COMPLETE YNXEXE1 frame; never use a returned challenge. */
veil_store_status ynx_server_execution_challenge(ynx_original_bytes,uint32_t role,unsigned char out[32]);
/* Private canonical Rust intake, same Request::original as the dispatcher.
 * Validation alone never creates a backend/registered connection/owner. */
int32_t ynx_sdk_execution_original_validate_v1(const unsigned char *,size_t);
int32_t ynx_sdk_server_retirement_originals_verify_v1(void *,uint32_t,const unsigned char *,size_t);
/* Original MU producer; no resource command or key export occurs here. Caller
 * retains partial Esys outputs until its actual owner/current/disposal completes. */
veil_store_status ynx_server_attestation_encode(uint32_t kind,const TPM2B_ATTEST *,const TPMT_SIGNATURE *,unsigned char *sink,size_t cap,size_t *written);
/* These projections remain UNADMITTED. The server owner verifier consumes this
 * same-original challenge with independently acquired counter/fence custody. */
veil_store_status ynx_server_original_attestations_verify(const ynx_message_enrollment_public_input *,ynx_original_bytes exact_request,uint32_t role,ynx_original_bytes quote,ynx_original_bytes certify,const ynx_server_independent_state_borrow *);
/* Same retained independent borrow selects its actual attestation owner. No
 * caller TPM pointer, challenge or numerical counter can be substituted.
 * Output borrows stay valid until release; a failed observation retains all
 * partial Esys outputs and never dispatches them again. No terminal is issued. */
veil_store_status ynx_server_execution_original_attestations(ynx_server_independent_state_borrow *,const ynx_message_enrollment_public_input *,ynx_original_bytes,uint32_t,ynx_original_bytes *quote,ynx_original_bytes *certify);
/* Selected Native TU owns these constructors, never receiver fixtures.
 * Backend/attempt custody is implemented; registered connection and independent
 * state acquisition still require their genuine producer definitions.
 * A receiver must not substitute certificate/exporter DTO or SQL status here. */
veil_store_status ynx_server_selected_backend_acquire(uint32_t,ynx_selected_server_backend **);
/* No receiver-supplied SSL adoption API: normal acquisition is listener_accept
 * below, from Native's own retained context and accepted transport. */
/* DISTINCT fixed Native server-key custody, not registry admission. Only the
 * selected TPM driver is implemented here; kind2 must use its own genuine
 * driver, never reinterpret a Name/FD as TPM custody. Certificate digest is an
 * exact-input check, not an authorization proof. The same backend retains any
 * partially opened sealed owner/context and cannot retry this acquisition. */
struct ynx_message_sealed_raw_input;
veil_store_status ynx_server_transport_open(ynx_selected_server_backend *,const struct ynx_message_sealed_raw_input *,ynx_original_bytes server_certificate,const unsigned char certificate_digest[32]);
/* Native creates and owns SSL from that same retained context. fd is only a
 * borrowed nonblocking transport; caller keeps it open until connection_close.
 * No arbitrary caller SSL is adopted. Fixed deadline never rolls forward. */
veil_store_status ynx_server_connection_open(ynx_selected_server_backend *,int fd,uint64_t monotonic_deadline_ns,ynx_registered_native_connection **);
/* One nonblocking TLS accept step. want_io=1/2 means read/write is needed;
 * completion is transport observation ONLY, never store/floor/once permission.
 * No wait/network is allowed inside a synchronous storage effect. */
veil_store_status ynx_server_connection_accept_step(ynx_registered_native_connection *,int *want_io);
/* Native reads and pins the exact POST body on THIS authenticated connection.
 * out is borrowed only after canonical full-header/frame and late current.
 * Repeated readback never rereads/replays or consumes it. A supplied exchange
 * body must equal these COMPLETE captured bytes before execution adoption. */
veil_store_status ynx_server_connection_read_request(ynx_registered_native_connection *,ynx_original_bytes *,int *want_io);
veil_store_status ynx_server_connection_current(ynx_registered_native_connection *);
veil_store_status ynx_server_connection_close(ynx_registered_native_connection **);
/* Normal Native-owned listener, bound only to the port in the same retained
 * original enrollment endpoint. Location is not resource admission. Auth calls
 * accept() on this owner, never manufactures an fd/SSL/context capability.
 * would_block is an observation; out stays NULL until an actual accept. */
veil_store_status ynx_server_listener_open(ynx_selected_server_backend *,ynx_native_server_listener **);
veil_store_status ynx_server_listener_current(ynx_native_server_listener *);
veil_store_status ynx_server_listener_accept(ynx_native_server_listener *,uint64_t monotonic_deadline_ns,ynx_registered_native_connection **,int *would_block);
veil_store_status ynx_server_listener_close(ynx_native_server_listener **);
veil_store_status ynx_server_execution_acquire(ynx_selected_server_backend *,ynx_registered_native_connection *,ynx_original_bytes,uint64_t,ynx_server_execution_attempt **);
/* A canonical request is adopted before late current/admission checks. A
 * non-OK result with nonNULL out is the same partial attempt, never retryable.
 * original() exposes only its immutable public/encrypted request, not keys. */
veil_store_status ynx_server_execution_current(ynx_server_execution_attempt *);
veil_store_status ynx_server_execution_original(ynx_server_execution_attempt *,ynx_original_bytes *);
veil_store_status ynx_server_execution_close(ynx_server_execution_attempt **);
veil_store_status ynx_server_execution_counter_borrow(ynx_server_execution_attempt *,uint32_t,ynx_server_independent_state_borrow **);
veil_store_status ynx_server_independent_state_release(ynx_server_independent_state_borrow **);

/* Static fixed-startup borrowing retains both real Message3 key holders. It
 * does not export keys or use a remote custody acquisition to bootstrap Source. */
int32_t ynx_sdk_server_startup_borrow_v1(uint32_t,void **);
int32_t ynx_sdk_server_startup_recognize_v1(void *,uint32_t);
int32_t ynx_sdk_server_startup_current_v1(void *,uint32_t);
int32_t ynx_sdk_server_startup_release_v1(void **);
int32_t ynx_sdk_server_endpoint_port_v1(void *,uint32_t,uint16_t *);
int32_t ynx_sdk_server_request_header_validate_v1(void *,uint32_t,ynx_original_bytes,size_t *body_size);
veil_store_status ynx_server_selected_backend_close(ynx_selected_server_backend **);

/* PRIVATE YNXREG1 row: header28 (magic8, BE32 role/count15/kinds3),
 * fifteen BE32-length complete raw originals, each 1..65536, no trailing bytes.
 * slots: Source bootstrap/profile/role credential/admin registration/current/
 * history/revocation/wrapping current/history/TLS registration/storage registration/
 * independent state registration/client registration/certificate chain/association.
 * kind1=TPM SHA256 Name34; kind2=protected non-TPM, Name slot must be zero.
 * TLS/storage/state kinds describe evidence only, NEVER admitted owner refs.
 * Actual owner references must be recognized in the fixed Native inventory. */
/* Private fixed loader input; retention returns Required even when accepted.
 * It never admits these names/certificate/digests as a protection capability. */
typedef struct ynx_server_registered_original_input{uint32_t version,role;ynx_original_bytes association,registration;unsigned char names[3][34];ynx_original_bytes certificate,row;uint32_t kinds[3];} ynx_server_registered_original_input;
int32_t ynx_sdk_server_registered_originals_retain_v1(void *,const ynx_server_registered_original_input *);
typedef struct ynx_server_registered_original_borrow{ynx_original_bytes association,registration;unsigned char names[3][34];ynx_original_bytes certificate,row;uint32_t kinds[3];} ynx_server_registered_original_borrow;
int32_t ynx_sdk_server_registered_originals_borrow_v1(void *,ynx_server_registered_original_borrow *);
/* Auth's row already holds this exclusive original: never global reacquire.
 * Validate the exact row/association/client-registration before moving it.
 * On adoption *startup becomes NULL even when late current fails; caller keeps
 * the returned partial backend. Before adoption failures leave both unchanged.
 * Required after adoption is retained facts only, NOT registry admission. */
veil_store_status ynx_server_selected_backend_transfer(uint32_t,void **startup,ynx_original_bytes row,ynx_original_bytes association,ynx_original_bytes registration,ynx_selected_server_backend **);
/* Original observation/readback, not execution/current-floor admission. */
veil_store_status ynx_server_selected_backend_original_current(ynx_selected_server_backend *);
veil_store_status ynx_server_selected_backend_originals(ynx_selected_server_backend *,ynx_server_registered_original_borrow *);
/* Execute/respond on the same captured request/connection/backend. Original
 * response is retained before status; no re-execute after ambiguity or repeat.
 * NonOK response may report a retained reference, never qualified ready. */
veil_store_status ynx_server_execution_execute(ynx_server_execution_attempt *);
veil_store_status ynx_server_execution_response(ynx_server_execution_attempt *,ynx_original_bytes *);
#endif
