#pragma once
#include "product_session_http.h"
#include "product-session-device-v4-once.h"
#include <array>
#include <limits>
namespace ynx_auth_private {
// PRIVATE same-process Native implementation seam, never a NAPI export or
// factory. Owning Source/registered slot must validate the SAME complete
// expected17/context12/reg20/session4/AbortContext/key pair before private
// entry and after result/current/cleanup. Journal/bytes are NOT that authority.
struct ProductDeviceV4HTTPOutcomeDATA {
 int32_t result=YNX_PRODUCT_SESSION_HTTP_INTERNAL_V4;
 uint32_t cleanup=YNX_PRODUCT_SESSION_HTTP_CLEANUP_UNKNOWN_V4;
 size_t reportedLength=0;
 std::vector<unsigned char>member;
 std::string firstCause;
 bool mathCompleted=false;
 // This helper can never mark a proof usable, admit Source or authorize HTTP.
 static constexpr bool authorized=false,usableHTTP=false;
};
inline ProductDeviceV4HTTPOutcomeDATA invokeOriginalProductDeviceV4HTTPBorrow(
 ProductDeviceV4Once&once,YNXProductSessionHTTPRequestV4&request){
 ProductDeviceV4HTTPOutcomeDATA outcome;
 // Allocate result storage before consuming entry. No sizing invocation and
 // no retry: the actual fixed-purpose C ABI below is the sole private call.
 std::array<uint8_t,YNX_PRODUCT_SESSION_HTTP_MEMBER_CAPACITY_V4>wire{};
 outcome.member.reserve(wire.size());
 once.selectPrimitiveEntry();
 // The local refusal also consumes this original attempt, without calling
 // the foreign primitive. A corrected request may not reuse its reservation.
 if(request.version!=YNX_PRODUCT_SESSION_HTTP_VERSION_V4||request.struct_size!=sizeof(request))throw std::runtime_error("DEVICE_V4_HTTP_LAYOUT_REQUIRED");
 try{outcome.result=YNXProductSessionHTTPProofSignV4(&request,wire.data(),wire.size(),&outcome.reportedLength,&outcome.cleanup);}
 catch(...){outcome.firstCause="DEVICE_V4_HTTP_FOREIGN_EXCEPTION_UNKNOWN";}
 // Capture a bounded public original BEFORE interpreting result/cleanup or
 // invoking persistence/current logic. Nonzero+partial is not permission to
 // retry, assemble a header or send any HTTP request.
 if(outcome.reportedLength<=wire.size())outcome.member.assign(wire.begin(),wire.begin()+outcome.reportedLength);
 else if(outcome.firstCause.empty())outcome.firstCause="DEVICE_V4_HTTP_OUT_LENGTH_UNKNOWN";
 const bool bounded=outcome.reportedLength<=wire.size();
 if(outcome.firstCause.empty()&&(outcome.result!=YNX_PRODUCT_SESSION_HTTP_OK_V4||outcome.cleanup!=YNX_PRODUCT_SESSION_HTTP_CLEANUP_LOGICAL_COMPLETE_V4||outcome.member.empty()))outcome.firstCause="DEVICE_V4_HTTP_RESULT_UNKNOWN";
 // Record UNKNOWN even for a malformed foreign length. Actual numeric result,
 // cleanup and reported length remain in this retained outcome, unnormalized.
 try{once.retainOutcome(outcome.result,outcome.cleanup,outcome.member);}
 catch(const std::exception&e){if(outcome.firstCause.empty())outcome.firstCause=e.what();}
 catch(...){if(outcome.firstCause.empty())outcome.firstCause="DEVICE_V4_HTTP_TERMINAL_UNKNOWN";}
 outcome.mathCompleted=bounded&&outcome.firstCause.empty()&&once.terminalRecordedDATA();
 return outcome;
}
}
