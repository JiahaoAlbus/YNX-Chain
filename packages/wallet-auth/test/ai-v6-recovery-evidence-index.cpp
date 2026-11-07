#include "AIRecoveryRecordCodecPrivate.hpp"
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#elif defined(__linux__)
#include <openssl/sha.h>
#else
#error "PUBLIC recovery DATA test supports Apple CommonCrypto or Linux OpenSSL only"
#endif
#include <cassert>
#include <cstdio>
#include <stdexcept>
#include <algorithm>
using namespace ynx::auth::ai::mobile;
namespace ynx::auth::ai::mobile {
// PUBLIC host DATA test seam only. Not the mobile OS43/Root implementation.
std::string originalSHA256(const Bytes&b){unsigned char h[32];
#if defined(__APPLE__)
CC_SHA256(b.data(),static_cast<CC_LONG>(b.size()),h);
#elif defined(__linux__)
SHA256(b.data(),b.size(),h);
#endif
std::string s;const char*x="0123456789abcdef";for(auto a:h){s+=x[a>>4];s+=x[a&15];}return s;}
}
using namespace recovery;
int main(){
 unsigned count=0;Bytes empty,p={'P'},m={'M'},r={'R'},receipt;
 const std::string op="PUBLIC-operation-001",nonce(43,'A');Bytes out;
 auto claim=Parts(empty,empty,empty,empty,{false,false,false,false});
 assert(encodeOriginalRecordV1(op,"",1,claim,out)==0);assert(inspectOriginalRecordV1(out,op,"",1,claim)==0);assert(std::string(out.begin(),out.end()).find("\"nonce\":null")!=std::string::npos);++count;
 auto before=out;assert(encodeOriginalRecordV1(op,nonce,1,claim,out)!=0&&out==before);++count;
 auto prepared=Parts(p,empty,empty,empty,{true,false,false,false});assert(encodeOriginalRecordV1(op,nonce,2,prepared,out)==0);assert(inspectOriginalRecordV1(out,op,nonce,2,prepared)==0);++count;
 auto partial=Parts(p,empty,empty,empty,{true,true,false,false});assert(encodeOriginalRecordV1(op,nonce,3,partial,out)==0);assert(std::string(out.begin(),out.end()).find("\"bytes\":\"0\"")!=std::string::npos);assert(inspectOriginalRecordV1(out,op,nonce,3,prepared)!=0);++count;
 assert(encodeOriginalRecordV1(op,nonce,4,partial,out)!=0);++count;
 auto verified=Parts(p,m,empty,empty,{true,true,false,false});assert(encodeOriginalRecordV1(op,nonce,4,verified,out)==0);++count;
 r.assign(2*1048576,'R');receipt.assign(1048576,'B');auto terminal=Parts(p,m,r,receipt,{true,true,true,true});assert(encodeOriginalRecordV1(op,nonce,5,terminal,out)==0);assert(out.size()<16384);assert(inspectOriginalRecordV1(out,op,nonce,5,terminal)==0);++count;
 auto raw=out;raw.insert(raw.end()-1,',');assert(inspectOriginalRecordV1(raw,op,nonce,5,terminal)!=0);++count;
 r[0]='S';assert(inspectOriginalRecordV1(out,op,nonce,5,terminal)!=0);r[0]='R';++count;
 assert(inspectOriginalRecordV1(out,"PUBLIC-wrong-operation",nonce,5,terminal)!=0);assert(inspectOriginalRecordV1(out,op,std::string(43,'B'),5,terminal)!=0);assert(inspectOriginalRecordV1(out,op,nonce,4,terminal)!=0);++count;
 auto absent=Parts(p,m,r,receipt,{true,true,true,false});assert(encodeOriginalRecordV1(op,nonce,5,absent,out)!=0);++count;
 receipt.clear();assert(encodeOriginalRecordV1(op,nonce,5,terminal,out)==0);const auto presentEmpty=out;auto missing=Parts(p,m,r,receipt,{true,true,true,false});assert(inspectOriginalRecordV1(presentEmpty,op,nonce,5,missing)!=0);++count;
 before=out;assert(encodeOriginalRecordV1(op,"not-canonical",2,prepared,out)!=0&&out==before);++count;
 Bytes oversize(16385,' ');assert(inspectOriginalRecordV1(oversize,op,nonce,5,terminal)!=0);++count;
 assert(encodeOriginalRecordV1(std::string("bad\xc0\xaf",5),nonce,2,prepared,out)!=0);assert(encodeOriginalRecordV1(std::string("bad\xed\xa0\x80",6),nonce,2,prepared,out)!=0);++count;
 assert(encodeOriginalRecordV1(op,nonce,0,prepared,out)!=0);assert(encodeOriginalRecordV1(op,nonce,6,prepared,out)!=0);++count;
 std::printf("PUBLIC RecoveryEvidenceIndexV1 controls=%u pass=%u fail=0; mobileOS/Source/Root/receiptVerified=false\n",count,count);
}
