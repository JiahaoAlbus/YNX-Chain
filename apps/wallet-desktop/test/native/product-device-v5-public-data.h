#pragma once
// PUBLIC test DATA only; deliberately not a canonical23/current/crypto grant.
#include "original-product-device-v5-http-call.h"
#include <memory>
#include <cassert>
using namespace ynx_auth_private;
static std::array<uint8_t,32>sha(const std::string&s){std::array<uint8_t,32>out{};
#ifdef __APPLE__
 CC_SHA256(s.data(),static_cast<CC_LONG>(s.size()),out.data());
#else
 SHA256(reinterpret_cast<const uint8_t*>(s.data()),s.size(),out.data());
#endif
 return out;
}
static YNXProductSessionHTTPBytesV5 bytes(const std::string&s){return {reinterpret_cast<const uint8_t*>(s.data()),s.size()};}
template<class F>static void refused(F f){bool failed=false;try{f();}catch(...){failed=true;}assert(failed);}
struct PUBLICFixture {
 HostDirfdJournal journal;ProductDeviceV5OnceBindingDATA binding;std::string registration="PUBLIC original registration bytes, not a grant",original="{\"version\":\"5\",\"PUBLIC\":\"not a canonical23 validation test\"}",body=std::string("binary\0multipart\xff",18),ctype="multipart/form-data; boundary=PUBLIC_5-a";
 std::array<uint8_t,54>derA{};std::array<uint8_t,150>derB{};
 PUBLICFixture(){binding.network.fill(1);binding.session.fill(2);binding.registration=sha(registration);binding.canonicalOwner="0x"+std::string(40,'1');binding.nonce=std::string(32,'N');binding.pkA.fill(3);binding.pkB.fill(4);}
 std::unique_ptr<ProductDeviceV5Once>make(){return std::make_unique<ProductDeviceV5Once>(journal,binding,bytes(registration),bytes(original),bytes(body),bytes(ctype));}
 YNXProductSessionHTTPRequestV5 request(){return {5,sizeof(YNXProductSessionHTTPRequestV5),bytes(original),bytes(body),bytes(ctype),{{binding.network.data(),32},bytes(binding.canonicalOwner),{binding.pkA.data(),2592},{binding.pkB.data(),64}},{derA.data(),derA.size()},{derB.data(),derB.size()},{binding.pkA.data(),2592},{binding.pkB.data(),64}};}
};
