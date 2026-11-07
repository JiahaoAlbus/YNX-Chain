#pragma once
#include <stdint.h>
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE Auth/platform link ABI, not a JS/JSI module name, public NativeModule,
 * provider registration or permission setter. Only the original platform
 * install owner may implement these strong physical/brand/custody calls.
 * The Auth factory independently verifies Root/Source18/current/agent scope.
 * Nonnull partials are adopted BEFORE rc or error_present, even code0. */
typedef struct {const uint8_t*data;size_t bytes;} YNXAIMobileSpanV6;
typedef struct {uint32_t present;int32_t code;} YNXAIMobileFailureV6;
typedef struct YNXAIMobileApplication YNXAIMobileApplication;
typedef struct {
 uint32_t version,size;
 YNXAIMobileSpanV6 platform,application_id,installed_app_identity_digest;
 YNXAIMobileSpanV6 manifest_digest,implementing_image_digest,private_module_digest;
 YNXAIMobileFailureV6 failure;
} YNXAIMobileApplicationDATA;
int32_t ynx_ai_mobile_application_acquire_v6(YNXAIMobileApplication**);
int32_t ynx_ai_mobile_application_read_v6(YNXAIMobileApplication*,YNXAIMobileApplicationDATA*);
int32_t ynx_ai_mobile_application_current_v6(YNXAIMobileApplication*);
void ynx_ai_mobile_application_retire_v6(YNXAIMobileApplication*);
int32_t ynx_ai_mobile_application_close_v6(YNXAIMobileApplication*);
int32_t ynx_ai_mobile_application_release_closed_v6(YNXAIMobileApplication*);
/* No function here reads Wallet asset43, account/BIRTH, V4/device HTTP or
 * server-response keys. Dedicated V6 key/review/codec ABI is separate and must
 * use its original real platform owner; no fallback is declared here. */
#ifdef __cplusplus
}
#endif
