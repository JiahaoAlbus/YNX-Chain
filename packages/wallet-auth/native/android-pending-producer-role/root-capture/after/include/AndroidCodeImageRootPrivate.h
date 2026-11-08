#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
/* PRIVATE CODE-image expectations, not Source/DEVICE/approval/signing authority.
 * Root/A selects a protected external POSTBUILD record. No caller path, JSON,
 * expected digest, observed image, provider, callback or registration setter.
 * Compile this adapter into the SAME actual JNI image as the Auth consumer.
 */
typedef struct ynx_native_android_code_image_root_v1 ynx_native_android_code_image_root_v1;
typedef struct ynx_native_android_code_image_view_v1 ynx_native_android_code_image_view_v1;
typedef struct {uint32_t present;int32_t code;uint32_t origin;int64_t platform_code;} ynx_native_android_code_image_failure_v1;
typedef struct {const uint8_t*bytes;size_t length;} ynx_native_android_code_image_bytes_v1;
typedef struct {ynx_native_android_code_image_root_v1*owner;ynx_native_android_code_image_failure_v1 failure;} ynx_native_android_code_image_acquisition_v1;
typedef struct {ynx_native_android_code_image_view_v1*owner;ynx_native_android_code_image_failure_v1 failure;} ynx_native_android_code_image_view_acquisition_v1;
typedef struct {ynx_native_android_code_image_failure_v1 failure;uint32_t unknown,physical_done;} ynx_native_android_code_image_drain_v1;
typedef struct {
 uint32_t version,size,application_uid,application_gid;
 uint32_t image_uid,image_gid,image_mode,reserved;
 uint64_t image_device,image_inode,image_bytes;
 ynx_native_android_code_image_bytes_v1 service,process_name,image_path,image_sha256;
} ynx_native_android_code_image_data_v1;
/* Adopt nonnull partials BEFORE failure/current/shape checks. A DATA view does
 * not outlive its SAME view and Root owner. Spans are borrowed, not a new cap.
 * Current performs actor/Root/physical image checks and is not Store-lock-safe.
 */
ynx_native_android_code_image_acquisition_v1 ynx_native_android_code_image_root_acquire_v1(void);
ynx_native_android_code_image_failure_v1 ynx_native_android_code_image_root_current_v1(ynx_native_android_code_image_root_v1*);
ynx_native_android_code_image_view_acquisition_v1 ynx_native_android_code_image_root_view_open_v1(ynx_native_android_code_image_root_v1*);
ynx_native_android_code_image_failure_v1 ynx_native_android_code_image_view_read_v1(ynx_native_android_code_image_view_v1*,ynx_native_android_code_image_data_v1*);
ynx_native_android_code_image_failure_v1 ynx_native_android_code_image_view_current_v1(ynx_native_android_code_image_view_v1*);
ynx_native_android_code_image_drain_v1 ynx_native_android_code_image_view_release_v1(ynx_native_android_code_image_view_v1*);
void ynx_native_android_code_image_root_retire_v1(ynx_native_android_code_image_root_v1*);
/* Known child/IO debt BEFORE physical close selection is unknown=0/done=0;
 * the SAME owner may progress after debt returns, without new acquisition.
 * A selected Close(2) UNKNOWN is unknown=1/done=0, never redispatched.
 * A root close retains all open views/children. Cleanup does not require a
 * fresh authorization/current success. Release only after physical close.
 */
ynx_native_android_code_image_drain_v1 ynx_native_android_code_image_root_close_v1(ynx_native_android_code_image_root_v1*);
ynx_native_android_code_image_drain_v1 ynx_native_android_code_image_root_release_closed_v1(ynx_native_android_code_image_root_v1**);
#ifdef __cplusplus
}
#endif
