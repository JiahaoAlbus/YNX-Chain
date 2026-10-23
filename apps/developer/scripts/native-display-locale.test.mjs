import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {NativeWorkbenchCommands}=require('../runtime/ynx-workbench/lib/native-workbench-commands.js');
test('normal frontend locale bridge preserves installed language choices beyond English and Chinese',()=>{
  for(const locale of ['en','zh-cn','de','fr','ja','pt-br','zh-tw','sr-Latn','es-419']){
    const messages=[],target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>messages.push(value)}}}};
    new NativeWorkbenchCommands({},target,locale).onStart();
    assert.deepEqual(messages,[{action:'locale',locale},{action:'debug-command-state',stopEnabled:false,restartEnabled:false}]);
  }
});
test('frontend locale bridge rejects malformed language values without changing the command surface',()=>{
  for(const locale of ['../secret','de--DE','en\nprivate','',null,{},'x'.repeat(64)]){
    const messages=[],target={webkit:{messageHandlers:{ynxLocalWorkbench:{postMessage:value=>messages.push(value)}}}};
    new NativeWorkbenchCommands({},target,locale).onStart();
    assert.deepEqual(messages,[{action:'locale',locale:'en'},{action:'debug-command-state',stopEnabled:false,restartEnabled:false}]);
  }
});
test('actual Foundation locale persistence keeps standard plugin languages and rejects unsafe values',{
  skip:process.platform!=='darwin'?'Foundation requires macOS':false,
},async()=>{
  const main=await readFile(new URL('../desktop/macos/main.m',import.meta.url),'utf8');
  let helpers;
  if(main.includes('#import "ynx-native-display-locale.h"'))helpers=await readFile(new URL('../desktop/macos/ynx-native-display-locale.h',import.meta.url),'utf8');
  else{
    // Read actual predecessor functions for the RED case, not replacement
    // locale logic in a fixture. The repaired App imports the same new header.
    helpers=main.match(/static BOOL YNXLocalLocalePayload\(id value\) \{[\s\S]*?\n\}/)[0]+'\n'+main.match(/static NSString \*YNXLocalStoredLocale\(id value\) \{[^\n]+\}/)[0];
  }
  const root=await realpath(await mkdtemp(join(tmpdir(),'ynx-native-locale-')));
  try{
    const file=join(root,'locale.m'),binary=join(root,'locale');
    await writeFile(join(root,'fixture-locale.h'),helpers);
    await writeFile(file,`#import <Foundation/Foundation.h>\n#import "fixture-locale.h"\nint main(){@autoreleasepool{
      for(NSString *locale in @[@"en",@"zh-cn",@"de",@"fr",@"ja",@"pt-br",@"zh-tw",@"sr-Latn",@"es-419"]){
        if(!YNXLocalLocalePayload(@{@"action":@"locale",@"locale":locale})||![YNXLocalStoredLocale(locale)isEqual:locale])return 11;
      }
      for(id locale in @[@"../secret",@"de--DE",@"en_private",@"en\\nprivate",@"",@1]){
        if(YNXLocalLocalePayload(@{@"action":@"locale",@"locale":locale})||![YNXLocalStoredLocale(locale)isEqual:@"en"])return 12;
      }
      if(YNXLocalLocalePayload(@{@"action":@"locale",@"locale":@"de",@"extra":@YES}))return 13;
      return 0;}}`);
    execFileSync('/Library/Developer/CommandLineTools/usr/bin/clang',['-fobjc-arc','-Werror','-isysroot','/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk','-framework','Foundation',file,'-o',binary],{stdio:'pipe',timeout:20000});
    execFileSync(binary,[],{stdio:'pipe',timeout:5000});
  }finally{await rm(root,{recursive:true,force:true});}
});
