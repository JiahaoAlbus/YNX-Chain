#pragma once
#include "MobileSecure43.h"
#include <array>
#include <string>
namespace ynx::mobilepq::os43 {
enum Code:int32_t {ok=0,invalid=9101,unsupported=9102,denied=9103,missing=9104,exists=9105,
 changed=9106,closed=9107,wrongThread=9108,cancelled=9109,unknown=9110,io=9111,bounds=9112};
using Credential=std::array<uint8_t,43>;
using Metadata=std::array<uint8_t,88>;
void wipe(void*,size_t)noexcept;
bool canonical(const Credential&);
bool valid(const YNXMobileOS43Descriptor&);
Metadata metadata(const YNXMobileOS43Descriptor&);
std::string itemID(const YNXMobileOS43Descriptor&);
/* Strong platform implementations, never caller-provided function tables.
 * OS UI may wait on main, but these run on the native custody actor. */
int32_t platformRead(const YNXMobileOS43Descriptor&,Credential&,YNXMobileOS43Protection&);
int32_t platformCurrent(const YNXMobileOS43Descriptor&,const YNXMobileOS43Protection&);
int32_t platformInput(const YNXMobileOS43Descriptor&,Credential&);
struct Effect {int32_t code;bool possible;};
Effect platformImportAbsent(const YNXMobileOS43Descriptor&,const Credential&);
Effect platformRemoveExact(const YNXMobileOS43Descriptor&);
int32_t platformSHA256(const uint8_t*,size_t,uint8_t*);
// ref digest = SHA256(domain+NUL+u32BE(binding.length)+binding+u64BE(revision)).
int32_t validateIdentity(const YNXMobileOS43Descriptor&);
}
