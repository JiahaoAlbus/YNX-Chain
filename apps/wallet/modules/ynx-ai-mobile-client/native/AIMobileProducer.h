#pragma once
#include "AIMobileWorker.h"
#include "auth/AIMobileV6ProducerPrivate.h"
#include <atomic>
#include <memory>
#include <string>
namespace ynx::mobileai {
/* Native CxxModule-only context acquisition, after actual intrinsic Source
 * recognition. No JS pointer/DTO address/provider is a context or Source. */
struct ContextAcquisition {YNXAIMobileSDKContext*owner=nullptr;Failure failure{};};
ContextAcquisition captureOriginalContext(YNXAuthAIMobileOwnerV6*,uint64_t nativeRuntime,std::shared_ptr<std::atomic<bool>>runtimeLife)noexcept;
void cancelOriginalContext(YNXAIMobileSDKContext*)noexcept;
bool isOriginalContext(YNXAIMobileSDKContext*,YNXAuthAIMobileOwnerV6*,uint64_t nativeRuntime)noexcept;
Failure closeOriginalContext(YNXAIMobileSDKContext*)noexcept;
bool closeOriginalContextsForSource(YNXAuthAIMobileOwnerV6*)noexcept;
/* Only the actual worker invokes these immediately after its C17 call. There
 * is no exported registration/setter and no independent caller approval. */
Failure bindOriginalReview(YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,YNXAuthAIMobileOwnerV6*source,YNXAuthAIMobileOwnerV6*review,Failure callFailure)noexcept;
Failure bindOriginalOperation(YNXAIMobileSDKPeer*,YNXAIMobileSDKContext*,YNXAuthAIMobileOwnerV6*source,YNXAuthAIMobileOwnerV6*review,YNXAuthAIMobileOwnerV6*operation,Failure callFailure)noexcept;
Failure originalProducersCloseFailureForSource(YNXAuthAIMobileOwnerV6*)noexcept;
bool closeOriginalProducersForSource(YNXAuthAIMobileOwnerV6*)noexcept;
struct ProducerSnapshot {
 std::string operationId,action,method,path,originURL;
 Bytes bodyOriginal,unsignedOriginal,messageOriginal;
 bool prepared=false,proved=false,dispatchEntered=false,closed=false;
 Failure originalFailure{},closeFailure{};
};
Failure readOriginalProducerSnapshot(YNXAIMobileProducerV6*,ProducerSnapshot&)noexcept;
struct ResponseSnapshot {uint32_t status=0;std::vector<std::pair<std::string,std::string>>headers;Bytes bodyOriginal;bool complete=false;Bytes declarationOriginal;};
Failure readOriginalResponseSnapshot(YNXAIMobileProducerV6*,ResponseSnapshot&)noexcept;
}
