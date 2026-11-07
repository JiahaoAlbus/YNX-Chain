// PUBLIC JOINT TEST ONLY. Reuse the original Auth Source/Root/OS test boundary
// verbatim, including its existing signed fixture. No production Source factory
// is replaced. The only new boundary below is an inherited purpose-specific
// socket transport, NOT P09's missing normal protected host or Root admission.
#define YNX_CLIENT_ADAPTER_PUBLIC
#define main originalAuthReceiptControlsUnused
#include "auth-final-r1/test/receipt.PUBLIC.cpp"
#undef main
#include "MobileAccountProofHostBindingPrivate.hpp"
#include "MobileAccountProofWireDATA.hpp"
#include <array>
#include <cerrno>
#include <csignal>
#include <sys/socket.h>
namespace port=ynx::sdk::mobile::accountproof;
namespace wire=port::wire;
static OriginalEngineSource*observedOriginalSource=nullptr;
static unsigned hostAcquisitions=0,wireOperations=0,physicalReaders=0,physicalHosts=0;
static int inheritedTestFD[2]={3,4};
static void must(bool b){if(!b)throw std::runtime_error("PUBLIC_ACCOUNT_JOINT_FAILED");}
static void ioExact(int fd,uint8_t*p,size_t n,bool output){while(n){ssize_t k=output ? ::send(fd,p,n,0) : ::recv(fd,p,n,0);if(k<0&&errno==EINTR)continue;must(k>0);p+=k;n-=size_t(k);}}
static void advance(char height){ioExact(5,reinterpret_cast<uint8_t*>(&height),1,true);char ack=0;ioExact(5,reinterpret_cast<uint8_t*>(&ack),1,false);must(ack==height);}
namespace ynx::sdk::mobile::accountproof {
struct HostPort{OriginalEngineSource*source=nullptr;int fd=-1;bool closed=false;};
struct Reader{HostPort*port=nullptr;wire::SequenceDATA sequence;bool cleanup=false,closeSelected=false,closed=false,unknown=false,released=false;Failure first;};
static std::vector<std::unique_ptr<Reader>>readers;
static void remember(Reader&r,Failure f){if(f.present&&!r.first.present)r.first=f;}
static wire::FrameDATA exchange(Reader&r,Operation op){
 must(!r.unknown&&r.port&&!r.port->closed&&r.port->fd>=0);
 wire::FrameDATA f;f.operation=op;f.sequence=r.sequence.next;f.reader=r.sequence.reader;
 r.sequence.request(f);auto bytes=wire::encodeFrameDATA(f);
 // Selection precedes I/O. A partial/lost reply is UNKNOWN and cannot resend.
 try{
  ioExact(r.port->fd,bytes.data(),bytes.size(),true);std::array<uint8_t,97>header{};ioExact(r.port->fd,header.data(),header.size(),false);
  uint32_t n=0;for(unsigned i=93;i<97;++i)n=(n<<8)|header[i];must(n<=wire::maxPayloadBytes);
  bytes.assign(header.begin(),header.end());bytes.resize(97+size_t(n));if(n)ioExact(r.port->fd,bytes.data()+97,n,false);
  auto reply=wire::decodeFrameDATA(bytes);r.sequence.response(reply);++wireOperations;if(reply.status!=wire::Status::NotReady)remember(r,reply.failure); // readiness is separately paired, never a terminal firstcause
  return reply;
 }catch(...){r.unknown=true;remember(r,{true,0});throw;}
}
Acquisition open(HostPort*h,OriginalEngineSource*s)noexcept{
 Reader*partial=nullptr;try{must(h&&h->source==s&&!h->closed);auto p=std::make_unique<Reader>();p->port=h;auto*r=p.get();partial=r;readers.push_back(std::move(p));auto f=exchange(*r,Operation::Open);return{r,f.failure};}catch(...){return{partial,{true,0}};}
}
static ReadOutcome readWire(Reader*r,Operation op,CommittedProofViewDATA&out)noexcept{
 try{must(r&&!r->released&&!r->cleanup&&!r->first.present);auto f=exchange(*r,op);if(f.status==wire::Status::NotReady)return{ReadState::NotReady,f.failure};if(f.status!=wire::Status::OK||f.failure.present)return{ReadState::Failed,f.failure.present?f.failure:Failure{true,0}};out=wire::decodeViewDATA(f.payload);return{ReadState::Ready,{}};}catch(...){return{ReadState::Failed,{true,0}};}
}
ReadOutcome read(Reader*r,CommittedProofViewDATA&out)noexcept{return readWire(r,Operation::Read,out);}
ReadOutcome current(Reader*r,CommittedProofViewDATA&out)noexcept{return readWire(r,Operation::Current,out);}
void retire(Reader*r)noexcept{if(!r||r->cleanup)return;r->cleanup=true;try{auto f=exchange(*r,Operation::Retire);remember(*r,f.failure);}catch(...){remember(*r,{true,0});}}
Failure join(Reader*r)noexcept{try{must(r&&r->cleanup);auto f=exchange(*r,Operation::Join);return f.failure;}catch(...){return{true,0};}}
Failure close(Reader*r)noexcept{if(!r)return{true,0};if(r->closeSelected)return r->first;r->closeSelected=true;r->cleanup=true;try{auto f=exchange(*r,Operation::Close);if(f.status==wire::Status::Closed){r->closed=true;++physicalReaders;}return f.failure;}catch(...){remember(*r,{true,0});return r->first;}}
bool isClosed(Reader*r)noexcept{return r&&r->closed;}
Failure releaseClosed(Reader*r)noexcept{if(!r||!r->closed)return{true,0};r->released=true;return{};}
}
namespace ynx::auth::mobile::receipt {
struct OriginalAccountProofHost{OriginalEngineSource*source=nullptr;port::HostPort port;bool retired=false,closed=false;};
static std::vector<std::unique_ptr<OriginalAccountProofHost>>hosts;
HostAcquisition acquireOriginalAccountProofHost(OriginalEngineSource*s)noexcept{
 try{EngineSelection selection;auto f=readOriginalEngineSelection(s,selection);must(!f.present&&hostAcquisitions<2);if(observedOriginalSource)must(observedOriginalSource==s);else observedOriginalSource=s;
 auto p=std::make_unique<OriginalAccountProofHost>();p->source=s;p->port.source=s;p->port.fd=inheritedTestFD[hostAcquisitions++];timeval limit{25,0};must(!setsockopt(p->port.fd,SOL_SOCKET,SO_RCVTIMEO,&limit,sizeof(limit))&&!setsockopt(p->port.fd,SOL_SOCKET,SO_SNDTIMEO,&limit,sizeof(limit)));auto*raw=p.get();hosts.push_back(std::move(p));return{raw,{}};
 }catch(...){return{nullptr,{true,0}};}
}
port::Failure readOriginalAccountProofHost(OriginalAccountProofHost*h,OriginalEngineSource*s,port::HostPort*&out)noexcept{if(!h||h->source!=s||h->closed)return{true,0};auto f=originalEngineSourceCurrent(s);if(f.present)return{f.present,f.code};out=&h->port;return{};}
port::Failure originalAccountProofHostCurrent(OriginalAccountProofHost*h,OriginalEngineSource*s)noexcept{if(!h||h->source!=s||h->retired||h->closed)return{true,0};auto f=originalEngineSourceCurrent(s);return{f.present,f.code};}
void retireOriginalAccountProofHost(OriginalAccountProofHost*h)noexcept{if(h)h->retired=true;}
port::Failure joinOriginalAccountProofHost(OriginalAccountProofHost*h)noexcept{return h&&h->retired?port::Failure{}:port::Failure{true,0};}
port::Failure closeOriginalAccountProofHost(OriginalAccountProofHost*h)noexcept{if(!h)return{true,0};if(h->closed)return{};h->retired=true;h->port.closed=true;int fd=h->port.fd;h->port.fd=-1;if(::close(fd))return{true,0};h->closed=true;++physicalHosts;return{};}
bool originalAccountProofHostClosed(OriginalAccountProofHost*h)noexcept{return h&&h->closed;}
port::Failure releaseClosedOriginalAccountProofHost(OriginalAccountProofHost*h)noexcept{return h&&h->closed?port::Failure{}:port::Failure{true,0};}
}
static void exact(const core::CapturedPolicy&captured,const std::string&expected){
 must(captured.proof.chainId=="ynx_642399-1"&&captured.proof.height==10&&captured.proof.fullAppHash==::read(expected+"/apphash.bin"));
 must(captured.historicalAccount.owner=="0xae45b350fbc6f5e66aa18c43fe464f0c5229a7e0"&&captured.historicalAccount.ledgerNonce==3&&captured.historicalAccount.executionHeight==11&&captured.historicalAccount.nativeChainID==642399);
 must(captured.historicalAccount.policyOriginal==::read(expected+"/policy.bin")&&captured.blockOriginal==::read(expected+"/block10.bin")&&captured.successorOriginal==::read(expected+"/block11.bin"));
 must(captured.historicalAccount.executionRegistration.has_value());auto&r=*captured.historicalAccount.executionRegistration;must(r.pkA==::read(expected+"/pka.bin")&&r.pkB==::read(expected+"/pkb.bin")&&r.revision==1);
}
int main(int argc,char**argv){
 try{
  must(argc==3);std::signal(SIGPIPE,SIG_IGN);now=cfg().at("at").number();std::string mode=argv[1],expected=argv[2];
  if(mode=="root0"){auto a=acquireOriginalRegisteredAccountReceipt();must(a.owner&&a.failure.present&&!a.ready&&!appCalls&&!hostAcquisitions&&!observedOriginalSource);auto e=closeOriginalReceipt(a.owner);must(e.present&&originalReceiptClosed(a.owner));std::cout<<"PASS Root0 production refusal before host/OS\n";return 0;}
  auto receipt=acquireOriginalRegisteredAccountReceipt();must(bool(receipt.owner));
  if(mode=="paired0"){
   must(receipt.failure.present&&receipt.failure.code==0&&!receipt.ready&&hostAcquisitions==1);
   auto e=closeOriginalReceipt(receipt.owner);must(e.present&&e.code==0&&originalReceiptClosed(receipt.owner)&&physicalReaders==1&&physicalHosts==1);
   unsigned before=wireOperations;closeOriginalReceipt(receipt.owner);must(wireOperations==before);
   std::cout<<"PASS actual paired0 partial/physical close ops="<<wireOperations<<"\n";return 0;
  }
  must(mode=="joint"&&!receipt.failure.present&&!receipt.ready&&receipt.pendingCause.present&&receipt.pendingCause.code==0&&observedOriginalSource);
  auto client=core::acquireCommittedAccountProof(observedOriginalSource);must(client.owner&&!client.failure.present);
  core::CapturedPolicy captured;auto pending=core::readCaptured(client.owner,captured);must(!pending.ready&&!pending.failure.present&&pending.notReady&&pending.pendingCause.present&&pending.pendingCause.code==0);
  advance('B'); // real original Go BlockExecutor commits H11, no replacement Node
  auto ready=core::readCaptured(client.owner,captured);must(ready.ready&&!ready.failure.present);exact(captured,expected);
  core::Continuation current;ready=core::current(client.owner,current);must(ready.ready&&!ready.failure.present&&current.captured.height==10&&current.currentCheckpoint.height==11&&current.currentAccount.ledgerNonce==4&&current.currentAccount.executionRegistration.has_value()&&current.currentAccount.executionRegistration->pkA==captured.historicalAccount.executionRegistration->pkA&&current.currentAccount.executionRegistration->pkB==captured.historicalAccount.executionRegistration->pkB&&current.currentAccount.policyOriginal==captured.historicalAccount.policyOriginal);
  advance('C');ready=core::current(client.owner,current);must(ready.ready&&!ready.failure.present&&current.captured.height==10&&current.currentCheckpoint.height==12&&current.currentAccount.ledgerNonce==4);
  core::retire(client.owner);must(!core::join(client.owner).present);must(!core::close(client.owner).present&&core::isClosed(client.owner)&&!core::releaseClosed(client.owner).present);
  // Existing Auth signed Source has different chain/network/owner/full pair.
  // Actual receipt must reject this real Go proof; never align public DATA to
  // invent Root/Source authority or change the original signed fixture.
  ReceiptDATA denied;auto rejected=readOriginalReceipt(receipt.owner,denied);must(!rejected.ready&&rejected.failure.present);
  auto closed=closeOriginalReceipt(receipt.owner);must(closed.present&&originalReceiptClosed(receipt.owner)&&physicalReaders==2&&physicalHosts==2);
  must(hostAcquisitions==2);std::cout<<"PASS actual Auth client NotReady/Go H10-H12/raw originals/nonce3-4; receipt mismatched Source refused; physical readers=2 hosts=2 ops="<<wireOperations<<"\n";
  return 0;
 }catch(const std::exception&e){std::cerr<<"PUBLIC joint firstcause: "<<e.what()<<"\n";return 1;}
}
