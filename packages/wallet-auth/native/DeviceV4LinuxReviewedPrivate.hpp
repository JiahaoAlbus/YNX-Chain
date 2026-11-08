#pragma once
#include <string>
#include <vector>
#include <cstdint>
namespace ynx::auth::devicev4::linux_release {
// Private reviewed CODE rows, not accepted from stdin/config/JS/renderer.
// Only explicit Root-controlled primary DEVICE/Linux policy8 is permitted.
struct Pin{std::string path,sha256;uint64_t bytes=0;};
struct Row{
 uint32_t roleUID=0;Pin ownImage,node,verifier;std::vector<Pin>wholeRuntime;
 Pin root,enrollment,profile,head,registration,session;
 std::string policyOriginal,nativeNodeOriginal,resourceRef;
 uint32_t timeoutMS=5000;
};
// Empty until independently reviewed authority/resources are actually supplied.
// The normal zeroarg factory cannot install or replace these rows at runtime.
inline std::vector<Row>originalReviewedDeviceV4LinuxRows(){
#ifdef YNX_DEVICE_V4_LINUX_PUBLIC_ROWS_INCLUDE
#include YNX_DEVICE_V4_LINUX_PUBLIC_ROWS_INCLUDE
#else
 return{};
#endif
}
}
