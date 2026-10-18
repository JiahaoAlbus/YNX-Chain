#pragma once
#include <array>
#include <vector>
#include <cstdint>
#include <cstddef>
#include <stdexcept>
#include <algorithm>
// Dedicated normal identity substream in the SAME original Native module.
// This codec is DATA ONLY. Native peer/source/kernel admission is mandatory
// before dispatch. Never put these frames in old fd3/fd4/4KiB four-op routes.
namespace ynx_auth_ide_identity_private {
enum class Message:std::uint8_t{request=1,proof=2,reject=3,cancel=4,current=5,result=6,failure=7,close=8};
inline constexpr std::size_t HeaderSize=24,PayloadMax=524288,ProofMax=262144,RequestMax=16384;
inline constexpr std::array<unsigned char,8> Magic={'Y','N','X','I','D','P','0','1'};
struct Frame{Message kind;std::uint64_t sequence;std::vector<unsigned char> payload;};
inline std::vector<unsigned char> encode(const Frame&frame){
 auto kind=static_cast<unsigned>(frame.kind);
 if(kind<1||kind>8||!frame.sequence||frame.payload.empty()||frame.payload.size()>PayloadMax)throw std::runtime_error("AUTH_IDENTITY_PEER_FRAME_INVALID");
 std::vector<unsigned char> raw(HeaderSize+frame.payload.size());std::copy(Magic.begin(),Magic.end(),raw.begin());
 raw[8]=0;raw[9]=1;raw[10]=(unsigned char)kind;raw[11]=0;
 for(unsigned i=0;i<8;i++)raw[12+i]=(unsigned char)(frame.sequence>>(56-8*i));
 auto n=(std::uint32_t)frame.payload.size();for(unsigned i=0;i<4;i++)raw[20+i]=(unsigned char)(n>>(24-8*i));
 std::copy(frame.payload.begin(),frame.payload.end(),raw.begin()+HeaderSize);return raw;
}
class Reader final{
 std::vector<unsigned char> bytes_;std::size_t total_=HeaderSize;bool failed_=false,header_=false;
 [[noreturn]] void fail(){failed_=true;throw std::runtime_error("AUTH_IDENTITY_PEER_FRAME_INVALID");}
 void header(){
  if(bytes_.size()!=HeaderSize)return;
  if(!std::equal(Magic.begin(),Magic.end(),bytes_.begin())||bytes_[8]!=0||bytes_[9]!=1||bytes_[10]<1||bytes_[10]>8||bytes_[11]!=0)fail();
  std::uint64_t sequence=0;for(unsigned i=0;i<8;i++)sequence=(sequence<<8)|bytes_[12+i];
  std::uint32_t size=0;for(unsigned i=0;i<4;i++)size=(size<<8)|bytes_[20+i];
  if(!sequence||!size||size>PayloadMax)fail();total_=HeaderSize+size;header_=true;
 }
public:
 std::size_t remaining()const{return failed_?0:total_-bytes_.size();}
 void append(const unsigned char*data,std::size_t n){
  if(failed_||!data||!n||n>remaining())fail();
  // Read exactly remaining header/payload bytes, never consume a following
  // frame or treat a partial/truncated frame as successful empty output.
  bytes_.insert(bytes_.end(),data,data+n);if(!header_)header();
 }
 Frame finish(){
  if(failed_||!header_||bytes_.size()!=total_)fail();
  std::uint64_t sequence=0;for(unsigned i=0;i<8;i++)sequence=(sequence<<8)|bytes_[12+i];
  return {static_cast<Message>(bytes_[10]),sequence,{bytes_.begin()+HeaderSize,bytes_.end()}};
 }
};
// Kept by the one Native endpoint owner. Failed/partial I/O poisons that same
// stream; no resending from sequence0 or opening a replacement to hide UNKNOWN.
class Sequence final{
 std::uint64_t send_=0,receive_=0;bool unknown_=false;
public:
 std::uint64_t selectSend(){if(unknown_||send_==UINT64_MAX)throw std::runtime_error("AUTH_IDENTITY_PEER_STREAM_UNKNOWN");return ++send_;}
 void accept(std::uint64_t sequence){if(unknown_||receive_==UINT64_MAX||sequence!=receive_+1){unknown_=true;throw std::runtime_error("AUTH_IDENTITY_PEER_REPLAY_OR_ORDER");}receive_=sequence;}
 void fail(){unknown_=true;}
 bool unknown()const{return unknown_;}
};
}
