#pragma once
#include <stdint.h>
/* PRIVATE build-time transport grammar, not a new exported C ABI or Root grant.
 * Auth implements the SIX EXISTING prototypes in this exact mother header. */
#include "network-consent-policy-current-next-private.h"
#define YNX_CURRENT4_PRIVATE_WIRE_VERSION 1u
#define YNX_CURRENT4_PRIVATE_WIRE_MAGIC "YNC4"
#define YNX_CURRENT4_PRIVATE_HEADER_BYTES 24u
#define YNX_CURRENT4_PRIVATE_POLICY_MAX 8388608u
#define YNX_CURRENT4_PRIVATE_READ_PREFIX_BYTES 66u
#define YNX_CURRENT4_PRIVATE_BODY_MAX 8388674u
#define YNX_CURRENT4_PRIVATE_FRAME_MAX 8388698u
/* Serialize fields individually BIG-ENDIAN; NEVER memcpy/dump these C types.
 * Header: magic[4],version:u16,kind:u8,op:u8,seq:u64,bodyBytes:u32,reserved:u32=0.
 * kind REQUEST=1, RESPONSE=2. seq nonzero, exactly matched to one outstanding
 * request; CAPTURE only once, first seq1. No wire owner pointer/handle/provider.
 */
enum ynx_current4_private_kind_v1 { YNX_C4_REQUEST=1, YNX_C4_RESPONSE=2 };
enum ynx_current4_private_op_v1 {
 YNX_C4_CAPTURE=1, YNX_C4_READ=2, YNX_C4_CURRENT=3,
 YNX_C4_RETIRE=4, YNX_C4_JOIN=5, YNX_C4_CLOSE=6
};
/* Requests: CAPTURE exact network32+owner42 copied from SAME Auth immutable
 * principal (DATA selectors, not authority); READ capacity:u64 (1..POLICY_MAX);
 * others empty. Core uses actual bound App.Read(ctx,owner), never JS principal.
 * Common response error: code:i32,error_present:u32(0|1), preserving code0
 * WITH error_present1. No status truthiness conversion.
 * CAPTURE: common8+owner_present:u32. Adopt nonnull partial BEFORE error.
 * READ failure: common8 only; caller policy/metadata unchanged.
 * READ success: common8+execution_height:u64+policy_bytes:u64+
 * subject_owner:42 ASCII lower0xhex+EXACT original policy bytes. No JSON rewrite.
 * NO producer clock is on wire. Auth fills native metadata.now_millis from
 * its independent clock after fresh reply and enforces original window/current.
 * CURRENT/RETIRE: common8. JOIN/CLOSE: common8+physical_complete:u32(0|1).
 * Physical completion independent of first error; never turn denial into ready.
 * READ may repeat with fresh seq on SAME captured owner after prior completion;
 * UNKNOWN seq MUST NOT resend, recapture, change slot or silently retry.
 * EOF/cancel/process exit alone is NOT remote owner physical completion.
 * Root-pinned peer/closure/receipt/current independently required by owners.
 */
