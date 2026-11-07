// PUBLIC new Auth receipt and UI seams only. Actual Native ownership code is
// exercised; no genuine Auth/Core ledger seal, Root, platform UI or grant.
#include "NativeRegisteredReceiptOwner.h"
#include "NativeAccountPicker.h"
#include <cassert>
#include <functional>
#include <future>
#include <iostream>
#include <limits>
namespace auth=ynx::auth::mobile::receipt;
namespace pick=ynx::mobilepq::picker;
using namespace ynx::mobilepq::registered;
namespace {
struct Scenario {
 std::atomic<int>live{0},acquires{0},reads{0},currents{0},retires{0},joins{0},closes{0};
 Failure acquireFailure,readFailure,currentFailure,joinFailure,closeFailure;
 int failCurrentAt=0;bool supply=true,canClose=true,autoSelect=true,autoClosed=true;
 ReceiptDATA data;std::function<void()>onAcquire,onCurrent;std::function<void(uint64_t)>onShow;
 uint64_t lastTicket=0;std::vector<std::string>labels;
 void reset(){assert(live==0);acquires=reads=currents=retires=joins=closes=0;acquireFailure=readFailure=currentFailure=joinFailure=closeFailure={};failCurrentAt=0;supply=canClose=autoSelect=autoClosed=true;onAcquire=onCurrent={};onShow={};lastTicket=0;labels.clear();data={};data.platform="android";data.chainId="6423";data.networkId="PUBLIC-network";data.canonicalOwner=data.account="0x"+std::string(40,'a');data.sourceId="PUBLIC-source";data.instanceId="PUBLIC-instance";data.registrationDigest="PUBLIC-registered";data.keyVersion="17";data.height=42;data.originHeight=data.currentEngineHeight=43;data.activeRevision=2;data.ledgerNonce=7;data.fullAppHash.assign(32,1);data.pkA.assign(2592,2);data.pkB.assign(64,3);}
}f;
uint64_t nextBinding=1;
struct Fixture {
 const uint64_t binding;std::shared_ptr<NativeRegisteredReceiptOwner>owner;
 Fixture(bool bind=true):binding(bind?nextBinding++:0){f.reset();if(binding)assert(pick::bindRuntime(binding));}
 ~Fixture(){if(owner){if(f.lastTicket)pick::presentationClosed(f.lastTicket);f.canClose=true;(void)owner->close();assert(owner->isClosed());assert(!owner->releaseClosed().present);owner.reset();}assert(f.live==0);if(binding){pick::retireRuntime(binding);assert(pick::releaseRuntime(binding));}}
 Failure acquire(){return NativeRegisteredReceiptOwner::acquire(owner);}
 void selected(){assert(!acquire().present&&owner);assert(!owner->selectOriginalAccount(1000).present);}
};
template<class F>void control(const char*s,F run){run();std::cout<<"PASS "<<s<<"\n";}
}
namespace ynx::auth::mobile::receipt {
class RegisteredAccountReceipt {public:bool closed=false;RegisteredAccountReceipt(){++f.live;}~RegisteredAccountReceipt(){assert(closed);--f.live;}};
ReceiptAcquisition acquireOriginalRegisteredAccountReceipt()noexcept{++f.acquires;if(f.onAcquire)f.onAcquire();return {f.supply?std::make_shared<RegisteredAccountReceipt>():nullptr,f.acquireFailure};}
Failure readOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p,ReceiptDATA&out)noexcept{assert(p&&!p->closed);++f.reads;if(f.readFailure.present)return f.readFailure;out=f.data;return {};}
Failure originalReceiptCurrent(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{assert(p&&!p->closed);int n=++f.currents;if(f.onCurrent)f.onCurrent();return !f.failCurrentAt||n==f.failCurrentAt?f.currentFailure:Failure{};}
void retireOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{assert(p);++f.retires;}
Failure joinOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{assert(p);++f.joins;return f.joinFailure;}
Failure closeOriginalReceipt(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{assert(p);++f.closes;if(f.canClose)p->closed=true;return f.closeFailure;}
bool originalReceiptClosed(const std::shared_ptr<RegisteredAccountReceipt>&p)noexcept{assert(p);return p->closed;}
}
namespace ynx::mobilepq::picker {
int32_t platformShow(uint64_t id,const std::vector<std::string>&rows)noexcept{f.lastTicket=id;f.labels=rows;if(f.onShow)f.onShow(id);if(f.autoSelect)selected(id,0,0);if(f.autoClosed)presentationClosed(id);return 0;}
void platformDismiss(uint64_t)noexcept{} // explicit actual ACK remains separate
}
int main(){
 control("zero-input new receipt acquisition adopts Native owner before any callee",[]{Fixture t;f.onAcquire=[&]{assert(t.owner);};assert(!t.acquire().present);assert(f.acquires==1&&f.reads==1&&f.currents==2&&!f.lastTicket);ReceiptDATA out;assert(t.owner->readForNativeInventory(out).present);});
 control("acquire failure-present code0 retains partial before inspecting failure",[]{Fixture t;f.acquireFailure={true,0};auto status=t.acquire();assert(status.present&&status.code==0&&t.owner&&f.reads==0&&f.live==1);assert(t.owner->firstFailure().present&&t.owner->firstFailure().code==0);});
 control("null owner and original failure cannot become a ready account",[]{Fixture t;f.supply=false;f.acquireFailure={true,81};assert(t.acquire().present&&t.owner&&f.live==0);assert(t.owner->current().present);});
 control("existing adopted owner is not overwritten or recaptured",[]{Fixture t;assert(!t.acquire().present);auto same=t.owner;assert(t.acquire().present&&t.owner==same&&f.acquires==1);});
 control("current failure-present code0 refuses before copying data",[]{Fixture t;f.currentFailure={true,0};auto status=t.acquire();assert(status.present&&status.code==0&&f.reads==0);});
 control("read failure-present code0 refuses and preserves its raw cause",[]{Fixture t;f.readFailure={true,0};auto status=t.acquire();assert(status.present&&status.code==0&&f.currents==1&&t.owner->firstFailure().present);});
 control("late acquisition current failure keeps exact same partial",[]{Fixture t;f.currentFailure={true,0};f.failCurrentAt=2;auto status=t.acquire();assert(status.present&&status.code==0&&f.reads==1&&!f.lastTicket);});
 control("full widths Hplus1 overflow and public account binding are mandatory",[]{for(int n=0;n<7;n++){Fixture t;switch(n){case 0:f.data.fullAppHash.pop_back();break;case 1:f.data.pkA.pop_back();break;case 2:f.data.pkB.pop_back();break;case 3:f.data.originHeight=42;break;case 4:f.data.height=std::numeric_limits<uint64_t>::max();break;case 5:f.data.currentEngineHeight=42;break;case 6:f.data.account="0x"+std::string(40,'b');}assert(t.acquire().present&&t.owner&&!f.lastTicket);}});
 control("pre-capture account-only UI invents no operation and returns same public binding",[]{Fixture t;t.selected();assert(f.labels.size()==1&&f.labels[0].find(f.data.account)!=std::string::npos&&f.labels[0].find("Original operation")==std::string::npos);ReceiptDATA out;assert(!t.owner->readForNativeInventory(out).present);assert(out.height==42&&out.originHeight==43&&out.activeRevision==2&&out.ledgerNonce==7&&out.keyVersion=="17"&&out.pkA==f.data.pkA);});
 control("late account proof drift after UI choice refuses Native inventory copy",[]{Fixture t;assert(!t.acquire().present);f.onShow=[](uint64_t){++f.data.ledgerNonce;};auto status=t.owner->selectOriginalAccount(1000);assert(status.present&&status.code==changed);ReceiptDATA out;out.account="PUBLIC-unchanged";assert(t.owner->readForNativeInventory(out).present&&out.account=="PUBLIC-unchanged");});
 control("captured proof tuple cannot be silently rebound or revived",[]{for(int n=0;n<5;n++){Fixture t;t.selected();auto original=f.data;switch(n){case 0:++f.data.height;++f.data.originHeight;++f.data.currentEngineHeight;break;case 1:++f.data.activeRevision;break;case 2:++f.data.ledgerNonce;break;case 3:f.data.pkB[0]^=1;break;case 4:f.data.sourceId+="changed";}assert(t.owner->current().present);f.data=original;assert(t.owner->current().present);}});
 control("continuation advances current engine but cannot rewind captured witness",[]{Fixture t;t.selected();++f.data.currentEngineHeight;assert(!t.owner->current().present);--f.data.currentEngineHeight;assert(t.owner->current().present);});
 control("foreign actor cannot read select close or release but can revoke same proof",[]{Fixture t;assert(!t.acquire().present);std::thread other([&]{ReceiptDATA data;assert(t.owner->current().code==wrongThread&&t.owner->selectOriginalAccount(1000).code==wrongThread&&t.owner->readForNativeInventory(data).code==wrongThread&&t.owner->close().code==wrongThread&&t.owner->releaseClosed().code==wrongThread);t.owner->requestRetire();});other.join();assert(t.owner->current().present&&!f.lastTicket);});
 control("retirement while new factory runs adopts and retires returned partial",[]{Fixture t;f.onAcquire=[&]{std::thread peer([&]{t.owner->requestRetire();});peer.join();};assert(t.acquire().present&&t.owner&&f.live==1&&f.retires>0&&f.currents==0);});
 control("any-thread proof loss wakes UI actor while close retains UI debt",[]{Fixture t;std::promise<std::shared_ptr<NativeRegisteredReceiptOwner>>adopted;std::promise<uint64_t>opened;std::promise<void>retained,ack;auto gate=ack.get_future();f.autoSelect=f.autoClosed=false;f.onShow=[&](uint64_t id){opened.set_value(id);};std::thread actor([&]{std::shared_ptr<NativeRegisteredReceiptOwner>owner;assert(!NativeRegisteredReceiptOwner::acquire(owner).present);adopted.set_value(owner);assert(owner->selectOriginalAccount(1000).present);assert(owner->close().present&&!owner->isClosed()&&f.closes==0);retained.set_value();gate.wait();assert(!owner->close().present&&owner->isClosed()&&!owner->releaseClosed().present);});auto owner=adopted.get_future().get();auto ticket=opened.get_future().get();owner->requestRetire();retained.get_future().get();assert(pick::bindRuntime(t.binding));pick::presentationClosed(ticket);ack.set_value();actor.join();owner.reset();});
 control("sticky physical close code0 remains separate from true closed witness",[]{Fixture t;t.selected();f.closeFailure={true,0};auto status=t.owner->close();assert(status.present&&status.code==0&&t.owner->isClosed());assert(!t.owner->firstFailure().present&&t.owner->cleanupFailure().present&&t.owner->cleanupFailure().code==0);assert(!t.owner->releaseClosed().present);});
 control("GC cannot drop an unclosed original proof and later explicit close can converge",[]{Fixture t;assert(!t.acquire().present);f.canClose=false;assert(t.owner->close().present&&!t.owner->isClosed()&&t.owner->releaseClosed().present);std::weak_ptr<NativeRegisteredReceiptOwner>original=t.owner;t.owner.reset();assert(f.live==1&&!original.expired());t.owner=original.lock();f.canClose=true;assert(!t.owner->close().present&&t.owner->isClosed());});
 control("selected UI data is not a physical dismissal and receipt close waits",[]{Fixture t;f.autoClosed=false;t.selected();assert(t.owner->close().present&&f.closes==0&&f.joins==0);pick::presentationClosed(f.lastTicket);assert(!t.owner->close().present&&f.closes==1);});
 control("uninstalled runtime cannot be silently installed by proof selection",[]{Fixture t(false);assert(!t.acquire().present);assert(t.owner->selectOriginalAccount(1000).present&&!f.lastTicket);});
 control("late read current failure leaves caller output untouched with raw code0",[]{Fixture t;t.selected();f.currentFailure={true,0};f.failCurrentAt=f.currents+3;ReceiptDATA out;out.account="PUBLIC-unchanged";auto status=t.owner->readForNativeInventory(out);assert(status.present&&status.code==0&&out.account=="PUBLIC-unchanged");});
 std::cout<<"20 PUBLIC Native receipt owner controls passed; actual Auth/Core proof, Root and OS UI not executed\n";
}
