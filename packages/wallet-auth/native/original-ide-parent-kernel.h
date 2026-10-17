#pragma once
#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import <mach/message.h>
#include "original-ide-parent-prelude.h"
#include "original-ide-parent-source-binding.h"
#include <vector>
#include <sys/stat.h>
namespace ynx_auth_ide_private {
struct ResourceCloseDebt {struct Entry {int descriptor;struct stat identity;};std::vector<Entry> unknown;bool clean()const{return unknown.empty();}};
struct KernelProcess {ProcessOriginal original{};NSData *__strong codeIdentity=nil;NSString *__strong image=nil;};
KernelProcess observeKernel(pid_t);
audit_token_t originalSelfAudit();
bool verifyKernelAudit(const std::array<unsigned char,32>&,const ProcessOriginal&);
bool sameKernel(const KernelProcess&,const KernelProcess&);
NSString *actualNodeParentResources();
bool actualNodeEntry(NSString *resources,NSString *entryFileURL);
bool registeredResources(NSString *resources,const SourceBinding&,ResourceCloseDebt&);
std::array<unsigned char,32> originalRequestDigest(const SourceBinding&);
Prelude originalPrelude(PreludeKind,const SourceBinding&);
bool originalPreludeBinding(const Prelude&,const SourceBinding&);
std::uint64_t monotonicMS();
std::uint64_t wallMS();
}
#endif
