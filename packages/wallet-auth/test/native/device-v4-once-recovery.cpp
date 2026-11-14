#include "product-session-device-v4-once.h"
#include <cassert>
#include <functional>
#include <fstream>
#include <string>
#include <vector>
using ynx_auth_private::HostDirfdJournal;
using ynx_auth_private::ProductDeviceV4Once;
static std::array<unsigned char,32> data(unsigned char v){std::array<unsigned char,32> a{};a.fill(v);return a;}
static bool refuses(const std::function<void()>&f){try{f();return false;}catch(const std::exception&){return true;}}
static void recover(const std::string&parent,const std::string&leaf,int kind){
 const auto a=data(1),b=data(2),c=data(3);const std::string nonce(32,'a');const std::vector<unsigned char>e5{7,8,9};std::string terminalPath;
 {HostDirfdJournal writer;writer.open(parent,leaf);ProductDeviceV4Once op(writer,a,b,c,nonce,e5);if(kind!=6)op.reserve();
  if(kind==0){op.selectPrimitiveEntry();op.retainOutcome(0,2,{1,2,3});}
  if(kind==1){op.selectPrimitiveEntry();assert(refuses([&]{op.retainOutcome(-9,3,{4,5});}));}
  if(kind==3)writer.writeProductDeviceV4OnceExclusive(op.recordKeyDATA()+".terminal","PUBLIC malformed terminal");
  if(kind==5){std::string forged="YNX-PRODUCT-DEVICE-HTTP-OUTCOME/v4";forged.append("\0\0\0\x20",4);forged.append(32,'\0');forged.append(12,'\0');writer.writeProductDeviceV4OnceExclusive(op.recordKeyDATA()+".terminal",forged);}
  if(kind==7){std::string truncated="YNX-PRODUCT-DEVICE-HTTP-OUTCOME/v4";truncated.append(3,'\0');writer.writeProductDeviceV4OnceExclusive(op.recordKeyDATA()+".terminal",truncated);}
  if(kind==6)writer.writeProductDeviceV4OnceExclusive(op.recordKeyDATA()+".terminal","PUBLIC orphan terminal");
  if(kind==8||kind==9||kind==10){op.selectPrimitiveEntry();op.retainOutcome(0,2,{1,2,3});terminalPath=parent+"/"+leaf+"/"+op.recordKeyDATA()+".terminal";}
  assert(writer.close());}
 if(!terminalPath.empty()){
  std::ifstream in(terminalPath,std::ios::binary);std::string raw((std::istreambuf_iterator<char>(in)),{});assert(raw.size()>7);in.close();
  if(kind==8)raw.push_back('x');else {const size_t at=raw.size()-7;raw[at]=kind==9?'\0':'\x7f';raw[at+1]='\0';raw[at+2]='\0';raw[at+3]=kind==9?'\x04':'\0';}
  int fd=::open(terminalPath.c_str(),O_WRONLY|O_TRUNC);assert(fd>=0);assert(::write(fd,raw.data(),raw.size())==(ssize_t)raw.size());assert(::fsync(fd)==0);assert(::close(fd)==0);
 }
 {HostDirfdJournal reader;reader.openRetained(parent,leaf);auto transcript=e5;if(kind==4)transcript[0]^=1;ProductDeviceV4Once op(reader,a,b,c,nonce,transcript);
  if(kind>=3){assert(refuses([&]{op.recoverOriginalOutcomeDATA();}));}
  else {auto r=op.recoverOriginalOutcomeDATA();if(kind==0){assert(r.terminalPresent&&r.status==0&&r.cleanup==2&&r.member==std::vector<unsigned char>({1,2,3}));}if(kind==1){assert(r.terminalPresent&&r.status==-9&&r.cleanup==3&&r.member==std::vector<unsigned char>({4,5}));}if(kind==2)assert(!r.terminalPresent&&r.member.empty());}
  assert(!op.terminalRecordedDATA());assert(refuses([&]{op.selectPrimitiveEntry();}));assert(reader.close());}
 {HostDirfdJournal reader;reader.openRetained(parent,leaf);auto transcript=e5;if(kind==4)transcript[0]^=1;ProductDeviceV4Once op(reader,a,b,c,nonce,transcript);
  if(kind>=3)assert(refuses([&]{op.recoverOriginalOutcomeDATA();}));else op.recoverOriginalOutcomeDATA();
  assert(!op.terminalRecordedDATA());assert(refuses([&]{op.reserve();}));assert(reader.close());}
}
int main(int argc,char**argv){assert(argc==2);for(int i=0;i<11;i++)recover(argv[1],"case"+std::to_string(i),i);}
