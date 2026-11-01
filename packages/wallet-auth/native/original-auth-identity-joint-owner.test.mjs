import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./original-auth-identity-joint-owner.mm',import.meta.url),'utf8'),header=readFileSync(new URL('./original-auth-identity-joint-owner.h',import.meta.url),'utf8');
// Source contract controls ONLY. No Native compilation/load, syscall, private
// file, crypto, Root/profile acquisition or grant is executed.
test('R11 PUBLIC Native source owns held namespace and bounded original profile/head reads',()=>{
 for(const token of ['NSBundle.mainBundle.resourceURL','O_NOFOLLOW','openat(_root,"profile.original"','openat(_root,"head.original"','pread(','fstatat(','AT_SYMLINK_NOFOLLOW','st_nlink==1','st_size<=65536','[profileRaw isEqual:_profileRaw]','[headRaw isEqual:_headRaw]'])assert(source.includes(token),token);
 assert(!header.includes('callback'));assert(!source.includes('getenv('));
});
test('R11 PUBLIC Native source current is custody not approval, no fresh Root or alternate purpose grant',()=>{
 assert(source.includes('AUTH_IDENTITY_SOURCE_AUTHORITY_NATIVE_PURPOSE_CODE_NOT_IMPLEMENTED'));assert.match(source,/- \(BOOL\)nativeQualified \{return NO;\}/);
 for(const token of ['SecKeyCreateRandomKey','SecKeyCreateSignature','SERVICE_ROLE','operator-device-reader','developer-project-resource'])assert(!source.includes(token),token);
});
test('R11 PUBLIC Native source joins and selects original close once without descriptor retry',()=>{
 for(const token of ['_closeSelected','_cleanupComplete','if(_entered)','_entered++','_entered--','int *fds[]={&_head,&_profile,&_root}','if(close(fd)<0)','AUTH_IDENTITY_ORIGINAL_CLOSE_UNKNOWN'])assert(source.includes(token),token);
 assert.match(source,/if\(_closeSelected\).*return _cleanupComplete/);assert(!source.includes('while(close('));
});
