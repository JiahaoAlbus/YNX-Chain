#import <Foundation/Foundation.h>
#include "pay_root_transport_private.hpp"
#include <set>
#include <cmath>
#include <cstring>
namespace ynx::wallet::pay::root_physical {
namespace {
bool keys(id x,NSArray<NSString*>*expected){return [x isKindOfClass:NSDictionary.class]&&[NSSet setWithArray:[x allKeys]].count==expected.count&&[[NSSet setWithArray:[x allKeys]]isEqualToSet:[NSSet setWithArray:expected]];}
bool text(id x,size_t max,std::string&out){if(![x isKindOfClass:NSString.class])return false;NSData*d=[x dataUsingEncoding:NSUTF8StringEncoding];if(!d||!d.length||d.length>max||memchr(d.bytes,0,d.length))return false;out.assign((const char*)d.bytes,d.length);for(unsigned char c:out)if(c<0x21||c>0x7e)return false;return true;}
bool number(id x,uint64_t min,uint64_t max,uint64_t&out){if(![x isKindOfClass:NSNumber.class]||CFGetTypeID((__bridge CFTypeRef)x)==CFBooleanGetTypeID())return false;double n=[x doubleValue];if(!std::isfinite(n)||n<min||n>max||std::floor(n)!=n)return false;out=[x unsignedLongLongValue];return true;}
bool decimal(id x,uint64_t max,uint64_t&out){std::string s;if(!text(x,20,s)||(s.size()>1&&s[0]=='0'))return false;out=0;for(char c:s){if(c<'0'||c>'9'||out>(max-uint64_t(c-'0'))/10)return false;out=out*10+uint64_t(c-'0');}return out<=max;}
bool path(const std::string&s){if(s.empty()||s[0]!='/'||s.find('%')!=s.npos||s.find('?')!=s.npos||s.find('#')!=s.npos||s.find('\\')!=s.npos||s.find("//")!=s.npos)return false;size_t at=1;while(at<=s.size()){size_t end=s.find('/',at);if(end==s.npos)end=s.size();auto part=s.substr(at,end-at);if(part=="."||part=="..")return false;at=end+1;}return true;}
}
Code read_pay_transport_original_v1(PublicOriginalHold&held,const std::string&ref,TransportProfile&out)noexcept{
 try{@autoreleasepool{@try{
  std::vector<unsigned char>raw;Code c=held.read_original(raw);if(c!=Code::ok)return c;
  if(raw.empty()||raw.size()>65536||ref.empty()||ref.size()>256)return Code::content;
  NSData*d=[NSData dataWithBytes:raw.data() length:raw.size()];NSError*e=nil;id root=[NSJSONSerialization JSONObjectWithData:d options:0 error:&e];
  if(e||!keys(root,@[@"version",@"protectedResourceRef",@"socketPath",@"service",@"peerUID",@"peerPID",@"routes",@"timeoutMS",@"maxHeaderBytes",@"maxResponseBytes"]))return Code::content;
  NSData*canonical=[NSJSONSerialization dataWithJSONObject:root options:NSJSONWritingSortedKeys|NSJSONWritingWithoutEscapingSlashes error:&e];if(e||![d isEqualToData:canonical])return Code::content;
  TransportProfile p;uint64_t n=0;if(!number(root[@"version"],1,1,n)||!text(root[@"protectedResourceRef"],256,p.protected_resource_ref)||p.protected_resource_ref!=ref||!text(root[@"socketPath"],103,p.socket_path)||!path(p.socket_path)||!text(root[@"service"],128,p.service)||!decimal(root[@"peerUID"],UINT32_MAX,n))return Code::content;p.peer_uid=uint32_t(n);
  if(!decimal(root[@"peerPID"],INT32_MAX,n)||!n)return Code::content;p.peer_pid=int32_t(n);
  if(!number(root[@"timeoutMS"],1,30000,p.timeout_ms)||!number(root[@"maxHeaderBytes"],1,65536,p.maximum_header_bytes)||!number(root[@"maxResponseBytes"],1,1048576,p.maximum_response_bytes)||![root[@"routes"]isKindOfClass:NSArray.class]||[root[@"routes"]count]!=5)return Code::content;
  for(unsigned i=0;i<5;i++){id r=root[@"routes"][i];auto&v=p.routes[i];if(!keys(r,@[@"index",@"enabled",@"method",@"path",@"maxBodyBytes",@"timeoutMS"])||!number(r[@"index"],i,i,n)||CFGetTypeID((__bridge CFTypeRef)r[@"enabled"])!=CFBooleanGetTypeID()||!text(r[@"method"],4,v.method)||v.method!=(i<3?"POST":"GET")||!text(r[@"path"],2048,v.path)||!path(v.path)||!number(r[@"maxBodyBytes"],0,i<3?1048576:0,v.maximum_body_bytes)||!number(r[@"timeoutMS"],1,p.timeout_ms,v.timeout_ms))return Code::content;v.enabled=[r[@"enabled"]boolValue];}
  std::set<std::string>distinct;for(const auto&r:p.routes)if(r.enabled&&!distinct.insert(r.method+" "+r.path).second)return Code::content;
  c=held.current();if(c!=Code::ok)return c;out=std::move(p);return Code::ok;
 }@catch(id){return Code::content;}}}catch(...){return Code::io;}
}
}
