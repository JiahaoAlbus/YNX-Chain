#include "AIResponseOutcomeOriginalsDATA.hpp"
#include "MobileSourceMath.hpp"
#include <iostream>
#include <functional>
#include <stdexcept>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
// PUBLIC host adapter for the original Auth SHA ABI. Not production crypto.
namespace ynx::auth::mobile::qualified {
std::string originalSHA256(const Bytes&b){unsigned char out[32];
#ifdef __APPLE__
 CC_SHA256(b.data(),static_cast<CC_LONG>(b.size()),out);
#else
 SHA256(b.data(),b.size(),out);
#endif
 constexpr char h[]="0123456789abcdef";std::string s;for(auto v:out){s+=h[v>>4];s+=h[v&15];}return s;}
}
using namespace ynx::sdk::ai::v6;
Bytes bytes(const std::string&s){return Bytes(s.begin(),s.end());}
void check(bool v){if(!v)throw std::runtime_error("PUBLIC_CONTROL_ASSERT");}
void reject(const std::function<void()>&f,const std::string&part){bool got=false;try{f();}catch(const std::exception&e){got=std::string(e.what()).find(part)!=std::string::npos;}check(got);}
int main(){int passed=0;auto run=[&](const char*n,const std::function<void()>&f){f();++passed;std::cout<<"PASS "<<n<<'\n';};
 const std::string ref="auth-task-action-v6:"+std::string(64,'a');
 auto metadata=bytes("{\"action\":\"task.create\",\"businessAction\":\"create-task\",\"completionScope\":\"PRODUCT_LOCAL_COMMIT_ONLY\",\"requestRef\":\""+ref+"\",\"state\":\"COMMITTED\"}");
 auto receipt=bytes("{\"originalOperationId\":\"PUBLIC\\u003cop\",\"requestRef\":\""+ref+"\",\"state\":\"COMMITTED\"}");
 auto body=bytes("PUBLIC exact production-writer body");OriginalResponseBindingDATA e;e.action="task.create";e.state="COMMITTED";e.requestRef=ref;e.bodyDigest=ynx::auth::mobile::qualified::originalSHA256(body);e.bodyBytes=std::to_string(body.size());
 run("private metadata5 + opaque Go receipt copied unchanged DATA",[&]{auto o=copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,body,e);check(o.metadataOriginal==metadata&&o.businessReceiptOriginal==receipt&&o.bodyOriginal==body);check(!o.RootAdmission&&!o.SourceAdmission&&!o.receiptProvenanceVerified&&!o.completionSemanticsVerified&&!o.responseProofVerified);});
 run("caller buffer mutation cannot mutate copied originals",[&]{auto r=receipt;auto o=copyAIResponseOutcomeOriginalsV6DATA(metadata,r,body,e);r[0]^=1;check(o.businessReceiptOriginal==receipt);});
 run("HTTP proof/status alone never manufactures receipt",[&]{reject(requireAIResponseBusinessOutcomeSourceV6,"SOURCE_NOT_SUPPLIED");reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,{},body,e);},"SOURCE_NOT_SUPPLIED");});
 run("foreign original action refused",[&]{auto b=e;b.action="task.cancel";reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,body,b);},"RESPONSE_BINDING");});
 run("foreign same-op requestRef refused",[&]{auto b=e;b.requestRef=ref+"other";reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,body,b);},"RESPONSE_BINDING");});
 run("body byte or signed length drift refused",[&]{auto b=body;b[0]^=1;reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,b,e);},"BODY_BINDING");auto x=e;x.bodyBytes="0";reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,body,x);},"BODY_BINDING");});
 run("BOM and duplicate metadata keys refused by sole parser",[&]{auto b=metadata;b.insert(b.begin(),{0xef,0xbb,0xbf});reject([&]{copyAIResponseOutcomeOriginalsV6DATA(b,receipt,body,e);},"CANONICAL_DATA");auto s=std::string(metadata.begin(),metadata.end());s.insert(1,"\"action\":\"task.create\",");reject([&]{copyAIResponseOutcomeOriginalsV6DATA(bytes(s),receipt,body,e);},"CANONICAL_DATA");});
 run("metadata unknown extra field refused",[&]{auto s=std::string(metadata.begin(),metadata.end());s.insert(s.size()-1,",\"z\":false");reject([&]{copyAIResponseOutcomeOriginalsV6DATA(bytes(s),receipt,body,e);},"CLOSED_KEYS");});
 run("LINK2MiB distinct from actual Auth1MiB no truncation",[&]{Bytes b(responseAuthBodyCap+1,'x');reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,b,e);},"AUTH_RESPONSE_BODY_LIMIT_NOT_SUPPORTED");b.resize(responseHTTPBodyCap+1);reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,receipt,b,e);},"LINK_RESPONSE_BODY_LIMIT");});
 run("receipt1MiB and metadata16KiB caps exact",[&]{Bytes b(businessReceiptCap+1,'x');reject([&]{copyAIResponseOutcomeOriginalsV6DATA(metadata,b,body,e);},"BUSINESS_RECEIPT_LIMIT");b.assign(outcomeMetadataCap+1,'x');reject([&]{copyAIResponseOutcomeOriginalsV6DATA(b,receipt,body,e);},"CANONICAL_DATA");});
 run("UNKNOWN preserves nullable ref and absent receipt",[&]{auto m=bytes("{\"action\":\"task.create\",\"businessAction\":null,\"completionScope\":null,\"requestRef\":null,\"state\":\"UNKNOWN\"}");auto b=e;b.state="UNKNOWN";b.requestRef.reset();auto o=copyAIResponseOutcomeOriginalsV6DATA(m,{},body,b);check(o.businessReceiptOriginal.empty()&&!o.SourceAdmission);b.requestRef=std::string();reject([&]{copyAIResponseOutcomeOriginalsV6DATA(m,{},body,b);},"RESPONSE_BINDING");});
 run("unsorted Go carrier is not misparsed as canonical metadata",[&]{auto carrier=bytes("{\"handle\":\"1\",\"kind\":\"outcome\",\"metadata\":{},\"bodyOriginal\":\"\",\"receiptOriginal\":\"\"}");reject([&]{copyAIResponseOutcomeOriginalsV6DATA(carrier,receipt,body,e);},"CANONICAL_DATA");});
 std::cout<<"NEW_PUBLIC_DATA_CONTROLS="<<passed<<" Root/Source/Native=false\n";return 0;}
