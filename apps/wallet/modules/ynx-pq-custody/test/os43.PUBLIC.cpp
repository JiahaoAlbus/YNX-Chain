// PUBLIC synthetic 43-byte input only; no Keychain, Keystore, UI, credential
// item, real permit or Root is opened. Actual common port code is under test.
#include "OS43Private.h"
#include "Wrapped43Record.h"
#if defined(__APPLE__)
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/sha.h>
#endif
#include <cassert>
#include <cstring>
#include <iostream>
#include <thread>
#include <vector>
#include <algorithm>
#include <filesystem>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
using namespace ynx::mobilepq::os43;
struct YNXMobileOS43Permit {bool closed=false;};
namespace {
void digest(const uint8_t*b,size_t n,uint8_t*out){
#if defined(__APPLE__)
 CC_SHA256(b,CC_LONG(n),out);
#else
 SHA256(b,n,out);
#endif
}
struct Config {
 int permit=0,current=0,validate=0,finish=0,close=0,release=0,read=0,input=0,import=0,remove=0,itemCurrent=0;
 int permits=0,reads=0,inputs=0,validates=0,imports=0,removes=0,finishes=0,live=0,currentCalls=0,lateAt=0;
 bool partial=false,closeComplete=true,possible=true,badCredential=false;
 uint32_t level=1;int finishedCode=0;bool finishedPossible=false;
} f;
uint8_t publicBinding[]={0,1,2,3};
YNXMobileOS43Descriptor descriptor(){
 YNXMobileOS43Descriptor d{};d.version=1;d.size=sizeof(d);d.vault_revision=9;d.minimum_protection=1;d.ui_timeout_ms=1000;d.directory_fd=-1;d.original_binding={publicBinding,4};
 // Independently frame the exact agreed domain + NUL + U32BE + binding + U64BE.
 const char domain[]="YNX-MOBILE-PQ-OS43/v1";std::vector<uint8_t> frame(domain,domain+sizeof(domain));
 frame.insert(frame.end(),{0,0,0,4,0,1,2,3,0,0,0,0,0,0,0,9});
 digest(frame.data(),frame.size(),d.item_id);digest(publicBinding,4,d.binding_digest);return d;
}
YNXMobilePQCapture* capture=reinterpret_cast<YNXMobilePQCapture*>(uintptr_t(1));
void closeLoan(YNXMobileOS43Loan*l){ynx_mobile_pq_os_loan_close_v1(l);assert(ynx_mobile_pq_os_loan_release_closed_v1(l)==0);}
struct Directory {
 std::string path;YNXMobileOS43Descriptor d=descriptor();
 Directory(){char pattern[]="/tmp/ynx-wrapped43-PUBLIC-XXXXXX";char* p=mkdtemp(pattern);assert(p);path=p;assert(chmod(path.c_str(),0700)==0);d.directory_fd=open(path.c_str(),O_RDONLY|O_DIRECTORY|O_CLOEXEC);assert(d.directory_fd>=0);struct stat st{};assert(!fstat(d.directory_fd,&st));d.directory_device=st.st_dev;d.directory_inode=st.st_ino;d.directory_uid=st.st_uid;d.directory_gid=st.st_gid;}
 ~Directory(){close(d.directory_fd);std::filesystem::remove_all(path);}
 std::string file(){return path+"/"+itemID(d)+".wrapped43";}
 std::vector<uint8_t> record(){auto aad=metadata(d);std::vector<uint8_t> b(aad.begin(),aad.end());b.resize(159,0xFA);return b;}
};
template<class F>void control(const char* name,F run){assert(f.live==0);f=Config{};run();assert(f.live==0);std::cout<<"PASS "<<name<<"\n";}
}
extern "C" {
int32_t ynx_auth_mobile_pq_os_acquire_permit_v1(YNXMobilePQCapture*c,const YNXMobileOS43Descriptor*,uint32_t action,YNXMobileOS43Permit**out){assert(c==capture&&action>=1&&action<=3);f.permits++;if(!f.permit||f.partial){*out=new YNXMobileOS43Permit;f.live++;}return f.permit;}
int32_t ynx_auth_mobile_pq_os_permit_current_v1(YNXMobileOS43Permit*){f.currentCalls++;return f.lateAt==f.currentCalls?9200:f.current;}
int32_t ynx_auth_mobile_pq_os_validate_original43_v1(YNXMobileOS43Permit*,const uint8_t*bytes,size_t n){assert(n==43&&bytes[0]=='A');f.validates++;return f.validate;}
int32_t ynx_auth_mobile_pq_os_finish_v1(YNXMobileOS43Permit*,int32_t code,uint32_t effect){f.finishes++;f.finishedCode=code;f.finishedPossible=effect;return f.finish;}
int32_t ynx_auth_mobile_pq_os_close_permit_v1(YNXMobileOS43Permit*p){if(f.closeComplete)p->closed=true;return f.close;}
int32_t ynx_auth_mobile_pq_os_release_closed_permit_v1(YNXMobileOS43Permit*p){if(!p->closed||f.release)return f.release?f.release:9300;delete p;f.live--;return 0;}
}
namespace ynx::mobilepq::os43 {
int32_t platformSHA256(const uint8_t*b,size_t n,uint8_t*out){digest(b,n,out);return 0;}
int32_t platformRead(const YNXMobileOS43Descriptor&,Credential& c,YNXMobileOS43Protection&p){f.reads++;c.fill('A');if(f.badCredential)c[42]='B';p.platform=1;p.protection=f.level;p.user_presence=1;return f.read;}
int32_t platformCurrent(const YNXMobileOS43Descriptor&,const YNXMobileOS43Protection&){return f.itemCurrent;}
int32_t platformInput(const YNXMobileOS43Descriptor&,Credential&c){f.inputs++;c.fill('A');if(f.badCredential)c[42]='B';return f.input;}
Effect platformImportAbsent(const YNXMobileOS43Descriptor&,const Credential&c){assert(c[0]=='A');f.imports++;return {f.import,f.possible};}
Effect platformRemoveExact(const YNXMobileOS43Descriptor&){f.removes++;return {f.remove,f.possible};}
}
int main(){
 control("agreed domain/fullbinding/revision independently derives the item ref",[]{auto d=descriptor();assert(validateIdentity(d)==0);assert(itemID(d).size()==64);auto aad=metadata(d);assert(aad.size()==88&&aad[15]==9);});
 control("altered binding, epoch or digest never reaches Source or OS",[]{for(int kind=0;kind<3;++kind){auto d=descriptor();if(kind==0)d.item_id[0]^=1;else if(kind==1)d.vault_revision++;else d.binding_digest[0]^=1;YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_borrow43_v1(capture,&d,&l)==changed);assert(!l);}assert(f.permits==0&&f.reads==0);});
 control("Root0 permit refuses before OS item read or prompt",[]{f.permit=9400;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_borrow43_v1(capture,&d,&l)==9400);assert(l&&f.reads==0);closeLoan(l);});
 control("partial denied permit remains explicitly closeable",[]{f.permit=9401;f.partial=true;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_borrow43_v1(capture,&d,&l)==9401);assert(f.live==1);closeLoan(l);});
 control("borrowed EXACT43 stays Native, copied protection is factual metadata",[]{auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&l));const uint8_t*b=nullptr;size_t n=0;assert(!ynx_mobile_pq_os_loan_bytes_v1(l,&b,&n)&&n==43&&b[0]=='A');YNXMobileOS43Protection p{};p.version=1;p.size=sizeof(p);assert(!ynx_mobile_pq_os_loan_protection_v1(l,&p)&&p.protection==1);assert(!ynx_mobile_pq_os_loan_close_v1(l));assert(std::all_of(b,b+43,[](auto c){return c==0;}));assert(!ynx_mobile_pq_os_loan_release_closed_v1(l));});
 control("software protection is never claimed as requested hardware",[]{auto d=descriptor();d.minimum_protection=2;YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_borrow43_v1(capture,&d,&l)==denied);const uint8_t*b=nullptr;size_t n=0;assert(ynx_mobile_pq_os_loan_bytes_v1(l,&b,&n)!=0&&b==nullptr&&n==0);closeLoan(l);});
 control("noncanonical 43-byte credential cannot be borrowed",[]{f.badCredential=true;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_borrow43_v1(capture,&d,&l)==denied);closeLoan(l);});
 control("late Source loss wipes the borrowed value and refuses bytes",[]{f.lateAt=2;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_borrow43_v1(capture,&d,&l)==9200);const uint8_t*b=nullptr;size_t n=0;assert(ynx_mobile_pq_os_loan_bytes_v1(l,&b,&n)!=0&&b==nullptr);closeLoan(l);});
 control("OS item replacement invalidates the same loan",[]{auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&l));f.itemCurrent=changed;assert(ynx_mobile_pq_os_loan_current_v1(l)==changed);closeLoan(l);});
 control("foreign thread cannot read or close borrowed43",[]{auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&l));std::thread other([&]{assert(ynx_mobile_pq_os_loan_current_v1(l)==wrongThread);assert(ynx_mobile_pq_os_loan_close_v1(l)==wrongThread);});other.join();closeLoan(l);});
 control("sticky permit close error still uses real closed-release gate",[]{f.close=9500;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&l));assert(ynx_mobile_pq_os_loan_close_v1(l)==9500);assert(!ynx_mobile_pq_os_loan_release_closed_v1(l));});
 control("unclosed permit debt cannot be released or hidden",[]{f.closeComplete=false;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&l));assert(ynx_mobile_pq_os_loan_close_v1(l)==9300);assert(ynx_mobile_pq_os_loan_release_closed_v1(l)==closed);f.closeComplete=true;closeLoan(l);});
 control("import validates original backup43 BEFORE any create",[]{f.validate=9600;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_import_original43_v1(capture,&d,&l)==9600);assert(f.inputs==1&&f.validates==1&&f.imports==0&&f.finishes==1&&!f.finishedPossible);closeLoan(l);});
 control("cancelled native input never creates an OS item",[]{f.input=cancelled;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_import_original43_v1(capture,&d,&l)==cancelled);assert(f.imports==0&&f.finishes==1);closeLoan(l);});
 control("nonempty import is original failure, never overwrite or remove",[]{f.import=exists;f.possible=false;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_import_original43_v1(capture,&d,&l)==exists);assert(f.imports==1&&f.removes==0&&!f.finishedPossible);closeLoan(l);});
 control("import lost ACK keeps possible effect; never rollback item",[]{f.finish=9700;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_import_original43_v1(capture,&d,&l)==9700);assert(f.finishedPossible&&f.imports==1&&f.removes==0);closeLoan(l);});
 control("remove requires its own real permit before backend cleanup",[]{f.permit=9800;auto d=descriptor();YNXMobileOS43Loan*l=nullptr;assert(ynx_mobile_pq_os_remove_exact43_v1(capture,&d,&l)==9800);assert(f.removes==0);closeLoan(l);});
 control("closed opaque token cannot ABA into a different loan",[]{auto d=descriptor();YNXMobileOS43Loan*first=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&first));closeLoan(first);YNXMobileOS43Loan*second=nullptr;assert(!ynx_mobile_pq_os_borrow43_v1(capture,&d,&second));assert(first!=second&&ynx_mobile_pq_os_loan_current_v1(first)==invalid);closeLoan(second);});
 control("actual protected ciphertext cold write/read preserves mother dirfd",[]{Directory dir;{auto lock=storage_only::lockDirectory(dir.d);assert(lock.valid());auto r=storage_only::writeAbsent(dir.d,lock,dir.record());assert(!r.code&&r.possible);}std::vector<uint8_t> read;assert(!storage_only::readRecord(dir.d,read)&&read==dir.record());assert(fcntl(dir.d.directory_fd,F_GETFD)>=0);});
 control("actual nonempty ciphertext file cannot be overwritten",[]{Directory dir;auto lock=storage_only::lockDirectory(dir.d);assert(storage_only::writeAbsent(dir.d,lock,dir.record()).code==0);auto changedBytes=dir.record();changedBytes.back()^=1;auto r=storage_only::writeAbsent(dir.d,lock,changedBytes);assert(r.code==exists&&!r.possible);std::vector<uint8_t> bytes;assert(!storage_only::readRecord(dir.d,bytes)&&bytes==dir.record());});
 control("physical record refuses unprotected directory identity and mode",[]{Directory dir;assert(chmod(dir.path.c_str(),0755)==0);assert(!storage_only::lockDirectory(dir.d).valid());std::vector<uint8_t> out{9};assert(storage_only::readRecord(dir.d,out)==changed&&out==std::vector<uint8_t>{9});assert(!chmod(dir.path.c_str(),0700));dir.d.directory_inode++;assert(!storage_only::lockDirectory(dir.d).valid());});
 control("physical record refuses symlink and hardlink substitution",[]{Directory dir;assert(!symlink("/dev/null",dir.file().c_str()));std::vector<uint8_t> bytes;assert(storage_only::readRecord(dir.d,bytes)!=0);assert(!unlink(dir.file().c_str()));auto lock=storage_only::lockDirectory(dir.d);assert(!storage_only::writeAbsent(dir.d,lock,dir.record()).code);assert(!link(dir.file().c_str(),(dir.path+"/other").c_str()));assert(storage_only::readRecord(dir.d,bytes)==changed);});
 control("ciphertext record mode and exact framing are mandatory",[]{Directory dir;auto lock=storage_only::lockDirectory(dir.d);auto shortRecord=dir.record();shortRecord.pop_back();assert(storage_only::writeAbsent(dir.d,lock,shortRecord).code==invalid);assert(!std::filesystem::exists(dir.file()));assert(!storage_only::writeAbsent(dir.d,lock,dir.record()).code);assert(!chmod(dir.file().c_str(),0644));std::vector<uint8_t> bytes;assert(storage_only::readRecord(dir.d,bytes)==changed);});
 control("OS-directory lock collision refuses without takeover",[]{Directory dir;auto held=storage_only::lockDirectory(dir.d);assert(held.valid());assert(!storage_only::lockDirectory(dir.d).valid());assert(fcntl(dir.d.directory_fd,F_GETFD)>=0);});
 control("exact remove refuses a replacement inode and preserves new file",[]{Directory dir;auto lock=storage_only::lockDirectory(dir.d);assert(!storage_only::writeAbsent(dir.d,lock,dir.record()).code);std::vector<uint8_t> bytes;storage_only::Identity original;assert(!storage_only::readRecord(dir.d,bytes,&original));assert(!rename(dir.file().c_str(),(dir.path+"/old").c_str()));assert(!storage_only::writeAbsent(dir.d,lock,dir.record()).code);assert(storage_only::removeExact(dir.d,lock,original)==changed&&std::filesystem::exists(dir.file()));});
 control("actual exact ciphertext cleanup fsyncs and retains mother fd",[]{Directory dir;auto lock=storage_only::lockDirectory(dir.d);assert(!storage_only::writeAbsent(dir.d,lock,dir.record()).code);std::vector<uint8_t> bytes;storage_only::Identity original;assert(!storage_only::readRecord(dir.d,bytes,&original));assert(!storage_only::removeExact(dir.d,lock,original));assert(storage_only::readRecord(dir.d,bytes)==missing&&fcntl(dir.d.directory_fd,F_GETFD)>=0);});
 std::cout<<"26 PUBLIC OS-port/physical-ciphertext controls passed; actual OS services and Root not executed\n";
}
