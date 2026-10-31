#pragma once
#include "original-product-device-v5-once.h"
#include <exception>
namespace ynx_auth_private {
struct ProductDeviceV5HTTPOutcomeDATA {
 int32_t result=YNX_HTTP_V5_INTERNAL;uint32_t cleanup=YNX_HTTP_V5_CLEANUP_UNKNOWN;size_t reportedLength=0;
 std::vector<uint8_t>member;std::string firstCause;std::exception_ptr primitiveFailure,persistenceFailure;
 bool primitiveCalled=false,terminalRecorded=false,mathCompleted=false;
 static constexpr bool authorized=false,usableHTTP=false;
};
// PRIVATE same-process fixed-purpose caller. Original Source/current, strict
// canonical unsigned23, full independent expected binding and selected private
// borrow must be supplied/qualified by Main. It grants no HTTP execution.
inline ProductDeviceV5HTTPOutcomeDATA invokeOriginalProductDeviceV5HTTPBorrow(ProductDeviceV5Once&once,YNXProductSessionHTTPRequestV5&request){
 ProductDeviceV5HTTPOutcomeDATA outcome;outcome.member.resize(YNX_PRODUCT_SESSION_HTTP_V5_MEMBER_CAPACITY);outcome.firstCause.reserve(128);
 once.selectPrimitiveEntry();
 try{once.assertOriginalRequestDATA(request);}
 catch(...){outcome.primitiveFailure=std::current_exception();outcome.firstCause="DEVICE_V5_HTTP_LOCAL_ORIGINAL_REFUSED";}
 if(outcome.firstCause.empty()){
  outcome.primitiveCalled=true;
  try{outcome.result=YNXProductSessionHTTPProofSignV5(&request,outcome.member.data(),YNX_PRODUCT_SESSION_HTTP_V5_MEMBER_CAPACITY,&outcome.reportedLength,&outcome.cleanup);}
  catch(...){outcome.primitiveFailure=std::current_exception();outcome.firstCause="DEVICE_V5_HTTP_FOREIGN_EXCEPTION_UNKNOWN";}
 }
 // The output allocation IS the retained public buffer. Shrinking cannot
 // allocate. On an invalid reported length keep its entire bounded prefix;
 // it is uncertain partial DATA, never a completed Member or sizing request.
 const bool bounded=outcome.reportedLength<=outcome.member.size();
 outcome.member.resize(std::min(outcome.reportedLength,outcome.member.size()));
 if(outcome.firstCause.empty()&&!bounded)outcome.firstCause="DEVICE_V5_HTTP_OUT_LENGTH_UNKNOWN";
 if(outcome.firstCause.empty()&&(outcome.result!=YNX_HTTP_V5_OK||outcome.cleanup!=YNX_HTTP_V5_CLEANUP_LOGICAL_COMPLETE||outcome.member.empty()))outcome.firstCause="DEVICE_V5_HTTP_RESULT_UNKNOWN";
 try{once.retainOutcome(outcome.result,outcome.cleanup,outcome.reportedLength,outcome.member,outcome.primitiveCalled,outcome.firstCause);outcome.terminalRecorded=once.terminalRecordedDATA();}
 catch(...){outcome.persistenceFailure=once.persistenceFailureDATA();if(!outcome.persistenceFailure)outcome.persistenceFailure=std::current_exception();if(outcome.firstCause.empty())outcome.firstCause="DEVICE_V5_HTTP_TERMINAL_UNKNOWN";}
 outcome.mathCompleted=outcome.primitiveCalled&&bounded&&outcome.firstCause.empty()&&outcome.terminalRecorded;
 return outcome;
}
}
