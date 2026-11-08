#ifndef YNX_SOCIAL_JOINT_PROFILE_ISSUER_PRIVATE_V1_H
#define YNX_SOCIAL_JOINT_PROFILE_ISSUER_PRIVATE_V1_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE finite adapter into the original registered role/custodian service.
 * Not a public provider, generic raw signer, Root installer or new sig domain.
 * Native owner must implement all gates below, not just expose these symbols. */
typedef struct ynx_social_joint_source_v1 ynx_social_joint_source_v1;
typedef struct ynx_social_joint_binding_v1 ynx_social_joint_binding_v1;
typedef struct ynx_social_joint_role_v1 ynx_social_joint_role_v1;
typedef struct { const unsigned char *data; size_t size; } ynx_social_joint_bytes_v1;
typedef struct {
 uint32_t version,size,error_present;
 int32_t original_first;
 uint32_t physical_done,unknown;
} ynx_social_joint_status_v1;
/* error_present=1/original_first=0 is a failure. Zero-initialize outputs, adopt
 * every nonnull pointer/public length before inspecting status. version1/size24
 * must be actually written; an untouched output is NOT success. */
typedef struct {
 uint32_t version,size;
 unsigned char registered_source_resource[32];
 ynx_social_joint_bytes_v1 registration,issuer_credential,anchor_credential,history_envelope;
 /* version2/size112 on 64bit. Private SAME-process Go inventory locator,
  * generated ONLY after actual same-capture math/current and retain. Not a Go
  * pointer, Node token or grant; zero/foreign/thread mismatch MUST reject. */
 uint64_t same_process_capture_reference;
} ynx_social_joint_source_input_v1;
/* Source constructor MUST reuse approved_profiles/credential/Source-PROOF
 * verification and current history/catalog/Root registration, Source scope7,
 * policy10 issuer+anchor, epoch/window and physical registered caller checks.
 * Copying Go public originals or matching a resource ID alone cannot qualify. */
