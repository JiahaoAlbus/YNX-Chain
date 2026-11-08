#include "OriginalServices.hpp"
#include "social_source_frame_data_private.h"

namespace ynx::social::joint::original {
Result prepareOriginalSourceFrame(std::uint32_t role,const Bytes&body,Bytes&out){
 out.clear();
 static constexpr unsigned char issuer[]="record-issuer";
 static constexpr unsigned char anchor[]="record-anchor";
 if((role!=1&&role!=2)||body.empty()||body.size()>BodyMax)
  return {true,-41009,false,false};
 Bytes candidate(49152);
 std::size_t written=0;
 const auto rc=ynx_auth_social_source_frame_prepare_v1(
   role==1?issuer:anchor,13,body.data(),body.size(),
   candidate.data(),candidate.size(),&written);
 if(rc!=0)return {true,rc,false,false};
 if(written==0||written>candidate.size())return {true,-41011,true,false};
 candidate.resize(written);out=std::move(candidate);
 return {};
}
}
