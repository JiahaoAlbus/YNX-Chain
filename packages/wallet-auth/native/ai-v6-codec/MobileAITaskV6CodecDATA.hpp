#pragma once
#include "MobileAITaskRuntimePrivate.h"
#include <cstdint>
#include <string>
#include <optional>
#include <vector>
namespace ynx::sdk::ai::v6::data {
using Bytes=std::vector<uint8_t>;
// Pure DATA. Throws std::exception on malformed/cross-bound inputs. Never signs,
// acquires a peer/Source/key, reads a clock, or implements Prepared inventory.
// Canonical35/16 original bytes remain unchanged; request body is hashed raw.
Bytes encodeRequestMessage(const Bytes&canonical35,const std::string&networkHex,const Bytes&bodyOriginal);
Bytes encodeResponseMessage(const Bytes&canonical16,const std::string&networkHex);
// Revalidates a caller-built canonical35 and exact E5; this is the helper the
// Native worker's Prepared producer calls before adopting its own inventory.
struct PreparedDATA {Bytes unsignedOriginal,messageOriginal;};
// Root/peer producer supplies these independently captured fields. Fixed mobile
// identity/version are encoded by the sole contract, not inferred as admitted.
struct RequestFields {
 std::string platform,sessionBinding,account,canonicalOwner,deviceId,deviceRegistrationId,deviceRegistrationRevision,deviceRegistrationDigest;
 std::string method,path,nonce,issuedAt,expiresAt,audience,action,holder,operationId,policyRevision;
 std::optional<std::string> taskId,taskRevision,generation,stepId,runId,creationConversationId;
};
PreparedDATA buildRequestDATA(const RequestFields&,const std::string&networkHex,const Bytes&bodyOriginal);
PreparedDATA prepareRequestDATA(const Bytes&canonical35,const std::string&networkHex,const Bytes&bodyOriginal);
}
// Exact two existing strong symbols declared by Auth RuntimePrivate.h are
// implemented by MobileAITaskV6CodecDATA.cpp. 0=DATA equality; nonzero=invalid
// or primitive unavailable. No success is Root/Source/Native authorization.
