#ifndef YNX_CORE_INITIALIZATION_RECORD_ABI_V1
#define YNX_CORE_INITIALIZATION_RECORD_ABI_V1
#include <stddef.h>
#include <stdint.h>
typedef struct { const unsigned char *data; size_t size; } ynx_core_initialization_bytes_v1;
typedef struct {
 uint32_t version, purpose;
 uint64_t storage_generation;
 unsigned char request_digest[32];
 ynx_core_initialization_bytes_v1 kind, id, plaintext;
} ynx_core_initialization_record_v1;
/* 96 bytes; offsets version0,purpose4,generation8,request16,spans48/64/80.
 * Query only the SAME retained genuine FirstDeviceCore policy on its owner
 * thread. No permission is created. Failure leaves caller output unchanged.
 * All spans are immutable borrows held by that existing CoreLoan lifetime.
 * kind is "first-device-bootstrap-v1" plus NUL; id is 64 lower hex plus NUL.
 * C protected YNXREC record kind is 7, not Signal Identity kind 1.
 * plaintext <=65536 bytes, no trailing NUL, exact format below:
 * [0..8] YNXFDI01
 * [8..12] uint32BE version=1; [12..16] uint32BE field_count=7
 * [16..24] uint64BE storage_generation
 * [24..56] original operation16 + incarnation16
 * [56..88] original request SHA256
 * [88..120] original Source nonce; [120..152] original Account nonce
 * then seven uint32BE byte-length + original bytes, in this exact order:
 * account, identity, device, alias without NUL, original fd1 operation,
 * original Android-protected YNXOKJ01 encrypted pair, unsigned 2657B proposal.
 * id = lowercase hex SHA256("YNX/SOCIAL/FIRST-DEVICE-BOOTSTRAP-RECORD/V1\0"
 *   || uint32BE(account_len)||account || uint32BE(identity_len)||identity
 *   || uint32BE(device_len)||device).
 * This local bootstrap record is neither a Signal session nor an accepted
 * device authorization. Reuse existing actual storage_seal for outer YNXREC.
 * Typed FirstDevice InitializeStorage: exactly this one journal step, no
 * inbox/outbox. Messages still require exactly one genuine inbox or outbox.
 * No dummy network message, generic queue relaxation or new signing domain.
 */
int32_t ynx_sdk_native_core_initialization_record_borrow_v1(
 void *same_policy, ynx_core_initialization_record_v1 *out);
#endif
