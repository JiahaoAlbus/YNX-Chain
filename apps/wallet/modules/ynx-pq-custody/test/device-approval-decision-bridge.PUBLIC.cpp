#include "DeviceApprovalDecisionBridge.hpp"
#include <cassert>
#include <cstring>
#include <thread>

using ynx::wallet::device_approval::DecisionBridge;
namespace {
bool exceptionPending=false, failAck=false, failCurrent=false, currentValue=true;
int ackCalls=0, currentCalls=0, clears=0;
jobject expectedReview=reinterpret_cast<jobject>(1);
jstring expectedOperation=reinterpret_cast<jstring>(2);
jbyteArray expectedBinding=reinterpret_cast<jbyteArray>(3);
jclass getClass(JNIEnv*, jobject review) { assert(review==expectedReview); return reinterpret_cast<jclass>(4); }
jmethodID getMethod(JNIEnv*, jclass, const char* name, const char* signature) {
    if (!std::strcmp(name,"acknowledgeInsertedClaim")) { assert(!std::strcmp(signature,"()V")); return reinterpret_cast<jmethodID>(5); }
    assert(!std::strcmp(name,"originalClaimCurrent") && !std::strcmp(signature,"(Ljava/lang/String;[B)Z"));
    return reinterpret_cast<jmethodID>(6);
}
jboolean exceptionCheck(JNIEnv*) { return exceptionPending ? JNI_TRUE : JNI_FALSE; }
void exceptionClear(JNIEnv*) { exceptionPending=false; ++clears; }
void deleteRef(JNIEnv*, jobject) { }
void callVoid(JNIEnv*, jobject review, jmethodID method, va_list) {
    assert(review==expectedReview && method==reinterpret_cast<jmethodID>(5));
    ++ackCalls; exceptionPending=failAck;
}
jboolean callBoolean(JNIEnv*, jobject review, jmethodID method, va_list args) {
    assert(review==expectedReview && method==reinterpret_cast<jmethodID>(6));
    assert(va_arg(args,jstring)==expectedOperation && va_arg(args,jbyteArray)==expectedBinding);
    ++currentCalls; exceptionPending=failCurrent; return currentValue ? JNI_TRUE : JNI_FALSE;
}
void reset() { exceptionPending=failAck=failCurrent=false; currentValue=true; ackCalls=currentCalls=clears=0; }
}
int main() {
    JNINativeInterface_ functions{};
    functions.GetObjectClass=getClass; functions.GetMethodID=getMethod;
    functions.ExceptionCheck=exceptionCheck; functions.ExceptionClear=exceptionClear;
    functions.DeleteLocalRef=deleteRef; functions.CallVoidMethodV=callVoid; functions.CallBooleanMethodV=callBoolean;
    JNIEnv_ env{&functions};
    reset();
    {
        DecisionBridge bridge(&env,expectedReview,expectedOperation,expectedBinding);
        assert(!bridge.current() && currentCalls==0);
        assert(bridge.acknowledgeInsertedClaim() && ackCalls==1);
        assert(!bridge.acknowledgeInsertedClaim() && ackCalls==1);
        assert(bridge.current() && currentCalls==1);
        currentValue=false; assert(!bridge.current());
        failCurrent=true; assert(!bridge.current() && clears==1);
        bool other=true; std::thread wrong([&]{other=bridge.current();}); wrong.join(); assert(!other && currentCalls==3);
    }
    reset(); failAck=true;
    {
        DecisionBridge bridge(&env,expectedReview,expectedOperation,expectedBinding);
        assert(!bridge.acknowledgeInsertedClaim() && ackCalls==1 && clears==1);
        failAck=false;
        assert(!bridge.acknowledgeInsertedClaim() && !bridge.current() && ackCalls==1 && currentCalls==0);
    }
}
