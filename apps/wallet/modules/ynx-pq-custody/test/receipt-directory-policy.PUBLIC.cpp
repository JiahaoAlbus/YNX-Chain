#include "NativeReceiptDirectoryPolicy.h"
#include <cassert>
#include <iostream>
using namespace ynx::mobilepq::registered;
namespace auth=ynx::auth::mobile::receipt;
int main(){
 auth::OriginalSourceSelection source;source.mode=2;source.platform="android";source.applicationId="PUBLIC-app";source.protectedResourceRef="PUBLIC-source-resource";source.networkId="PUBLIC-network";source.account="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
 auth::DirectoryDATA directory;directory.role=1;directory.rootLocator="PUBLIC-source-locator";
#ifndef YNX_NATIVE_RECEIPT_DIRECTORY_PUBLIC_CONTROLS
 assert(!matchesNativeCompiledReceiptDirectory(source,directory));
 std::cout<<"PASS normal compiled empty Native map cannot be supplied by Auth DATA\n";
#else
 assert(matchesNativeCompiledReceiptDirectory(source,directory));
 for(unsigned field=0;field<6;++field){auto changed=source;switch(field){case 0:changed.mode=1;break;case 1:changed.platform="ios";break;case 2:changed.applicationId+="other";break;case 3:changed.protectedResourceRef+="other";break;case 4:changed.networkId+="other";break;case 5:changed.account.back()='b';break;}assert(!matchesNativeCompiledReceiptDirectory(changed,directory));}
 std::cout<<"PASS independent Native identity rejects another mode/app/resource/network/account\n";
 for(unsigned role:{0,2,3,4}){auto changed=directory;changed.role=role;assert(!matchesNativeCompiledReceiptDirectory(source,changed));}
 std::cout<<"PASS absent independent roles cannot alias the Source directory\n";
 for(auto locator:{"PUBLIC-source-resource","PUBLIC-source-locator-extra",""}){auto changed=directory;changed.rootLocator=locator;assert(!matchesNativeCompiledReceiptDirectory(source,changed));}
 std::cout<<"PASS resourceRef or a similar locator is not the compiled Root locator\n";
 source.applicationId="PUBLIC-ambiguous";assert(!matchesNativeCompiledReceiptDirectory(source,directory));
 std::cout<<"PASS ambiguous compiled Native rows are refused\n";
#endif
}
