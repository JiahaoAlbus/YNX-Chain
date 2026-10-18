#pragma once
#include "original-ide-parent-lifetime.h"
#include <array>
#include <cstring>
#include <stdexcept>
#include <cstddef>

namespace ynx_auth_ide_private {
// Fixed Native-only prefix; NOT a signature frame/Root purpose or a grant.
// The installed JSON line begins only AFTER NodeReady. The exact-size reader
// cannot consume one byte of that line. No post-handoff payload I/O is legal.
enum class PreludeKind:std::uint32_t { prepareIDE=1,pendingIDE=2,adoptNode=3,acquireNode=4,readyNode=5,retire=6 };
struct Prelude {
 PreludeKind kind;std::array<unsigned char,32> source{},challenge{};
 std::array<unsigned char,32> audit{};std::array<char,43> intent{};
 std::array<unsigned char,32> ideAudit{},nodeAudit{};
 ProcessOriginal wallet{},ide{},node{};
};
using PreludeBytes=std::array<unsigned char,384>;
inline void put64(unsigned char*p,std::uint64_t v){for(int i=7;i>=0;i--){p[i]=(unsigned char)v;v>>=8;}}
inline std::uint64_t get64(const unsigned char*p){std::uint64_t v=0;for(unsigned i=0;i<8;i++)v=(v<<8)|p[i];return v;}
inline void putProcess(unsigned char*p,const ProcessOriginal&v){std::uint64_t fields[]={v.pid,v.parent,v.uid,v.gid,v.startSeconds,v.startMicros};for(unsigned i=0;i<6;i++)put64(p+8*i,fields[i]);}
inline ProcessOriginal getProcess(const unsigned char*p){return {get64(p),get64(p+8),get64(p+16),get64(p+24),get64(p+32),get64(p+40)};}
inline PreludeBytes encodePrelude(const Prelude&p){
 PreludeBytes out{};std::memcpy(out.data(),"YNXIDE01",8);out[11]=1;out[15]=(unsigned char)p.kind;
 std::memcpy(out.data()+16,p.intent.data(),43);std::memcpy(out.data()+64,p.source.data(),32);std::memcpy(out.data()+96,p.audit.data(),32);
 putProcess(out.data()+128,p.wallet);putProcess(out.data()+176,p.ide);putProcess(out.data()+224,p.node);std::memcpy(out.data()+272,p.challenge.data(),32);std::memcpy(out.data()+304,p.ideAudit.data(),32);std::memcpy(out.data()+336,p.nodeAudit.data(),32);return out;
}
inline Prelude decodePrelude(const PreludeBytes&b){
 if(std::memcmp(b.data(),"YNXIDE01",8)||b[8]||b[9]||b[10]||b[11]!=1||b[12]||b[13]||b[14]||b[15]<1||b[15]>6)throw std::runtime_error("IDE_PRELUDE_VERSION_OR_KIND_MISMATCH");
 for(unsigned i=59;i<64;i++)if(b[i])throw std::runtime_error("IDE_PRELUDE_RESERVED_BYTES");
 for(unsigned i=368;i<384;i++)if(b[i])throw std::runtime_error("IDE_PRELUDE_RESERVED_BYTES");
 for(unsigned i=16;i<59;i++){unsigned char c=b[i];if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='_'||c=='-'))throw std::runtime_error("IDE_PRELUDE_INTENT_INVALID");}
 Prelude p{};p.kind=(PreludeKind)b[15];std::memcpy(p.intent.data(),b.data()+16,43);std::memcpy(p.source.data(),b.data()+64,32);std::memcpy(p.audit.data(),b.data()+96,32);
 p.wallet=getProcess(b.data()+128);p.ide=getProcess(b.data()+176);p.node=getProcess(b.data()+224);std::memcpy(p.challenge.data(),b.data()+272,32);std::memcpy(p.ideAudit.data(),b.data()+304,32);std::memcpy(p.nodeAudit.data(),b.data()+336,32);return p;
}
// This exact parser is also used by production readPrelude: bounded fragments,
// no lookahead, no second frame installed line consumed, sticky EOF/UNKNOWN.
class PreludeReader final {
 PreludeBytes bytes_{};std::size_t size_=0;bool failed_=false,finished_=false;
public:
 std::size_t remaining()const{return failed_||finished_?0:bytes_.size()-size_;}
 void append(const void*raw,std::size_t count){if(failed_||finished_||count==0||count>remaining()){failed_=true;throw std::runtime_error("IDE_PRELUDE_FRAGMENT_INVALID");}std::memcpy(bytes_.data()+size_,raw,count);size_+=count;}
 void eof(){failed_=true;throw std::runtime_error("IDE_PRELUDE_EOF_UNKNOWN");}
 Prelude finish(){if(failed_||finished_||size_!=bytes_.size()){failed_=true;throw std::runtime_error("IDE_PRELUDE_INCOMPLETE");}finished_=true;return decodePrelude(bytes_);}
};
// Production structural order fence. Kernel audit/Source/current validation is
// still mandatory in the owning broker; passing this helper grants NOTHING.
class AdoptionPreludeOrder final {
 Prelude context_,adopt_{},acquire_{};bool adopted_=false,acquired_=false,failed_=false,finished_=false;
 [[noreturn]] void fail(){failed_=true;throw std::runtime_error("IDE_PRELUDE_ADOPT_ORDER_OR_BINDING_MISMATCH");}
public:
 explicit AdoptionPreludeOrder(const Prelude&pending):context_(pending){}
 void accept(const Prelude&p){
  if(failed_||finished_||p.source!=context_.source||p.intent!=context_.intent||!(p.wallet==context_.wallet)||!(p.ide==context_.ide)||p.node.pid<=1||p.node.parent!=p.ide.pid||p.node.uid!=p.ide.uid)fail();
  if(p.kind==PreludeKind::adoptNode&&!adopted_){adopt_=p;adopted_=true;}
  else if(p.kind==PreludeKind::acquireNode&&!acquired_){acquire_=p;acquired_=true;}
  else fail();
  if(adopted_&&acquired_&&!(adopt_.node==acquire_.node))fail();
 }
 Prelude finish(){if(failed_||finished_||!adopted_||!acquired_)fail();finished_=true;return acquire_;}
};
}
