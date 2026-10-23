import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {assertBundledAssistantPolicy} from './bundled-assistant-policy.mjs';
test('release inspects actual renamed Qwen metadata and leaves user extensions intact',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-assistant-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const core=join(root,'core'),plugin=join(core,'plugins','renamed'),user=join(root,'user-extensions','qwen');await mkdir(plugin,{recursive:true});await mkdir(user,{recursive:true});
 const original=JSON.stringify({publisher:'Qwen',name:'qwen-code',version:'1.0.0'});await writeFile(join(user,'package.json'),original);
 await writeFile(join(plugin,'package.json'),original);
 await assert.rejects(assertBundledAssistantPolicy(core),{code:'YNX_BUNDLED_QWEN_REFUSED'});
 await writeFile(join(plugin,'package.json'),JSON.stringify({publisher:'ynx',name:'ynx-tools',version:'1.0.0'}));
 const result=await assertBundledAssistantPolicy(core);assert.equal(result.noBundledQwen,true);assert.deepEqual(result.extensions,[{id:'ynx.ynx-tools',version:'1.0.0'}]);assert.equal(await readFile(join(user,'package.json'),'utf8'),original);
 await writeFile(join(plugin,'package.json'),JSON.stringify({publisher:'vendor',name:'assistant',displayName:'通义千问',version:'1.0.0'}));
 await assert.rejects(assertBundledAssistantPolicy(core),{code:'YNX_BUNDLED_QWEN_REFUSED'});
});
test('only the owned assistant may be preinstalled, while language extensions remain available',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ynx-owned-assistant-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const plugin=join(root,'plugins','renamed');await mkdir(plugin,{recursive:true});
 for(const metadata of [
  {publisher:'openai',name:'chatgpt'},
  {publisher:'github',name:'copilot-chat'},
  {publisher:'vendor',name:'renamed',contributes:{chatParticipants:[{id:'vendor.assistant',name:'Helper'}]}},
  {publisher:'vendor',name:'provider',contributes:{languageModelChatProviders:[{vendor:'vendor'}]}}
 ]){
  await writeFile(join(plugin,'package.json'),JSON.stringify({...metadata,version:'1.0.0'}));
  await assert.rejects(assertBundledAssistantPolicy(root),{code:'YNX_BUNDLED_THIRD_PARTY_ASSISTANT_REFUSED'});
 }
 await writeFile(join(plugin,'package.json'),JSON.stringify({publisher:'ynx',name:'ynx-tools',version:'1.0.0',contributes:{chatParticipants:[{id:'ynx.assistant',name:'YNX'}]}}));
 const own=await assertBundledAssistantPolicy(root);assert.equal(own.noBundledThirdPartyAssistant,true);
 await writeFile(join(plugin,'package.json'),JSON.stringify({publisher:'vscode',name:'typescript-language-features',version:'1.0.0',contributes:{languages:[{id:'typescript'}],commands:[{command:'typescript.reloadProjects',title:'Reload'}]}}));
 assert.deepEqual((await assertBundledAssistantPolicy(root)).extensions,[{id:'vscode.typescript-language-features',version:'1.0.0'}]);
});
