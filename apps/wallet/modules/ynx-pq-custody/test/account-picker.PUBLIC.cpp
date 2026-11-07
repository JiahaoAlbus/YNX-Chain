// PUBLIC UI callback seam only. No real account inventory, Root, Source,
// approval, credential, OS UI or protected selected7 factory is exercised.
#include "NativeAccountPicker.h"
#include <atomic>
#include <cassert>
#include <functional>
#include <future>
#include <iostream>
#include <thread>
using namespace ynx::mobilepq::picker;
namespace {
std::atomic<int>shows{0},dismisses{0};int32_t showCode=0;
std::function<void(uint64_t)>onShow;
std::vector<std::string>lastLabels;
const AccountChoice choice{"0x"+std::string(40,'a'),std::string(64,'b'),"PUBLIC-original"};
uint64_t sequence=1;
struct Fixture {
 const uint64_t binding=sequence++;
 Fixture(){shows=0;dismisses=0;showCode=0;onShow={};lastLabels.clear();assert(bindRuntime(binding));}
 ~Fixture(){retireRuntime(binding);assert(releaseRuntime(binding));}
 uint64_t openOne(uint32_t timeout=10000){uint64_t ticket=0;assert(!open(binding,{choice},timeout,&ticket)&&ticket);return ticket;}
 void dispose(uint64_t ticket){assert(close(ticket)==pending);assert(releaseClosed(ticket)==pending);presentationClosed(ticket);assert(!close(ticket)&&!releaseClosed(ticket));}
};
template<class F>void control(const char*label,F run){run();std::cout<<"PASS "<<label<<"\n";}
}
namespace ynx::mobilepq::picker {
int32_t platformShow(uint64_t ticket,const std::vector<std::string>&rows)noexcept {++shows;lastLabels=rows;if(onShow)onShow(ticket);return showCode;}
void platformDismiss(uint64_t)noexcept {++dismisses;}
}
int main(){
 control("unbound runtime never posts a picker",[]{uint64_t id=0;assert(open(1,{choice},1000,&id)==unavailable&&!id&&!shows);assert(openForCurrentRuntime({choice},1000,&id)==unavailable&&!id&&!shows);assert(!bindRuntime(0));});
 control("runtime binding cannot be replaced or rewound",[]{Fixture f;assert(bindRuntime(f.binding));assert(!bindRuntime(f.binding+1));retireRuntime(f.binding);assert(!bindRuntime(f.binding));});
 control("only finite canonical public choices reach platform UI",[]{Fixture f;for(auto bad:{AccountChoice{"17",choice.network,choice.originalOperation},AccountChoice{choice.account,"0x"+choice.network,choice.originalOperation},AccountChoice{choice.account,choice.network,"a\nb"}}){uint64_t id=0;assert(open(f.binding,{bad},1000,&id)==invalid&&!id);}uint64_t id=0;assert(open(f.binding,{},1000,&id)==invalid);assert(open(f.binding,{choice,choice},1000,&id)==invalid);assert(open(f.binding,std::vector<AccountChoice>(21,choice),1000,&id)==invalid);assert(open(f.binding,{choice},999,&id)==invalid);assert(open(f.binding,{choice},120001,&id)==invalid);assert(open(f.binding,{choice},1000,nullptr)==invalid);id=17;assert(open(f.binding,{choice},1000,&id)==invalid&&id==17);assert(!shows);});
 control("selection returns only original row index and preserves public labels",[]{Fixture f;uint64_t id=f.openOne();assert(lastLabels.size()==1&&lastLabels[0].find(choice.account)!=std::string::npos&&lastLabels[0].find(choice.network)!=std::string::npos&&lastLabels[0].find(choice.originalOperation)!=std::string::npos);assert(presentationCurrent(id));assert(selected(id,0,0));uint32_t row=99;assert(!wait(id,&row)&&row==0);assert(!presentationCurrent(id)&&!selected(id,0,0));f.dispose(id);});
 control("ticket is adopted before a synchronous platform callback",[]{Fixture f;onShow=[](uint64_t id){assert(presentationCurrent(id)&&selected(id,0,0));presentationClosed(id);};uint64_t id=f.openOne();uint32_t row=99;assert(!wait(id,&row)&&row==0);assert(!close(id)&&!releaseClosed(id));});
 control("invalid row cannot become a response",[]{Fixture f;uint64_t id=f.openOne();assert(!selected(id,1,0)&&presentationCurrent(id));assert(selected(id,0,cancelled));uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);f.dispose(id);});
 control("user dismissal without choice yields cancellation only",[]{Fixture f;auto id=f.openOne();presentationClosed(id);uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);assert(releaseClosed(id)==pending);assert(!close(id)&&!releaseClosed(id));});
 control("close request is not a platform closed ACK",[]{Fixture f;auto id=f.openOne();assert(close(id)==pending);assert(dismisses==1&&!presentationCurrent(id));assert(releaseClosed(id)==pending);retireRuntime(f.binding);assert(!releaseRuntime(f.binding));presentationClosed(id);assert(!releaseClosed(id));});
 control("platform failure before posting still adopts closeable original",[]{Fixture f;showCode=unavailable;uint64_t id=0;assert(open(f.binding,{choice},1000,&id)==unavailable&&id);uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);assert(!close(id)&&!releaseClosed(id));});
 control("foreign thread cannot wait close or release an original picker",[]{Fixture f;auto id=f.openOne();std::thread peer([&]{uint32_t row=99;assert(wait(id,&row)==wrongThread&&row==99);assert(close(id)==wrongThread&&releaseClosed(id)==wrongThread);});peer.join();assert(presentationCurrent(id));f.dispose(id);});
 control("retired runtime ignores late selection and blocks new work",[]{Fixture f;auto id=f.openOne();retireRuntime(f.binding+1);assert(presentationCurrent(id));retireRuntime(f.binding);assert(!selected(id,0,0)&&!presentationCurrent(id));uint64_t extra=0;assert(open(f.binding,{choice},1000,&extra)==unavailable&&!extra);uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);f.dispose(id);});
 control("app retire wakes a blocked native actor without freeing UI debt",[]{Fixture f;std::promise<uint64_t>opened;std::promise<void>retained,ack;auto gate=ack.get_future();std::thread actor([&]{auto id=f.openOne();opened.set_value(id);uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);assert(close(id)==pending&&releaseClosed(id)==pending);retained.set_value();gate.wait();assert(!close(id)&&!releaseClosed(id));});auto id=opened.get_future().get();retireRuntime(f.binding);retained.get_future().get();assert(!releaseRuntime(f.binding));presentationClosed(id);ack.set_value();actor.join();});
 control("expiry dismisses original UI and cannot select or erase debt",[]{Fixture f;auto id=f.openOne(1000);uint32_t row=99;assert(wait(id,&row)==expired&&row==99);assert(!selected(id,0,0)&&!presentationCurrent(id)&&dismisses>0);f.dispose(id);});
 control("bounded UI debt cannot be hidden by opening replacement",[]{Fixture f;std::vector<uint64_t>ids;for(int i=0;i<32;++i)ids.push_back(f.openOne());uint64_t extra=0;assert(open(f.binding,{choice},1000,&extra)==capacity&&!extra);retireRuntime(f.binding);assert(!releaseRuntime(f.binding));for(auto id:ids)f.dispose(id);});
 control("released ticket callbacks cannot target a later picker",[]{Fixture f;auto old=f.openOne();f.dispose(old);auto current=f.openOne();assert(current!=old&&!selected(old,0,0));presentationClosed(old);assert(presentationCurrent(current));uint32_t row=99;assert(wait(old,&row)==invalid&&close(old)==invalid&&releaseClosed(old)==invalid);f.dispose(current);});
 control("closed old runtime cannot release or cancel new runtime",[]{const auto old=sequence-1;Fixture f;retireRuntime(old);assert(!releaseRuntime(old)&&!bindRuntime(old));auto id=f.openOne();assert(presentationCurrent(id));f.dispose(id);});
 control("normal Native factory binds current App without caller lifecycle ID",[]{Fixture f;uint64_t id=0;assert(!openForCurrentRuntime({choice},1000,&id)&&id&&presentationCurrent(id));assert(selected(id,0,0));uint32_t row=99;assert(!wait(id,&row)&&row==0);f.dispose(id);retireRuntime(f.binding);id=0;assert(openForCurrentRuntime({choice},1000,&id)==unavailable&&!id);});
 control("account proof revoke wakes only its actor and retains UI debt without retiring App",[]{Fixture f;std::promise<uint64_t>opened;std::promise<void>retained,ack;auto gate=ack.get_future();std::thread actor([&]{auto id=f.openOne();opened.set_value(id);uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);assert(close(id)==pending&&releaseClosed(id)==pending);retained.set_value();gate.wait();assert(!close(id)&&!releaseClosed(id));});auto id=opened.get_future().get();auto sibling=f.openOne();assert(requestCancel(id));retained.get_future().get();assert(!selected(id,0,0)&&presentationCurrent(sibling));assert(releaseClosed(id)==wrongThread);auto later=f.openOne();presentationClosed(id);ack.set_value();actor.join();f.dispose(sibling);f.dispose(later);});
 control("released account revoke cannot cancel a successor or grant selected result",[]{Fixture f;auto old=f.openOne();f.dispose(old);auto next=f.openOne();assert(!requestCancel(old)&&presentationCurrent(next));assert(selected(next,0,0));assert(requestCancel(next));uint32_t row=99;assert(wait(next,&row)==cancelled&&row==99);f.dispose(next);});
 control("account revoke during platform posting never invents UI closed acknowledgement",[]{Fixture f;onShow=[](uint64_t id){assert(requestCancel(id));};auto id=f.openOne();uint32_t row=99;assert(wait(id,&row)==cancelled&&row==99);assert(releaseClosed(id)==pending);f.dispose(id);});
 std::cout<<"20 PUBLIC picker lifetime controls passed; no real UI/account/Source/approval claim\n";
}
