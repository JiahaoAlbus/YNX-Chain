#include "MobileCanonicalDATA.hpp"
#include <algorithm>
#include <limits>
namespace ynx::auth::mobile::qualified::data {
namespace {
[[noreturn]]void bad(){throw std::runtime_error("MOBILE_SOURCE_CANONICAL_DATA");}
class Parser{
 const std::vector<uint8_t>&b;size_t p=0,nodes=0;
 uint8_t take(){if(p==b.size())bad();return b[p++];}
 bool literal(const char*s){while(*s)if(take()!=*s++)return false;return true;}
 std::string str(){if(take()!='"')bad();std::string s;while(p<b.size()){auto c=take();if(c=='"')return s;if(c<32)bad();if(c=='\\'){c=take();if(c=='"'||c=='\\')s+=(char)c;else if(c=='b')s+='\b';else if(c=='f')s+='\f';else if(c=='n')s+='\n';else if(c=='r')s+='\r';else if(c=='t')s+='\t';else if(c=='u'){// Canonical JSON uses \u00xx only for controls without short escapes.
 if(take()!='0'||take()!='0'){bad();}
 auto hexchar=[](uint8_t v)->int{if(v>='0'&&v<='9')return v-'0';if(v>='a'&&v<='f')return v-'a'+10;return -1;};int a=hexchar(take()),d=hexchar(take());if(a<0||d<0)bad();int v=a*16+d;if(v>=32||v==8||v==9||v==10||v==12||v==13)bad();s+=(char)v;
 }else bad();}else if(c<128)s+=(char)c;else{// Canonical non-ASCII UTF8, no BOM/overlong/surrogate encodings.
 unsigned left=c>=0xc2&&c<=0xdf?1:c>=0xe0&&c<=0xef?2:c>=0xf0&&c<=0xf4?3:0;if(!left)bad();uint32_t cp=c&((1u<<(6-left))-1);std::string seq(1,(char)c);for(unsigned i=0;i<left;++i){auto x=take();if((x&0xc0)!=0x80)bad();cp=(cp<<6)|(x&63);seq+=(char)x;}if((left==1&&cp<128)||(left==2&&cp<2048)||(left==3&&cp<65536)||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff))bad();s+=seq;}}
 bad();}
 static std::vector<uint16_t>utf16(const std::string&s){std::vector<uint16_t>out;for(size_t i=0;i<s.size();){uint8_t c=(uint8_t)s[i++];uint32_t v=c;if(c>=128){unsigned n=c<0xe0?1:c<0xf0?2:3;v=c&((1u<<(6-n))-1);for(unsigned j=0;j<n;++j)v=(v<<6)|((uint8_t)s[i++]&63);}if(v<=65535)out.push_back((uint16_t)v);else{v-=65536;out.push_back((uint16_t)(0xd800+(v>>10)));out.push_back((uint16_t)(0xdc00+(v&1023)));}}return out;}
 Value value(unsigned depth){if(depth>32||++nodes>32768||p>=b.size())bad();Value v;auto c=b[p];if(c=='{'){take();v.type=Value::object;std::string previous;bool first=true;if(p<b.size()&&b[p]=='}'){take();return v;}while(true){auto key=str();if(!first&&!(utf16(previous)<utf16(key)))bad();first=false;previous=key;if(take()!=':')bad();v.o.emplace(key,value(depth+1));c=take();if(c=='}')break;if(c!=',')bad();}return v;}
 if(c=='['){take();v.type=Value::array;if(p<b.size()&&b[p]==']'){take();return v;}while(true){v.a.push_back(value(depth+1));c=take();if(c==']')break;if(c!=',')bad();}return v;}
 if(c=='"'){v.type=Value::string;v.s=str();return v;}if(c=='t'){if(!literal("true"))bad();v.type=Value::boolean;v.b=true;return v;}if(c=='f'){if(!literal("false"))bad();v.type=Value::boolean;return v;}if(c=='n'){if(!literal("null"))bad();return v;}
 if(c<'0'||c>'9'){bad();}
 v.type=Value::integer;if(c=='0'){take();return v;}while(p<b.size()&&b[p]>='0'&&b[p]<='9'){auto d=take()-'0';if(v.n>(9007199254740991ULL-d)/10)bad();v.n=v.n*10+d;}return v;}
 public:explicit Parser(const std::vector<uint8_t>&input):b(input){}Value parse(){auto v=value(0);if(p!=b.size())bad();return v;}
};
}
Value parseCanonical(const std::vector<uint8_t>&b,size_t maximum){if(b.empty()||b.size()>maximum)bad();return Parser(b).parse();}
std::string canonical(const Value&v){switch(v.type){case Value::nullValue:return "null";case Value::boolean:return v.b?"true":"false";case Value::integer:return std::to_string(v.n);case Value::string:{std::string s="\"";constexpr char h[]="0123456789abcdef";for(unsigned char c:v.s){if(c=='"'||c=='\\'){s+='\\';s+=(char)c;}else if(c==8)s+="\\b";else if(c==9)s+="\\t";else if(c==10)s+="\\n";else if(c==12)s+="\\f";else if(c==13)s+="\\r";else if(c<32){s+="\\u00";s+=h[c>>4];s+=h[c&15];}else s+=(char)c;}return s+'"';}case Value::array:{std::string s="[";bool first=true;for(const auto&i:v.a){if(!first)s+=',';first=false;s+=canonical(i);}return s+']';}case Value::object:{std::string s="{";bool first=true;for(const auto&i:v.o){if(!first)s+=',';first=false;Value key;key.type=Value::string;key.s=i.first;s+=canonical(key)+':'+canonical(i.second);}return s+'}';}}bad();}
uint64_t u64(const std::string&s,bool zero){if(s.empty()||s.size()>20||(s.size()>1&&s[0]=='0'))bad();uint64_t v=0;for(char c:s){if(c<'0'||c>'9'||v>(UINT64_MAX-(c-'0'))/10)bad();v=v*10+(c-'0');}if(!zero&&!v)bad();return v;}
bool hex(const std::string&s,size_t count){return s.size()==count&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
std::vector<uint8_t>unhex(const std::string&s,size_t count){if(!hex(s,count*2))bad();std::vector<uint8_t>b(count);auto d=[](char c){return c<='9'?c-'0':c-'a'+10;};for(size_t i=0;i<count;++i)b[i]=(uint8_t)((d(s[i*2])<<4)|d(s[i*2+1]));return b;}
std::vector<uint8_t>unbase64url(const std::string&s,size_t maximum){if(s.empty()||s.size()%4==1||s.size()>((maximum+2)/3)*4)bad();std::vector<uint8_t>b;uint32_t bits=0;unsigned count=0;for(char c:s){int n=c>='A'&&c<='Z'?c-'A':c>='a'&&c<='z'?c-'a'+26:c>='0'&&c<='9'?c-'0'+52:c=='-'?62:c=='_'?63:-1;if(n<0)bad();bits=(bits<<6)|(uint32_t)n;count+=6;if(count>=8){count-=8;b.push_back((uint8_t)(bits>>count));}}if((count&&(bits&((1u<<count)-1)))||b.size()>maximum)bad();return b;}
}
