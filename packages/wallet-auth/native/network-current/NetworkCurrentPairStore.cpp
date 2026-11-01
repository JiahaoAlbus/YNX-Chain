#include "NetworkCurrentPairStore.h"
#include <algorithm>
#include <stdexcept>

namespace ynx::auth::network_current {
namespace {
constexpr size_t cap=393216;
[[noreturn]] void fail(const char*code){throw std::runtime_error(code);}
bool utf8(const std::string&s){
 for(size_t i=0;i<s.size();){const size_t start=i;uint8_t a=uint8_t(s[i++]);if(a<0x80){if(a==0)return false;continue;}
  uint32_t cp=0,min=0;size_t n=0;if(a>=0xc2&&a<=0xdf){cp=a&31;n=1;min=0x80;}else if(a>=0xe0&&a<=0xef){cp=a&15;n=2;min=0x800;}else if(a>=0xf0&&a<=0xf4){cp=a&7;n=3;min=0x10000;}else return false;
  if(i+n>s.size())return false;for(size_t j=0;j<n;j++){uint8_t b=uint8_t(s[i++]);if((b&0xc0)!=0x80)return false;cp=(cp<<6)|(b&63);}if(cp<min||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff)||(cp==0xfeff&&start==0))return false;
 }return !s.empty();
}
void field(std::string&out,const std::string&value,size_t max,bool isText=true){if(value.empty()||value.size()>max||(isText&&!utf8(value)))fail("NETWORK_CURRENT_STORE_INTENT_SCHEMA");uint32_t n=uint32_t(value.size());for(int s=24;s>=0;s-=8)out.push_back(char(n>>s));out+=value;}
bool op(const std::string&s){return s.size()==64&&std::all_of(s.begin(),s.end(),[](char c){return(c>='0'&&c<='9')||(c>='a'&&c<='f');});}
void validateEnvelope(const std::string&s){if(s.size()>cap||!utf8(s)||s.front()!='{'||s.back()!='}')fail("NETWORK_CURRENT_STORE_ENVELOPE_UTF8");}
PairQuery readSelected(ynx_auth_private::HostDirfdJournal&j,const PairIntent&i,const std::string&entered){
 PairQuery result;try{
  j.assertCurrent();const auto names=j.list();const auto a=i.originalOperation64+".entered",b=i.originalOperation64+".terminal";
  const bool hasA=std::find(names.begin(),names.end(),a)!=names.end(),hasB=std::find(names.begin(),names.end(),b)!=names.end();
  if(!hasA){if(hasB)fail("NETWORK_CURRENT_STORE_ORPHAN_TERMINAL");return result;}
  const auto actual=j.read(a,cap);if(actual!=entered)fail("NETWORK_CURRENT_STORE_WRONG_ORIGINAL_INTENT");result.state=PairQueryState::entered_only;result.current9Original=i.current9Original;
  if(!hasB)return result;
  // Retain public outcome before validation/current can throw late.
  result.envelopeOriginal=j.read(b,cap);validateEnvelope(result.envelopeOriginal);j.assertCurrent();result.state=PairQueryState::complete;
 }catch(...){result.error=std::current_exception();result.state=PairQueryState::unknown;}return result;
}
}
std::string encodeOriginalCurrentPairIntent(const PairIntent&i){
 if(!op(i.originalOperation64)||i.resourceKey!=i.protectedResourceRef)fail("NETWORK_CURRENT_STORE_SELECTION_INVALID");
 static constexpr char magic[]="YNX-NETWORK-CURRENT-PAIR-INTENT/V1\0";
 std::string out(magic,sizeof(magic)-1);
 field(out,i.originalOperation64,64);field(out,i.resourceKey,128);field(out,i.protectedResourceRef,128);
 field(out,"source.current.original",23);field(out,i.descriptorOriginal,16384);field(out,i.bindingOriginal,2048);field(out,i.current9Original,65536);field(out,i.statementE8Original,98304,false);
 if(out.size()>cap)fail("NETWORK_CURRENT_STORE_INTENT_CAPACITY");return out;
}
NetworkCurrentPairStore::NetworkCurrentPairStore(std::shared_ptr<ynx_auth_private::HostDirfdJournal>j,PairIntent i):journal_(std::move(j)),intent_(std::move(i)),entered_(encodeOriginalCurrentPairIntent(intent_)){if(!journal_)fail("NETWORK_CURRENT_STORE_OWNER_REQUIRED");journal_->assertCurrent();}
void NetworkCurrentPairStore::remember(std::exception_ptr e){if(!first_)first_=e;}
void NetworkCurrentPairStore::thread()const{if(thread_!=std::this_thread::get_id())fail("NETWORK_CURRENT_STORE_WRONG_THREAD");}
[[noreturn]] void NetworkCurrentPairStore::reject(const char*code){try{fail(code);}catch(...){remember(std::current_exception());throw;}}
void NetworkCurrentPairStore::current(){if(retired_||first_)fail("NETWORK_CURRENT_STORE_UNRESOLVED");journal_->assertCurrent();}
void NetworkCurrentPairStore::matching(const std::string&c,const std::string&e)const{if(c!=intent_.current9Original||e!=expectedEnvelope_)fail("NETWORK_CURRENT_STORE_PAIR_CHANGED");}
void NetworkCurrentPairStore::retainSigningIntentOnce(){
 thread();
 if(signingSelected_)fail("NETWORK_CURRENT_STORE_SIGN_ONCE");signingSelected_=true;
 try{current();journal_->writeSourceCurrentV2Exclusive(intent_.originalOperation64+".entered",entered_);if(journal_->read(intent_.originalOperation64+".entered",cap)!=entered_)fail("NETWORK_CURRENT_STORE_ENTERED_READBACK");current();enteredRetained_=true;}catch(...){remember(std::current_exception());throw;}
}
void NetworkCurrentPairStore::retainPublicationIntentOnce(const std::string&c,const std::string&e){
 thread();
 if(publicationSelected_)fail("NETWORK_CURRENT_STORE_TERMINAL_ONCE");publicationSelected_=true;
 try{current();if(!enteredRetained_||c!=intent_.current9Original)fail("NETWORK_CURRENT_STORE_NO_ORIGINAL_INTENT");validateEnvelope(e);expectedEnvelope_=e;if(journal_->read(intent_.originalOperation64+".entered",cap)!=entered_)fail("NETWORK_CURRENT_STORE_ENTERED_CHANGED");current();}catch(...){remember(std::current_exception());throw;}
}
void NetworkCurrentPairStore::publishOriginalPairOnce(const std::string&c,const std::string&e){
 thread();
 try{current();if(!publicationSelected_||published_||expectedEnvelope_.empty())fail("NETWORK_CURRENT_STORE_TERMINAL_STATE");matching(c,e);published_=true;journal_->writeSourceCurrentV2Exclusive(intent_.originalOperation64+".terminal",e);const auto result=readSelected(*journal_,intent_,entered_);if(result.error)std::rethrow_exception(result.error);if(result.state!=PairQueryState::complete||result.envelopeOriginal!=expectedEnvelope_)fail("NETWORK_CURRENT_STORE_TERMINAL_READBACK");current();}catch(...){remember(std::current_exception());throw;}
}
PairQuery NetworkCurrentPairStore::readOriginalPair(){
 thread();
 PairQuery result;try{current();result=readSelected(*journal_,intent_,entered_);if(result.error)std::rethrow_exception(result.error);if(result.state!=PairQueryState::complete||result.envelopeOriginal!=expectedEnvelope_)fail("NETWORK_CURRENT_STORE_PAIR_READBACK");current();}catch(...){remember(std::current_exception());result.error=first_;result.state=PairQueryState::unknown;}return result;
}
PairQuery NetworkCurrentPairStore::querySameOriginalLocal()const{thread();PairQuery r;r.state=first_?PairQueryState::unknown:(published_?PairQueryState::complete:(enteredRetained_?PairQueryState::entered_only:PairQueryState::unknown));r.current9Original=intent_.current9Original;r.envelopeOriginal=expectedEnvelope_;r.error=first_;return r;}
void NetworkCurrentPairStore::retire(){thread();retired_=true;}
void NetworkCurrentPairStore::join(){thread();}
bool NetworkCurrentPairStore::close(){thread();if(closeSelected_)return closeResult_;closeSelected_=true;retired_=true;closeResult_=journal_->close();if(!closeResult_)try{fail("NETWORK_CURRENT_STORE_CLOSE_UNKNOWN");}catch(...){remember(std::current_exception());}return closeResult_;}
NetworkCurrentPairRecoveryReader::NetworkCurrentPairRecoveryReader(std::shared_ptr<ynx_auth_private::HostDirfdJournal>r,PairIntent i):reader_(std::move(r)),intent_(std::move(i)),entered_(encodeOriginalCurrentPairIntent(intent_)){if(!reader_)fail("NETWORK_CURRENT_STORE_RECOVERY_OWNER_REQUIRED");reader_->assertCurrent();}
PairQuery NetworkCurrentPairRecoveryReader::querySameOriginal(){if(thread_!=std::this_thread::get_id())fail("NETWORK_CURRENT_STORE_WRONG_THREAD");if(closeSelected_){PairQuery r;r.error=first_;return r;}if(first_){PairQuery r;r.error=first_;return r;}auto r=readSelected(*reader_,intent_,entered_);if(r.error)first_=r.error;return r;}
bool NetworkCurrentPairRecoveryReader::close(){if(thread_!=std::this_thread::get_id())fail("NETWORK_CURRENT_STORE_WRONG_THREAD");if(closeSelected_)return closeResult_;closeSelected_=true;closeResult_=reader_->close();if(!closeResult_&&!first_)try{fail("NETWORK_CURRENT_STORE_CLOSE_UNKNOWN");}catch(...){first_=std::current_exception();}return closeResult_;}
}
