import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
test('native startup disk failure is explicit, localized and bounded to owned startup exit',async()=>{
 const root=process.env.YNX_STARTUP_FAILURE_TEST_ROOT;assert.ok(root,'Provide external QA root');
 const directory=await mkdtemp(join(root,'startup-format-')),source=dirname(fileURLToPath(import.meta.url));
 const code=`#import "ynx-startup-failure.h"
#include <assert.h>
int main(){@autoreleasepool{
 NSString *log=@"/QA/logs/owned.log";
 NSString *zh=YNXLocalStartupExitMessage(74,YES,NO,@"zh-cn",log),*en=YNXLocalStartupExitMessage(74,YES,NO,@"en",log);
 assert([zh containsString:@"磁盘空间不足"]&&[zh containsString:@"打开文件夹"]&&[zh containsString:log]);
 assert([en containsString:@"not enough space"]&&[en containsString:@"File → Open Folder"]&&[en containsString:log]);
 assert(zh.length<1024&&en.length<1024);
 for(int code=0;code<256;code++){if(code==74)continue;NSString *message=YNXLocalStartupExitMessage(code,YES,NO,@"zh-cn",log);assert(![message containsString:@"磁盘空间不足"]);}
 assert([YNXLocalStartupExitMessage(74,NO,NO,@"zh-cn",log) hasPrefix:@"Local server exited"]);
 assert([YNXLocalStartupExitMessage(74,YES,YES,@"zh-cn",log) hasPrefix:@"Local server exited"]);
 assert([YNXLocalStartupExitMessage(1,YES,NO,@"en",nil) isEqual:@"Local server exited with code 1. Log: unavailable"]);
 puts("STARTUP_FAILURE_FORMAT_PASS");return 0;}}
`;
 const input=join(directory,'test.m'),binary=join(directory,'test');await writeFile(input,code);
 const env={PATH:'/usr/bin:/bin',TMPDIR:directory,DEVELOPER_DIR:'/Library/Developer/CommandLineTools'};
 execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk','-fobjc-arc','-I',join(source,'macos'),input,'-framework','Foundation','-o',binary],{env});
 assert.match(execFileSync(binary,[],{env,encoding:'utf8'}),/STARTUP_FAILURE_FORMAT_PASS/);
 const main=await readFile(join(source,'macos/main.m'),'utf8');
 assert.ok(main.includes('if(task!=weakSelf.server||'));
 assert.ok(main.includes('weakSelf.localWorkbenchMode&&task.terminationStatus==73'));
 assert.ok(main.includes('weakSelf.localWorkbenchMode?YNXLocalStartupExitMessage(task.terminationStatus,task.terminationReason==NSTaskTerminationReasonExit,weakSelf.localEditorDocumentLoaded'));
});
