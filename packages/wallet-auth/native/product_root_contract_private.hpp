#pragma once
#include <algorithm>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <unordered_set>
#include <vector>
namespace ynx::wallet::product {
inline constexpr const char* source_purpose="wallet-native-product-source-v1";
inline constexpr const char* selection_key="walletNativeProductV1";
inline const std::vector<std::string>& allowed_operations(){
 static const std::vector<std::string> value={"createInvoiceIntent","lookupInvoiceIntent","merchantTermsReview","readInvoiceIntent","readInvoice","readInvoiceEvents","reviewSettlement","reviewRefund","reconcileInvoiceIntent","reconcileOperation","readOriginalInvoiceIntent","readInvoiceOriginals","readOriginalArchiveReceipt","readOriginalArchiveReconciliation"};return value;
}
struct ProductReference {std::string product_id,source_order;bool operator==(const ProductReference&o)const{return product_id==o.product_id&&source_order==o.source_order;}};
struct ProductScopeDATA {
 uint32_t version=0;
 std::string network_id,account,protected_resource_ref;
 std::vector<std::string> operations;
 std::vector<ProductReference> products;
};
inline bool ascii_token(const std::string&s,size_t minimum,size_t maximum){
 if(s.size()<minimum||s.size()>maximum)return false;
 auto alnum=[](unsigned char c){return(c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9');};
 if(!alnum(s[0]))return false;
 return std::all_of(s.begin(),s.end(),[&](unsigned char c){return alnum(c)||c=='.'||c=='_'||c==':'||c=='-';});
}
inline bool lowercase_hex(const std::string&s,size_t n){return s.size()==n&&std::all_of(s.begin(),s.end(),[](unsigned char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
inline void validate_scope_data(const ProductScopeDATA&s){
 auto deny=[](){throw std::runtime_error("PRODUCT_SOURCE_SCOPE_INVALID");};
 if(s.version!=1||!lowercase_hex(s.network_id,64)||s.account.size()!=42||s.account.substr(0,2)!="0x"||!lowercase_hex(s.account.substr(2),40)||!ascii_token(s.protected_resource_ref,3,128)||s.operations.empty()||s.operations.size()>allowed_operations().size()||s.products.size()>64)deny();
 std::unordered_set<std::string> ops,products;
 for(const auto&op:s.operations)if(std::find(allowed_operations().begin(),allowed_operations().end(),op)==allowed_operations().end()||!ops.insert(op).second)deny();
 for(const auto&p:s.products){if((p.product_id!="shop.order"&&p.product_id!="cloud.ide-usage")||!ascii_token(p.source_order,3,128)||!products.insert(p.product_id+"/"+p.source_order).second)deny();}
 if(ops.count("readOriginalInvoiceIntent")&&s.products.empty())deny();
}
// Recognizing new operations never inserts them into an old signed scope.
// Permission remains the independent original Source/current math AND only.
}
