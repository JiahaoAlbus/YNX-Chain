#pragma once
#include "AIMobileWorker.h"
#include <optional>
namespace ynx::mobileai {
// A copied DATA snapshot. It contains no native capability or authorization.
struct NativeIntentDATA {
 std::string operationId,action,method,path;
 std::optional<std::string>taskId,taskRevision,generation,stepId,runId,creationConversationId;
 Bytes bodyOriginal;
};
NativeIntentDATA parseIntentSnapshot(const std::string&);
}
