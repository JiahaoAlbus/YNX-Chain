#pragma once
#include <stddef.h>
#include <stdint.h>
#include "AndroidDeviceProvisioningCapturePrivate.h"
#ifdef __cplusplus
extern "C" {
#endif
/* Private same-image PUBLIC transport only. Auth alone selects the genuine
 * held Root/capture, endpoint and SPKI pin; these bytes are NOT Source grants.
 * Fixed GET/TLS1.3/WebPKI AND SPKI, no Cookie/Authorization/header input,
 * redirect, env route, retry, JavaVM, App global or DEVICE Source dependency.
 * Same capture_current is checked before DNS and every socket read/write and
 * after all buffered response/copy work. Complete PUBLIC bytes may coexist
 * with paired late failure (including present1/code0), never admission.
 * Exact compiled 127.0.0.1:18443 alone reuses existing QA CA+its fixed leaf pin,
 * still ANDed with this original capture's SPKI. All other hosts use platform
 * TLS1.3/WebPKI. No caller-selected trust mode or insecure verifier.
 * URL is ASCII lowercase DNS/IPv4 + optional canonical port + exact path/query,
 * HTTPS only, no credentials/fragment/CRLF/backslash. IPv6 not supported here.
 */
typedef struct {
 uint32_t version,size;
 const uint8_t*url;size_t url_bytes;
 uint8_t spki_sha256[32];
 uint32_t maximum_ms,body_capacity;
} ynx_social_android_device_public_get_request_v1;
void ynx_social_android_device_public_get_v1(ynx_auth_android_device_capture_v1*,
 const ynx_social_android_device_public_get_request_v1*,uint8_t*,size_t,size_t*,
 ynx_auth_android_provision_failure_v1*);
#ifdef __cplusplus
}
static_assert(sizeof(ynx_social_android_device_public_get_request_v1)==64);
#endif