void ynx_social_joint_source_open_v1(const ynx_social_joint_source_input_v1*,ynx_social_joint_source_v1**,ynx_social_joint_status_v1*);
void ynx_social_joint_source_current_v1(ynx_social_joint_source_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_source_close_v1(ynx_social_joint_source_v1**,ynx_social_joint_status_v1*);

/* Strong Go-owned SAME capture bridge. Native's acquireRegisteredSource must
 * acquire and retain this loan, not admit resource32/raw4 alone. Input version2
 * and all original bytes/resource/ref must match inventory. No registration
 * export exists. Each call is confined to the original OS actor thread.
 * acquire adopts nonzero loan before paired status; current is genuine original
 * Source/capture current. retire blocks live calls; join does not release parent.
 * close needs no freshness, zeros loan only on actual physical child release;
 * status24 still reports original error separately from physical_done.
 * Public input spans copied synchronously; never retained foreign pointers. */
void ynx_auth_social_joint_capture_borrow_acquire_v1(uint64_t,ynx_social_joint_source_input_v1*,uint64_t*,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_capture_borrow_current_v1(uint64_t,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_capture_borrow_retire_v1(uint64_t,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_capture_borrow_join_v1(uint64_t,ynx_social_joint_status_v1*);
void ynx_auth_social_joint_capture_borrow_close_v1(uint64_t*,ynx_social_joint_status_v1*);
typedef struct {uint32_t version,size;int64_t not_before_ms,expires_ms;} ynx_social_joint_source_window_v1;
/* Caller zero-initializes window. Filled version1/size24 is retained DATA even
 * on late error; early failure leaves all0. Immutable captured window, no renew. */
void ynx_auth_social_joint_capture_borrow_window_v1(uint64_t,ynx_social_joint_source_window_v1*,ynx_social_joint_status_v1*);
/* Immutable fixed normal composition, from the SAME recognized local capture:
 * 1 original Main-local holder; 2 separately Root-registered remote holder.
 * Zero/unknown is unavailable. No caller setter, IPC/ENV mode or fallback.
 * This is only routing DATA; neither branch bypasses actual holder admission. */
void ynx_auth_social_joint_capture_borrow_main_pair_route_v1(uint64_t,uint32_t*,ynx_social_joint_status_v1*);

/* Binding resource is a locator only. Its producer MUST hold actual committed
 * Social fullpair/identity/device AND independent registered DEVICE/session/
 * Source/current originals (N1 belongs only to V4, never the Social signer).
 * No HTTP scalar, expected17 DTO, cookie, cap6/cap10 read projection or boolean
 * can construct it. The source argument remains the SAME recognized owner. */
void ynx_social_joint_binding_open_v1(ynx_social_joint_source_v1*,const unsigned char*,size_t,ynx_social_joint_binding_v1**,ynx_social_joint_status_v1*);
void ynx_social_joint_binding_current_v1(ynx_social_joint_binding_v1*,ynx_social_joint_status_v1*);
typedef struct {
 uint32_t version,size;
 /* realm,client,network,identity,device,headerSHA256; all owned by same binding */
 ynx_social_joint_bytes_v1 application[6];
 ynx_social_joint_bytes_v1 classic_public,pq_public;
 /* sole expected17 order; nullable bits only8(bundle)/9(package). */
 ynx_social_joint_bytes_v1 expected[17];
 uint32_t expected_null_mask,reserved_zero;
 int64_t not_before_ms,expires_ms;
} ynx_social_joint_binding_view_v1;
/* SAME recognized loan + Native independently qualified/held public view and
 * original body16. Go independently compares its private actor-sealed plan,
 * actual capture and sole InspectBodyOriginalDATA, before/after current/window.
 * No C++ body parser or caller issue/expiry override. Comparison is not a grant
 * or a substitute for Native's actual binding/role holder current. No outputs. */
void ynx_auth_social_joint_capture_borrow_compare_body_v1(uint64_t,ynx_social_joint_binding_view_v1*,ynx_social_joint_bytes_v1,ynx_social_joint_status_v1*);
/* view lifetime is a real child; version/size written means adopted even when
 * paired late status fails. Release view before binding close; never retarget. */
void ynx_social_joint_binding_view_v1_open(ynx_social_joint_binding_v1*,ynx_social_joint_binding_view_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_binding_view_v1_release(ynx_social_joint_binding_v1*,ynx_social_joint_binding_view_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_binding_close_v1(ynx_social_joint_binding_v1**,ynx_social_joint_status_v1*);

/* Dedicated new finite role operation, NOT family1/2/InitialPrekeys. Both roles
 * must independently verify policy10 and exact SAME capture/binding/body16
 * before opening/borrowing their original sealed Source key. The registered
 * provider UID opens its own records/wrapping; none is returned to this caller.
 * role1=record-issuer, role2=record-anchor; fixed SOURCE-PROOF/V1 frame.
 * body must equal sole PrepareBodyDATA over the independently held originals.
 * Native durable once intent precedes key entry; same body/source/resource
 * original operation is retained and UNKNOWN permits query only, never resign.
 */
void ynx_social_joint_role_open_v1(ynx_social_joint_source_v1*,ynx_social_joint_binding_v1*,const unsigned char*,size_t,uint32_t,ynx_social_joint_bytes_v1,ynx_social_joint_role_v1**,ynx_social_joint_status_v1*);
void ynx_social_joint_role_current_v1(ynx_social_joint_role_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_role_enter_v1(ynx_social_joint_role_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_role_sign_once_v1(ynx_social_joint_role_v1*,ynx_social_joint_status_v1*);
/* Actual original Source envelope bytes, partial adopted before status. Never
 * reconstruct signature/body or hash a body and call it an envelope digest. */
void ynx_social_joint_role_copy_original_v1(ynx_social_joint_role_v1*,unsigned char*,size_t,size_t*,ynx_social_joint_status_v1*);
void ynx_social_joint_role_query_original_v1(ynx_social_joint_role_v1*,unsigned char*,size_t,size_t*,ynx_social_joint_status_v1*);
void ynx_social_joint_role_retire_v1(ynx_social_joint_role_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_role_join_v1(ynx_social_joint_role_v1*,ynx_social_joint_status_v1*);
void ynx_social_joint_role_close_v1(ynx_social_joint_role_v1**,ynx_social_joint_status_v1*);
#ifdef __cplusplus
}
#endif
#endif
