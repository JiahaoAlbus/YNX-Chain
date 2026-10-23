import {readdir,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';

const ownedAssistantIDs=new Set(['ynx.ynx-tools']);
const thirdPartyAssistantIDs=new Set(['openai.chatgpt','github.copilot','github.copilot-chat']);
const hasContribution=value=>Array.isArray(value)?value.length>0:value!==null&&typeof value==='object'&&Object.keys(value).length>0;

// Distribution input only. Never walk or change an installed user's profile.
// Check actual extension metadata, not just the reviewed input-list labels.
export async function assertBundledAssistantPolicy(coreRoot){
  const root=join(coreRoot,'plugins'),extensions=[];
  for(const entry of await readdir(root,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw Error('Bundled extension must not be a symbolic link.');
    if(!entry.isDirectory())continue;
    const metadataPath=join(root,entry.name,'package.json');
    const stat=await lstat(metadataPath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw Error('Invalid bundled extension metadata.');
    const metadata=JSON.parse(await readFile(metadataPath,'utf8'));
    const id=`${metadata.publisher}.${metadata.name}`;
    if(typeof metadata.publisher!=='string'||typeof metadata.name!=='string')throw Error('Missing bundled extension identity.');
    // Qwen/Qianwen identifiers and localized branding must never ship as a
    // preinstalled assistant, even under a renamed input directory.
    const identity=[entry.name,id,metadata.displayName,metadata.description].filter(v=>typeof v==='string').join('\n');
    if(/qwen|qianwen|通义千问|千问/i.test(identity))throw Object.assign(Error('Qwen is not permitted in the YNX distribution.'),{code:'YNX_BUNDLED_QWEN_REFUSED'});
    // An assistant that uses the standard chat/provider contribution points
    // cannot slip into the distribution by changing its branding or folder.
    // Existing package pins still bind all code bytes: an ID alone is not
    // proof of model ownership or permission to call an online provider.
    const assistant=thirdPartyAssistantIDs.has(id.toLowerCase())
      ||hasContribution(metadata.contributes?.chatParticipants)
      ||hasContribution(metadata.contributes?.languageModelChatProviders);
    if(assistant&&!ownedAssistantIDs.has(id))throw Object.assign(Error('Only the owned YNX assistant may be bundled.'),{code:'YNX_BUNDLED_THIRD_PARTY_ASSISTANT_REFUSED'});
    extensions.push({id,version:metadata.version});
  }
  return Object.freeze({policy:'YNX_OWN_ASSISTANT_DEFAULT_V2',noBundledQwen:true,noBundledThirdPartyAssistant:true,extensions:Object.freeze(extensions.sort((a,b)=>a.id.localeCompare(b.id)))});
}
