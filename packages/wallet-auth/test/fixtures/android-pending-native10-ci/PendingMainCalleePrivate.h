#pragma once
/* Main-owned same-image actual private callee ABI. Component/source checks
 * do not confer Root/Source qualification or prove installed operation.
 * Native final ports are the existing pair5/directory4/abort1 Auth contract.
 * No generic callback, key/Root/JSON/path input, setters or fallback permitted.
 */
#include <AndroidDeviceRegistrationPortsPrivate.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct ynx_main_android_pending_pair_hold_v1 ynx_main_android_pending_pair_hold_v1;
/* Genuine SAME source identifies the already retained original Main pending
 * Origin and actual DEVICE custody. Expected16 is reread from Auth, not caller
 * originals. No registration/session Binding prerequisite. Capture metadata
 * only; actual with_pending decrypt/DER disclosure occurs only at borrow_once.
 * Every nonnull partial is returned before failure, including present/code0.
 */
void ynx_main_android_pending_pair_hold_capture_v1(ynx_auth_android_pending_source_v1*,ynx_main_android_pending_pair_hold_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_main_android_pending_pair_hold_current_v1(ynx_main_android_pending_pair_hold_v1*,ynx_auth_android_pending_source_v1*,ynx_auth_android_provision_failure_v1*);
/* SAME Source + independent actual userPQapproval/currentPolicy checked by
 * actual callers before any private bytes. R15 Protection.with_pending/OS
 * parent performs actual authenticated decrypt. Keep Native Zeroizing DER
 * owned until physical close; preserve late UseFailure.retained output.
 * Return DER54/150 + actual pk2592/64; no keygen/sign/generic frame callback.
 */
void ynx_main_android_pending_pair_hold_borrow_once_v1(ynx_main_android_pending_pair_hold_v1*,ynx_auth_android_pending_source_v1*,ynx_original_android_pending_pair_borrow_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_main_android_pending_pair_hold_retire_v1(ynx_main_android_pending_pair_hold_v1*);
void ynx_main_android_pending_pair_hold_close_v1(ynx_main_android_pending_pair_hold_v1**,ynx_auth_android_provision_drain_v1*);

typedef struct ynx_main_android_pending_appdir_hold_v1 ynx_main_android_pending_appdir_hold_v1;
/* SAME actual Main OS Context.getNoBackupFilesDir retained physical loan,
 * not Wallet RN getDataDir and never caller/resourceRef-derived path. Output
 * FD belongs to this hold, is never closed by the consumer. Native matches
 * the independently selected original Root literal parent/leaf before any
 * final journal FD publication. That Root mapping accessor remains an exact
 * original Auth/Root contract decision, not a new Root registry in this draft.
 */
void ynx_main_android_pending_appdir_hold_capture_v1(ynx_auth_android_pending_source_v1*,ynx_main_android_pending_appdir_hold_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_main_android_pending_appdir_hold_borrow_v1(ynx_main_android_pending_appdir_hold_v1*,int*,ynx_auth_android_provision_failure_v1*);
/* Physical identity only, allowed for SAME outcome flush after Source revoke;
 * this cannot authorize new key, Core, HTTP, journal intent or replay work. */
void ynx_main_android_pending_appdir_hold_current_v1(ynx_main_android_pending_appdir_hold_v1*,ynx_auth_android_provision_failure_v1*);
void ynx_main_android_pending_appdir_hold_close_v1(ynx_main_android_pending_appdir_hold_v1**,ynx_auth_android_provision_drain_v1*);

/* Original P02 caller owns creation/retention of this opaque context from its
 * SAME Weak RequestLifetime borrow and pending operation, until Auth proof
 * physical close. No RequestLifetime::retain(now,...) and no JS signal clone.
 * Native's existing abort-current port only validates/delegates this genuine
 * original object. Factory/caller lifetime still needs P02 exact confirmation;
 * a raw token/DTO from callers cannot create this context. */
/* Only the fixed normal Native/SDK private factory may capture this zero-input
 * original request. Neither method is a Java/JS pointer installer. */
void ynx_main_android_pending_original_abort_capture_v1(ynx_original_android_abort_context_v1**,ynx_auth_android_provision_failure_v1*);
void ynx_main_android_pending_original_abort_close_v1(ynx_original_android_abort_context_v1**,ynx_auth_android_provision_drain_v1*);
void ynx_main_android_pending_original_abort_current_v1(ynx_original_android_abort_context_v1*,ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
#endif
