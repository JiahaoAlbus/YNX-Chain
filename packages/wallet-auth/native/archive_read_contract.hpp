#pragma once
#include <optional>
#include <string>
#include <string_view>
#include <vector>

// AUTH PRIVATE DATA ONLY. These checks do NOT qualify Source, consent, money,
// invoice ownership or a caller. The independent original qualifier must AND
// them with its signed scope, protected resource map and actual current loan.
namespace ynx::wallet::product::archive_data {
inline constexpr std::string_view receipt_op="readOriginalArchiveReceipt";
inline constexpr std::string_view reconciliation_op="readOriginalArchiveReconciliation";
inline constexpr std::string_view operations[]={
 "createInvoiceIntent","lookupInvoiceIntent","merchantTermsReview","readInvoiceIntent",
 "readInvoice","readInvoiceEvents","reviewSettlement","reviewRefund","reconcileInvoiceIntent",
 "reconcileOperation","readOriginalInvoiceIntent","readInvoiceOriginals",receipt_op,reconciliation_op};
struct Ref {
 std::string product_id, source_order, merchant, invoice_id;
 std::optional<std::string> native_hash;
};
inline bool identifier(std::string_view s) {
 if(s.size()<3||s.size()>128)return false;
 const auto alnum=[](char c){return(c>='A'&&c<='Z')||(c>='a'&&c<='z')||(c>='0'&&c<='9');};
 if(!alnum(s.front()))return false;
 for(char c:s)if(!alnum(c)&&c!='.'&&c!='_'&&c!=':'&&c!='-')return false;
 return true;
}
inline bool hex(std::string_view s,size_t digits) {
 if(s.size()!=digits+2||s.substr(0,2)!="0x")return false;
 for(char c:s.substr(2))if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;
 return true;
}
inline bool known_operation(std::string_view op) {
 for(auto known:operations)if(known==op)return true;
 return false;
}
inline bool declared_operation_DATA(const std::vector<std::string>& signed_ops,std::string_view requested) {
 if(!known_operation(requested))return false;
 for(const auto& op:signed_ops)if(op==requested)return true;
 return false;
}
inline bool valid_ref(std::string_view op,const Ref&r) {
 if((op!=receipt_op&&op!=reconciliation_op)||(r.product_id!="shop.order"&&r.product_id!="cloud.ide-usage")||
    !identifier(r.source_order)||!identifier(r.invoice_id)||!hex(r.merchant,40))return false;
 return op==receipt_op?(r.native_hash&&hex(*r.native_hash,64)):!r.native_hash;
}
inline std::string segment(std::string_view s) {
 // All accepted identifier characters are encodeURIComponent-safe except ':'.
 std::string out;for(char c:s){if(c==':')out+="%3A";else out+=c;}return out;
}
inline std::optional<std::string> fixed_path_DATA(std::string_view op,const Ref&r) {
 if(!valid_ref(op,r))return std::nullopt;
 std::string p="/v5/pay/products/"+segment(r.product_id)+"/"+segment(r.source_order)+
   "/invoices/"+r.merchant+"/"+segment(r.invoice_id);
 if(op==receipt_op)p+="/originals/"+*r.native_hash+"/receipt";
 else p+="/archive-reconciliation";
 return p;
}
}
