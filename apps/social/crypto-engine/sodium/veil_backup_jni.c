#include <jni.h>
#include <sodium.h>
#include "veil_backup.h"

/* Primitive transport only, not a native identity/password approval provider.
 * Owned native clear/password copies are locked and freed with sodium wipes.
 * JVM copies remain the caller's guarded responsibility, never exposed to JS.
 */
static void reject(JNIEnv *env, const char *code) {
  if ((*env)->ExceptionCheck(env)) return;
  jclass type = (*env)->FindClass(env, "java/lang/IllegalStateException");
  if (type != NULL) (*env)->ThrowNew(env, type, code);
}
static const char *status_code(int status) {
  switch (status) {
    case VEIL_BACKUP_UNSUPPORTED: return "VEIL_BACKUP_SCHEMA_UNSUPPORTED";
    case VEIL_BACKUP_NO_MEMORY: return "VEIL_BACKUP_NO_MEMORY";
    case VEIL_BACKUP_AUTH_FAILED: return "VEIL_BACKUP_AUTH_FAILED";
    case VEIL_BACKUP_CONTEXT_MISMATCH: return "VEIL_BACKUP_CONTEXT_MISMATCH";
    case VEIL_BACKUP_MEMORY_LOCK_DENIED: return "VEIL_BACKUP_MEMORY_LOCK_DENIED";
    case VEIL_BACKUP_KDF_FAILED: return "VEIL_BACKUP_KDF_FAILED";
    default: return "VEIL_BACKUP_INPUT_REJECTED";
  }
}
static unsigned char *locked_copy(JNIEnv *env, jbyteArray input, jsize length) {
  unsigned char *bytes = sodium_malloc((size_t)length);
  if (bytes == NULL) { reject(env, "VEIL_BACKUP_NO_MEMORY"); return NULL; }
  if (sodium_mlock(bytes, (size_t)length) != 0) {
    sodium_free(bytes); reject(env, "VEIL_BACKUP_MEMORY_LOCK_DENIED"); return NULL;
  }
  (*env)->GetByteArrayRegion(env, input, 0, length, (jbyte *)bytes);
  if ((*env)->ExceptionCheck(env)) { sodium_free(bytes); return NULL; }
  return bytes;
}
JNIEXPORT jstring JNICALL Java_com_ynx_social_matrix_VeilBackupNative_sodiumVersion(JNIEnv *env, jclass type) {
  (void)type;
  if (sodium_init() < 0) { reject(env, "VEIL_BACKUP_NATIVE_UNAVAILABLE"); return NULL; }
  return (*env)->NewStringUTF(env, sodium_version_string());
}
static jbyteArray transform(JNIEnv *env, jbyteArray input, jbyteArray password, jbyteArray binding, int opening) {
  if (input == NULL || password == NULL || binding == NULL || sodium_init() < 0) {
    reject(env, "VEIL_BACKUP_INPUT_REJECTED"); return NULL;
  }
  jsize size = (*env)->GetArrayLength(env, input);
  jsize password_size = (*env)->GetArrayLength(env, password);
  jsize context_size = (*env)->GetArrayLength(env, binding);
  size_t maximum = VEIL_BACKUP_MAX_BYTES + (opening ? VEIL_BACKUP_HEADER_BYTES + 16U : 0U);
  if (size < (opening ? (jsize)(VEIL_BACKUP_HEADER_BYTES + 17U) : 1) ||
      (size_t)size > maximum || password_size < 1 || password_size > 1024 || context_size != 32) {
    reject(env, "VEIL_BACKUP_INPUT_REJECTED"); return NULL;
  }
  unsigned char context[VEIL_BACKUP_CONTEXT_BYTES] = {0};
  unsigned char *bytes = NULL, *secret = NULL;
  veil_backup_blob *output = NULL;
  jbyteArray result = NULL;
  (*env)->GetByteArrayRegion(env, binding, 0, context_size, (jbyte *)context);
  if ((*env)->ExceptionCheck(env)) goto done;
  bytes = locked_copy(env, input, size);
  if (bytes == NULL) goto done;
  secret = locked_copy(env, password, password_size);
  if (secret == NULL) goto done;
  int status = opening ? veil_backup_open(bytes, (size_t)size, secret, (size_t)password_size, context, &output)
                       : veil_backup_seal(bytes, (size_t)size, secret, (size_t)password_size, context, &output);
  if (status != VEIL_BACKUP_OK) { reject(env, status_code(status)); goto done; }
  size_t output_size = veil_backup_size(output);
  if (output_size < 1U || output_size > VEIL_BACKUP_MAX_BYTES + VEIL_BACKUP_HEADER_BYTES + 16U) {
    reject(env, "VEIL_BACKUP_OUTPUT_REJECTED"); goto done;
  }
  result = (*env)->NewByteArray(env, (jsize)output_size);
  if (result == NULL) goto done;
  (*env)->SetByteArrayRegion(env, result, 0, (jsize)output_size, (const jbyte *)veil_backup_bytes(output));
  if ((*env)->ExceptionCheck(env)) result = NULL;
done:
  veil_backup_free(output);
  if (secret != NULL) sodium_free(secret);
  if (bytes != NULL) sodium_free(bytes);
  sodium_memzero(context, sizeof context);
  return result;
}
JNIEXPORT jbyteArray JNICALL Java_com_ynx_social_matrix_VeilBackupNative_sealImage(
    JNIEnv *env, jclass type, jbyteArray image, jbyteArray password, jbyteArray context) {
  (void)type; return transform(env, image, password, context, 0);
}
JNIEXPORT jbyteArray JNICALL Java_com_ynx_social_matrix_VeilBackupNative_openImage(
    JNIEnv *env, jclass type, jbyteArray backup, jbyteArray password, jbyteArray context) {
  (void)type; return transform(env, backup, password, context, 1);
}
