#include "AIRecoveryRecordCodecPrivate.hpp"
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
#include <cassert>
#include <cstdio>
using namespace ynx::auth::ai::mobile;
namespace ynx::auth::ai::mobile {
// PUBLIC host adapter only. Production still uses the original OS43 primitive.
std::string originalSHA256(const Bytes&b){unsigned char h[32];
#if defined(__APPLE__)
 CC_SHA256(b.data(),static_cast<CC_LONG>(b.size()),h);
#else
 SHA256(b.data(),b.size(),h);
#endif
 std::string out;const char*x="0123456789abcdef";for(auto v:h){out+=x[v>>4];out+=x[v&15];}return out;}
}
int main(){using namespace recovery;const Bytes empty,p={'P'},m={'M'},r={'R'},receipt={'B'};const std::string nonce(43,'A');Bytes out;
 const Parts absent(p,m,r,empty,{true,true,true,false}),presentEmpty(p,m,r,empty,{true,true,true,true}),present(p,m,r,receipt,{true,true,true,true});unsigned count=0;
 assert(encodeOriginalRecordV1("original-op",nonce,5,absent,out)==0);assert(inspectOriginalRecordV1(out,"original-op",nonce,5,absent)==0);assert(std::string(out.begin(),out.end()).find("\"businessReceipt\":null")!=std::string::npos);const auto missingIndex=out;++count;
 assert(encodeOriginalRecordV1("original-op",nonce,5,presentEmpty,out)==0);assert(out!=missingIndex);assert(inspectOriginalRecordV1(out,"original-op",nonce,5,presentEmpty)==0);assert(inspectOriginalRecordV1(out,"original-op",nonce,5,absent)!=0);assert(inspectOriginalRecordV1(missingIndex,"original-op",nonce,5,presentEmpty)!=0);++count;
 assert(encodeOriginalRecordV1("original-op",nonce,5,present,out)==0);assert(inspectOriginalRecordV1(out,"original-op",nonce,5,present)==0);assert(inspectOriginalRecordV1(out,"original-op",nonce,5,absent)!=0);++count;
 auto before=out;const Parts hiddenReceipt(p,m,r,receipt,{true,true,true,false});assert(encodeOriginalRecordV1("original-op",nonce,5,hiddenReceipt,out)==10401&&out==before);++count;
 const Parts noResponse(p,m,empty,empty,{true,true,false,false});assert(encodeOriginalRecordV1("original-op",nonce,5,noResponse,out)==10401&&out==before);++count;
 const Parts emptyResponse(p,m,empty,empty,{true,true,true,false});assert(encodeOriginalRecordV1("original-op",nonce,5,emptyResponse,out)==10401&&out==before);++count;
 const Parts noMember(p,empty,r,empty,{true,false,true,false});assert(encodeOriginalRecordV1("original-op",nonce,5,noMember,out)==10401&&out==before);++count;
 assert(encodeOriginalRecordV1("original-op",nonce,4,absent,out)==10401&&out==before);assert(inspectOriginalRecordV1(missingIndex,"different-op",nonce,5,absent)!=0);++count;
 std::printf("PUBLIC optional receipt new controls=%u pass=%u fail=0; Source/Root/business/replay=false\n",count,count);
}
