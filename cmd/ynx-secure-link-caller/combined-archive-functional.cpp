// Narrow PUBLIC interoperability control for ONE actual combined Go archive.
// No key generation, signing, policy registration, simulated verifier or Root
// provider is present. The C ABI functions below are the production callees.
#include "registered_n1_verify.h"
#include "private_client_startup_v1.h"
#ifdef YNX_COMBINED_FUNCTIONAL_ROOT_PROBE
#include "pay_root_main_code_private.hpp"
#endif
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
void require(bool okay,const char *what){if(!okay)throw std::runtime_error(what);}
std::vector<uint8_t> read_public(const std::string&dir,const char *name,size_t maximum){
 std::ifstream f(dir+"/"+name,std::ios::binary|std::ios::ate);
 require(bool(f),"public fixture open");const auto n=f.tellg();
 require(n>0&&uint64_t(n)<=maximum,"public fixture bound");
 std::vector<uint8_t>b(static_cast<size_t>(n));f.seekg(0);
 require(bool(f.read(reinterpret_cast<char*>(b.data()),static_cast<std::streamsize>(b.size()))),"public fixture exact read");return b;
}
YNXReadOnlyPublicSpanV1 span(const std::vector<uint8_t>&b){return {b.data(),uint64_t(b.size())};}
uint64_t positive_decimal(const std::string&s){
 require(!s.empty()&&(s.size()==1||s[0]!='0'),"canonical public expected scalar");uint64_t n=0;
 for(char c:s){require(c>='0'&&c<='9',"public expected decimal");auto d=uint64_t(c-'0');require(n<=(std::numeric_limits<uint64_t>::max()-d)/10,"public expected scalar overflow");n=n*10+d;}
 return n;
}
void check_result(const YNXRegisteredANDMemberVerifyN1ResultV1&r,bool valid){
 require(r.version==1&&r.struct_size==sizeof(r)&&r.verified==uint32_t(valid)&&r.member_count==uint32_t(valid)&&r.index==0&&r.cleanup_status==0&&r.reserved==0,"actual Core result contract");
}
void n1_function(const std::string&directory,uint64_t revision,uint64_t height,uint64_t active){
 const char*names[]={"member.bin","message.bin","network.bin","owner.txt","purpose.txt","pk-a.bin","pk-b.bin","bad-sig-a.bin"};
 std::array<std::vector<uint8_t>,8>in;
 for(size_t i=0;i<in.size();i++)in[i]=read_public(directory,names[i],YNX_REGISTERED_N1_MEMBER_MAX_V1);
 const auto originals=in;
 YNXRegisteredANDMemberVerifyN1RequestV1 req{};req.version=1;req.struct_size=sizeof(req);
 req.member=span(in[0]);req.message=span(in[1]);req.network=span(in[2]);req.owner=span(in[3]);req.purpose=span(in[4]);req.pk_a=span(in[5]);req.pk_b=span(in[6]);
 req.policy_revision=revision;req.observed_height=height;req.active_from=active;req.enabled=1;
 auto before=req;YNXRegisteredANDMemberVerifyN1ResultV1 out{};
 require(YNXRegisteredANDMemberVerifyN1V1(&req,&out)==YNX_N1_VERIFY_OK,"combined actual Core valid N1 rejected");check_result(out,true);
 require(std::memcmp(&req,&before,sizeof(req))==0&&in==originals,"Core mutated borrowed PUBLIC inputs");
 req.member=span(in[7]);before=req;std::memset(&out,0xa5,sizeof(out));
 require(YNXRegisteredANDMemberVerifyN1V1(&req,&out)==YNX_N1_VERIFY_MATH_INVALID,"combined actual Core corrupt signature accepted/wrong failure");check_result(out,false);
 require(std::memcmp(&req,&before,sizeof(req))==0&&in==originals,"corrupt call mutated borrowed PUBLIC inputs");
}
void link_function(){
 ynx_link_pay_native_startup_v1 *empty=nullptr;
 require(ynx_link_pay_native_startup_open_v1(nullptr,&empty)!=0&&empty==nullptr,"NULL ctx minted startup");
 alignas(std::max_align_t)std::array<uint8_t,64>foreign{};
 auto *unminted=reinterpret_cast<ynx_wallet_pay_actual_context_v1*>(foreign.data());
 ynx_link_pay_native_startup_v1 *partial=nullptr;
 require(ynx_link_pay_native_startup_open_v1(unminted,&partial)!=0&&partial!=nullptr,"foreign ctx lost original error partial");
 ynx_link_private_client_packet_v1 *error=nullptr;
 require(ynx_link_pay_native_startup_error_v1(partial,&error)!=0&&error!=nullptr,"foreign ctx error missing");
 require(error->packet_present==0&&error->native_current_code!=0,"foreign ctx promoted response or erased native cause");
 const auto first=error->native_current_code;ynx_link_private_client_packet_free_v1(error);
 require(ynx_link_pay_native_startup_retire_v1(partial)==0,"partial retire");
 require(ynx_link_pay_native_startup_join_v1(partial,1000)==0,"partial actual Join");
 require(ynx_link_pay_native_startup_close_v1(partial)==0&&ynx_link_pay_native_startup_closed_v1(partial)==1,"partial physical Close");
 error=nullptr;require(ynx_link_pay_native_startup_error_v1(partial,&error)!=0&&error!=nullptr&&error->native_current_code==first,"physical drain erased first native cause");
 ynx_link_private_client_packet_free_v1(error);
 require(ynx_link_pay_native_startup_free_v1(partial)==0,"partial owner debt abandoned");
}
void root_refusal(){
#ifdef YNX_COMBINED_FUNCTIONAL_ROOT_PROBE
 using namespace ynx::wallet::pay;
 auto acquired=acquire_original_pay_main_code_root();
 const bool refused=!acquired.owner&&acquired.error==3&&acquired.cause=="PAY_NATIVE_CODE_ROOT_NOT_SUPPLIED";
 // Even an unexpected nonnull original is adopted before status. An unknown
 // close stays retained rather than running the parent's terminate destructor.
 if(acquired.owner){retire_original_pay_main_code_root(acquired.owner);(void)close_original_pay_main_code_root(acquired.owner);if(!original_pay_main_code_root_closed(acquired.owner)){static auto*debts=new std::vector<std::shared_ptr<OriginalPayMainCodeRoot>>;debts->push_back(std::move(acquired.owner));}else acquired.owner.reset();}
 require(refused,"real normal Native empty Root releases did not refuse");
#endif
}
}
int main(int argc,char **argv){
 try {
  require(argc==5,"expected PUBLIC fixture dir and exact detached binding scalars");
  const std::string directory=argv[1];require(!directory.empty()&&directory.size()<4096,"bounded PUBLIC fixture directory");
  const auto revision=positive_decimal(argv[2]),height=positive_decimal(argv[3]),active=positive_decimal(argv[4]);
  n1_function(directory,revision,height,active);link_function();root_refusal();
#ifdef YNX_COMBINED_FUNCTIONAL_ROOT_PROBE
  const char *result="{\"coreValidN1\":true,\"coreCorruptRejected\":true,\"linkNullRefused\":true,\"linkForeignPartialDrained\":true,\"rootEmptyReleasesRefused\":true,\"RootAdmission\":false,\"SourceAdmission\":false}";
#else
  const char *result="{\"coreValidN1\":true,\"coreCorruptRejected\":true,\"linkNullRefused\":true,\"linkForeignPartialDrained\":true,\"rootEmptyReleasesRefused\":null,\"rootScope\":\"NOT_RUN_NOT_LINKED\",\"RootAdmission\":false,\"SourceAdmission\":false}";
#endif
  std::puts(result);return 0;
 }catch(const std::exception&e){std::fprintf(stderr,"COMBINED_ARCHIVE_FUNCTIONAL_FAILURE %s\n",e.what());return 1;}
}
