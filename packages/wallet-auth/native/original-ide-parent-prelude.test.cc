#include "original-ide-parent-prelude.h"
#include <cassert>
#include <iostream>
#include <string>
using namespace ynx_auth_ide_private;
template<class F>static bool fails(F fn){try{fn();return false;}catch(const std::runtime_error&){return true;}}
int main(){
 Prelude p{};p.kind=PreludeKind::prepareIDE;p.intent.fill('a');p.wallet={2,1,501,20,5,6};auto bytes=encodePrelude(p);
 {PreludeReader r;for(unsigned i=0;i<bytes.size();i++)r.append(bytes.data()+i,1);auto result=r.finish();assert(result.wallet==p.wallet);assert(result.kind==p.kind);assert(r.remaining()==0);assert(fails([&]{r.append(bytes.data(),1);}));}
 for(unsigned n=0;n<bytes.size();n++){PreludeReader r;if(n)r.append(bytes.data(),n);assert(fails([&]{r.eof();}));assert(fails([&]{r.finish();}));}
 for(unsigned at: {0u,8u,9u,10u,11u,12u,13u,14u,59u,63u,368u,383u}){auto bad=bytes;bad[at]^=0x80;assert(fails([&]{decodePrelude(bad);}));}
 {auto bad=bytes;bad[15]=7;assert(fails([&]{decodePrelude(bad);}));}
 {auto bad=bytes;bad[16]='\n';assert(fails([&]{decodePrelude(bad);}));}
 {PreludeReader r;assert(fails([&]{r.append(bytes.data(),385);}));assert(fails([&]{r.finish();}));}
 {Prelude context=p;context.wallet={20,10,501,20,1,1};context.ide={30,20,501,20,2,2};Prelude adopt=context;adopt.kind=PreludeKind::adoptNode;adopt.node={40,30,501,20,3,3};Prelude acquire=adopt;acquire.kind=PreludeKind::acquireNode;
  for(bool reversed:{false,true}){AdoptionPreludeOrder order(context);order.accept(reversed?acquire:adopt);order.accept(reversed?adopt:acquire);assert(order.finish().node==acquire.node);assert(fails([&]{order.accept(acquire);}));}
  {AdoptionPreludeOrder order(context);order.accept(adopt);assert(fails([&]{order.accept(adopt);}));assert(fails([&]{order.finish();}));}
  for(unsigned mutation=0;mutation<8;mutation++){auto wrong=acquire;switch(mutation){case 0:wrong.intent[0]='b';break;case 1:wrong.source[0]=1;break;case 2:wrong.wallet.pid++;break;case 3:wrong.ide.startMicros++;break;case 4:wrong.node.pid=0;break;case 5:wrong.node.parent++;break;case 6:wrong.node.uid++;break;case 7:wrong.node.startMicros++;break;}AdoptionPreludeOrder order(context);order.accept(adopt);assert(fails([&]{order.accept(wrong);}));assert(fails([&]{order.finish();}));}
  {AdoptionPreludeOrder order(context);auto wrong=acquire;wrong.kind=PreludeKind::readyNode;assert(fails([&]{order.accept(wrong);}));}
  {AdoptionPreludeOrder order(context);order.accept(acquire);assert(fails([&]{order.finish();}));assert(fails([&]{order.accept(adopt);}));}
 }
 // Simulate production readExact's maximum demand; installed stays untouched.
 {std::string stream((const char*)bytes.data(),bytes.size());stream+="{\"type\":\"installed\"}\n";PreludeReader r;std::size_t pos=0;while(r.remaining()){auto n=r.remaining();if(n>7)n=7;r.append(stream.data()+pos,n);pos+=n;}r.finish();assert(stream.substr(pos)=="{\"type\":\"installed\"}\n");}
 std::cout<<"PASS actual production prelude parser: fragments, 384 EOF offsets, version/kind/reserved, sticky UNKNOWN, no installed lookahead\n";
}
