#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
typedef struct {const uint8_t *bytes; size_t length;} YNXAITaskAgentBytesV6;
typedef struct {
 uint32_t version; size_t struct_size;
 YNXAITaskAgentBytesV6 unsigned_original,message_original,network_hex,key_epoch,public_a,public_b,pkcs8_a,pkcs8_b;
} YNXAITaskAgentFixedSignRequestV6;
// Append to SAME sole Auth/Core c-archive, not a second Go runtime.
// Output must remain inventoried on any nonzero result/cleanup !=2.
int32_t YNXAITaskActionAgentFixedSignV6(YNXAITaskAgentFixedSignRequestV6*,uint8_t*,size_t,size_t*,uint32_t*);
#ifdef __cplusplus
}
#endif
