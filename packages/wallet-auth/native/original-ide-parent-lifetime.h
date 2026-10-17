#pragma once
#include <cstdint>
#include <string>

namespace ynx_auth_ide_private {
// Internal bookkeeping ONLY. No object of this type is accepted as a native
// grant/guard. Only the Source-verified private supplier can publish a guard.
struct ProcessOriginal {
 std::uint64_t pid=0,parent=0,uid=0,gid=0,startSeconds=0,startMicros=0;
 bool operator==(const ProcessOriginal&o)const{return pid==o.pid&&parent==o.parent&&uid==o.uid&&gid==o.gid&&startSeconds==o.startSeconds&&startMicros==o.startMicros;}
};
enum class Phase { reserved,pending,halfAdopted,adopted,retired,unknown,closed };
class Lifetime {
 Phase phase_=Phase::reserved;ProcessOriginal wallet_{},ide_{},node_{};
 std::string intent_,first_;std::uint64_t wallFloor_=0,deadline_=0,monoStart_=0,monoFloor_=0,budget_=0;
 bool selected_=false,closeSelected_=false,closeFinished_=false,closeResult_=false;unsigned loans_=0;
 void fail(const char *cause){if(first_.empty())first_=cause;phase_=Phase::unknown;}
public:
 bool begin(const std::string&intent,const ProcessOriginal&wallet,const ProcessOriginal&ide,std::uint64_t wall,std::uint64_t end,std::uint64_t mono){
  if(selected_||phase_!=Phase::reserved){fail("IDE_PARENT_INTENT_ALREADY_SELECTED");return false;}selected_=true;
  if(intent.empty()||wallet.pid<=1||ide.pid<=1||ide.parent!=wallet.pid||wallet.uid!=ide.uid||end<=wall||mono==0){fail("IDE_PARENT_ORIGINAL_BINDING_INVALID");return false;}
  intent_=intent;wallet_=wallet;ide_=ide;wallFloor_=wall;deadline_=end;monoStart_=monoFloor_=mono;budget_=end-wall;phase_=Phase::pending;return true;
 }
 bool current(const ProcessOriginal&wallet,const ProcessOriginal&ide,std::uint64_t wall,std::uint64_t mono){
  if(phase_!=Phase::pending&&phase_!=Phase::halfAdopted&&phase_!=Phase::adopted)return false;
  if(!(wallet==wallet_)||!(ide==ide_)||wall<wallFloor_||wall>=deadline_||mono<monoFloor_||mono-monoStart_>=budget_){fail("IDE_PARENT_ORIGINAL_OR_WINDOW_CHANGED");return false;}wallFloor_=wall;monoFloor_=mono;return true;
 }
 bool beginAdopt(const std::string&intent,const ProcessOriginal&node){
  if(phase_!=Phase::pending||intent!=intent_||node.pid<=1||node.parent!=ide_.pid||node.uid!=ide_.uid){fail("IDE_PARENT_CHILD_ADOPT_MISMATCH");return false;}
  node_=node;phase_=Phase::halfAdopted;return true;
 }
 bool completeAdopt(const std::string&intent,const ProcessOriginal&node,const ProcessOriginal&wallet,const ProcessOriginal&ide,std::uint64_t wall,std::uint64_t mono){
  if(phase_!=Phase::halfAdopted||intent!=intent_||!(node==node_)){fail("IDE_PARENT_CHILD_ADOPT_MISMATCH");return false;}
  if(!current(wallet,ide,wall,mono))return false;phase_=Phase::adopted;return true;
 }
 bool nodeCurrent(const ProcessOriginal&node){if(phase_!=Phase::adopted||!(node==node_)){fail("IDE_PARENT_ADOPTED_CHILD_CHANGED");return false;}return true;}
 bool borrow(){if(phase_!=Phase::adopted)return false;++loans_;return true;}
 bool giveBack(){if(!loans_){fail("IDE_PARENT_FOREIGN_LOAN_RETURN");return false;}--loans_;return true;}
 void retire(){if(phase_!=Phase::unknown&&phase_!=Phase::closed)phase_=Phase::retired;}
 void unknown(const char*cause){fail(cause);}
 bool selectClose(){retire();if(loans_||closeSelected_)return false;closeSelected_=true;return true;}
 bool finishClose(bool done){if(!closeSelected_)return false;if(closeFinished_)return closeResult_;closeFinished_=true;closeResult_=done;if(done)phase_=Phase::closed;else fail("IDE_PARENT_CLOSE_UNKNOWN");return done;}
 bool joined()const{return (phase_==Phase::retired||phase_==Phase::unknown||phase_==Phase::closed)&&loans_==0;}
 Phase phase()const{return phase_;}bool closeSelected()const{return closeSelected_;}bool closeResult()const{return closeResult_;}
 const ProcessOriginal&node()const{return node_;}const std::string&intent()const{return intent_;}const std::string&firstCause()const{return first_;}
};
}
