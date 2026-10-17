#include "original-ide-public-originals.h"
#include <cassert>
#include <iostream>
#include <unistd.h>
using namespace ynx_auth_ide_private;
int main(){
 assert(originalIDERegistryBase(501)=="/Library/Application Support/YNX/OriginalAuthIdentity/UID-501/Developer");
 assert(originalIDERegistryBase(0)=="/Library/Application Support/YNX/OriginalAuthIdentity/UID-0/Developer");
 struct stat directory{};directory.st_mode=S_IFDIR|0755;directory.st_uid=0;assert(originalIDERegistryDirectory(directory));
 for(auto mode:{S_IFDIR|0775,S_IFDIR|0777,S_IFLNK|0755,S_IFREG|0644}){auto changed=directory;changed.st_mode=mode;assert(!originalIDERegistryDirectory(changed));}
 auto user=directory;user.st_uid=getuid()?getuid():501;assert(!originalIDERegistryDirectory(user));
 struct stat file{};file.st_mode=S_IFREG|0644;file.st_uid=0;file.st_nlink=1;file.st_size=256;assert(originalIDERegistryPublicFile(file));
 for(unsigned kind=0;kind<6;kind++){auto changed=file;switch(kind){case 0:changed.st_uid=501;break;case 1:changed.st_nlink=2;break;case 2:changed.st_size=0;break;case 3:changed.st_size=65537;break;case 4:changed.st_mode=S_IFLNK|0644;break;case 5:changed.st_mode=S_IFREG|0666;break;}assert(!originalIDERegistryPublicFile(changed));}
 // An actual read-only OS observation; no system path creation/provisioning.
 struct stat actual{};assert(lstat("/",&actual)==0);assert(originalIDERegistryDirectory(actual));
 std::cout<<"PASS production public-originals layout predicates: UID-derived literal, root/mode/type/nlink/bytes rejection; no Root grant or system mutation\n";
}
