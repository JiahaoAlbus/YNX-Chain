// Host FD/custody controls on real temporary files, never an installed iOS App.
#include "InstalledApplicationOriginal.ios.mm"
#include <cassert>
#include <cstdio>
#include <iostream>
using namespace ynx::sdk::mobileapplication;
int main(){@autoreleasepool {
 char root[]="/tmp/p08-install-originals-XXXXXX";assert(mkdtemp(root));
 const std::string path=std::string(root)+"/original",replacement=std::string(root)+"/replacement",link=std::string(root)+"/link";
 auto write=[](const std::string&p,const char*text){int fd=open(p.c_str(),O_CREAT|O_TRUNC|O_WRONLY,0600);assert(fd>=0);assert(::write(fd,text,3)==3);assert(!::close(fd));};
 write(path,"abc");HeldFile original;assert(hold(path,original));assert(isCurrent(original));
 assert(original.digest=="ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
 write(replacement,"abc");assert(!rename(replacement.c_str(),path.c_str()));assert(!isCurrent(original));
 HeldFile next;assert(hold(path,next));assert(isCurrent(next));assert(!chmod(path.c_str(),0400));assert(!isCurrent(next));
 assert(!chmod(path.c_str(),0600));HeldFile sameBytes;assert(hold(path,sameBytes));write(path,"abd");assert(!isCurrent(sameBytes));
 write(replacement,"abc");assert(!symlink(replacement.c_str(),link.c_str()));HeldFile symlinkFile;assert(!hold(link,symlinkFile));
 HeldFile resolved;assert(hold(resolvePath([NSString stringWithUTF8String:replacement.c_str()]),resolved));resolved.observedPath=link;assert(isCurrent(resolved));
 assert(!unlink(link.c_str()));assert(!symlink(path.c_str(),link.c_str()));assert(!isCurrent(resolved));
 assert(identityDigest({"ios","com.ynxweb4.ai",std::string(64,'0'),std::string(64,'0'),std::string(64,'0'),std::string(64,'0'),std::string(64,'0'),std::string(64,'0')})=="3bc1d44f92764fba3f2fc5cc4ea71c58edfb5a541ee03233742d8c7a1859fdeb");
 std::unique_ptr<InstalledApplicationOriginal>owner;const auto failure=InstalledApplicationOriginal::acquire(owner);
 assert(owner&&failure.present);Capture captured;assert(owner->readCaptured(captured).present);
 bool closed=true;std::thread other([&]{assert(owner->close(closed).present);assert(!closed);});other.join();
 owner->retire();assert(!owner->close(closed).present&&closed);closed=false;assert(!owner->close(closed).present&&closed);
 assert(!unlink(link.c_str()));assert(!unlink(path.c_str()));assert(!unlink(replacement.c_str()));assert(!rmdir(root));
 std::cout<<"PUBLIC real-files: hash, inode replacement, permission/content/path changes, symlink rejection, identity preimage, partial/wrong-actor/close PASS; installed/Root/Source false\n";
}}
