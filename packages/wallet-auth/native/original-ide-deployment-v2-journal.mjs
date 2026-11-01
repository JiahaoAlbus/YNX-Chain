// Original Native dirfd backend owns O_EXCL/fsync/readback and parent/current
// identity. This owning journal never creates/replays a new signing operation.
import {canonical,sha} from './original-auth-identity-source-verifier.mjs';
import {exact,fail} from './original-ide-deployment-v2-contract.mjs';
export class OriginalIDEDeploymentV2OnceJournal{
 #io;#selected;#loan;#key;#entry;#entered=false;#used=false;#unknown=false;#first;#retired=false;#closeSelected=false;#closeFirst;
 constructor(io,releaseSelectedDirectory){this.#io=io;this.#selected=structuredClone(releaseSelectedDirectory);}
 #alive(){if(this.#unknown||this.#retired||this.#closeSelected)fail('IDE_DEPLOYMENT_V2_JOURNAL_UNRESOLVED');}
 #current(){this.#alive();if(this.#io.ready(this.#loan)!==undefined)fail('IDE_DEPLOYMENT_V2_JOURNAL_CURRENT');}
 #remember(e){this.#unknown=true;this.#first??=e;return this.#first;}
 reserveOriginal(context){
  if(this.#entered||this.#used)fail('IDE_DEPLOYMENT_V2_JOURNAL_ALREADY_SELECTED');this.#used=true;this.#entered=true;
  try{
   this.#alive();exact(context,['sourceId','instanceId','requestId','payloadBinding','scopeDigest','sourceCurrentSHA256']);
   exact(this.#selected,['parent','leaf']);
   this.#loan=this.#io.openV2(this.#selected.parent,this.#selected.leaf); // retain BEFORE ready/list
   this.#current();const names=this.#io.list(this.#loan);if(!Array.isArray(names)||names.length>4096||new Set(names).size!==names.length||names.some(n=>!/^[a-f0-9]{64}\.(entered|terminal)$/.test(n)))fail('IDE_DEPLOYMENT_V2_JOURNAL_HISTORY');
   this.#key=sha(canonical({sourceId:context.sourceId,instanceId:context.instanceId,requestId:context.requestId}));
   if(names.includes(this.#key+'.entered')||names.includes(this.#key+'.terminal')){this.#entry=this.#io.read(this.#loan,this.#key+'.entered')??'';return{status:23,reservationOriginal:this.#entry};}
   this.#entry=canonical({version:'ynx-ide-deployment-once/v2',...context});
   this.#io.write(this.#loan,this.#key+'.entered',this.#entry);
   if(this.#io.read(this.#loan,this.#key+'.entered')!==this.#entry)fail('IDE_DEPLOYMENT_V2_JOURNAL_RESERVE_READBACK_UNKNOWN');this.#current();return{status:0,reservationOriginal:this.#entry};
  }catch(e){this.#remember(e);return{status:23,reservationOriginal:this.#entry??'',cause:e};}finally{this.#entered=false;}
 }
 completeOriginal(memberOriginal,sourceCurrentSHA256){
  if(this.#entered)fail('IDE_DEPLOYMENT_V2_JOURNAL_REENTRANT');this.#entered=true;
  try{this.#current();if(!this.#entry||this.#io.read(this.#loan,this.#key+'.entered')!==this.#entry)fail('IDE_DEPLOYMENT_V2_JOURNAL_ORIGINAL_CHANGED');const raw=canonical({version:'ynx-ide-deployment-terminal/v2',entrySHA256:sha(this.#entry),memberOriginal,sourceCurrentSHA256});this.#io.write(this.#loan,this.#key+'.terminal',raw);if(this.#io.read(this.#loan,this.#key+'.terminal')!==raw)fail('IDE_DEPLOYMENT_V2_JOURNAL_TERMINAL_READBACK_UNKNOWN');this.#current();return{status:0};}catch(e){this.#remember(e);return{status:23,cause:e};}finally{this.#entered=false;}
 }
 assertOriginalCurrent(){this.#current();if(this.#key&&this.#io.read(this.#loan,this.#key+'.entered')!==this.#entry)fail('IDE_DEPLOYMENT_V2_JOURNAL_ORIGINAL_CHANGED');}
 retire(){this.#retired=true;}
 join(){if(this.#entered)fail('IDE_DEPLOYMENT_V2_JOURNAL_JOIN_PENDING');}
 close(){if(this.#closeSelected){if(this.#closeFirst)throw this.#closeFirst;return;}this.retire();this.join();this.#closeSelected=true;try{if(this.#loan&&this.#io.close(this.#loan)!==undefined)fail('IDE_DEPLOYMENT_V2_JOURNAL_CLOSE_UNKNOWN');}catch(e){this.#closeFirst=e;throw e;}}
 status(){return Object.freeze({unknown:this.#unknown,firstCause:this.#first?.code??null,entryOriginal:this.#entry??'',closeSelected:this.#closeSelected,closeFirst:this.#closeFirst?.code??null});}
}
