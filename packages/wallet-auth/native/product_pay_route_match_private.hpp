#pragma once
#include "product_pay_routes_private.hpp"
#include <string_view>
#include <vector>
namespace ynx::wallet::product {
namespace route_private {
inline bool lower_hex(std::string_view s,size_t n){
 if(s.size()!=n)return false;for(char c:s)if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))return false;return true;
}
inline bool alnum(char c,bool upper){return(c>='0'&&c<='9')||(c>='a'&&c<='z')||(upper&&c>='A'&&c<='Z');}
inline bool id(std::string_view s,bool archive){
 // Exact producer grammar: ordinary invoice IDs are 1..64 lowercase,
 // archive IDs are 3..128 mixed-case. Only archive encodeURIComponent
 // escapes ':' as uppercase %3A. Other percent encodings are noncanonical.
 size_t decoded=0;bool first=true;
 for(size_t i=0;i<s.size();++i){char c=s[i];bool escaped=false;
  if(c=='%'){if(!archive||i+2>=s.size()||s.substr(i,3)!="%3A")return false;c=':';i+=2;escaped=true;}
  if(first){if(!alnum(c,archive))return false;first=false;}
  else if(!(alnum(c,archive)||c=='.'||c=='_'||c=='-'||c==':'))return false;
  // A raw ':' is not what the archive producer's encodeURIComponent emits.
  if(archive&&c==':'&&!escaped)return false;
  ++decoded;
 }
 return decoded>=(archive?3u:1u)&&decoded<=(archive?128u:64u);
}
inline bool operand(std::string_view label,std::string_view value,bool archive){
 if(label=="{intentId}")return value.size()==52&&value.substr(0,4)=="npi_"&&lower_hex(value.substr(4),48);
 if(label=="{merchant}")return value.size()==42&&value.substr(0,2)=="0x"&&lower_hex(value.substr(2),40);
 if(label=="{nativeHash}")return value.size()==66&&value.substr(0,2)=="0x"&&lower_hex(value.substr(2),64);
 if(label=="{productId}")return value=="shop.order"||value=="cloud.ide-usage";
 if(label=="{sourceOrder}")return id(value,true);
 if(label=="{invoiceId}")return id(value,archive);
 return false;
}
inline std::vector<std::string_view> segments(std::string_view p){
 std::vector<std::string_view> out;if(p.empty()||p[0]!='/')return out;
 size_t start=1;for(size_t i=1;i<=p.size();++i)if(i==p.size()||p[i]=='/'){if(i==start)return {};out.push_back(p.substr(start,i-start));start=i+1;}return out;
}
}
// DATA restriction only. This does not authorize any route or refresh Root.
inline bool product_pay_request_matches_v1(uint32_t op,std::string_view method,
 std::string_view request_path,std::string_view content_type,size_t body_bytes){
 if(op>=product_pay_routes_v1.size()||op==10||request_path.size()>4096)return false;
 for(unsigned char c:request_path)if(c<0x21||c>0x7e||c=='?'||c=='#'||c=='\\')return false;
 const auto& r=product_pay_routes_v1[op];if(method!=r.method)return false;
 if(r.body){if(content_type!="application/json"||!body_bytes||body_bytes>product_pay_request_max_v1)return false;}
 else if(!content_type.empty()||body_bytes)return false;
 const auto expected=route_private::segments(r.path),actual=route_private::segments(request_path);
 if(expected.size()!=actual.size())return false;
 for(size_t i=0;i<actual.size();++i){
  if(!expected[i].empty()&&expected[i].front()=='{'){if(!route_private::operand(expected[i],actual[i],op>=12))return false;}
  else if(expected[i]!=actual[i])return false;
 }
 return true;
}
}
