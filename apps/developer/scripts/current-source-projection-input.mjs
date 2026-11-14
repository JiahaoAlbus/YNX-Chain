import {readFile,lstat,realpath} from'node:fs/promises';import{createHash}from'node:crypto';import{dirname,join}from'node:path';
export const currentProjectionHandoff='/REDACTED_VOLUME/YNX-large-work/wallet-auth-owned-ci-20261026/sdk49-ide-runtime-source-projection-successor-20261101/HANDOFF.json';
export async function readProjectionPin(row){const s=await lstat(row.path),b=await readFile(row.path);if(!s.isFile()||s.isSymbolicLink()||await realpath(row.path)!==row.path||b.length!==row.bytes||createHash('sha256').update(b).digest('hex')!==row.sha256)throw Error('Exact current source projection input differs: '+row.path);return b;}
export async function currentSourceProjectionInput(){
 const h=JSON.parse(await readProjectionPin({path:currentProjectionHandoff,bytes:11087,sha256:'6c2f65a34fc108286287e56ebc6d9c77d4d9d130ce473a33035776d5bd48fc75'}));
 if(h.schema!=='YNX_SDK_IDE_RUNTIME_SOURCE_PROJECTION_SUPPLY/v1'||h.sourceVariant!=='SDK49-IDE-R2-SOURCE-ARCHIVE-RUNTIME/v1')throw Error('Exact projection profile required');
 for(const key of ['sourceFiles','manifest','functionResult','projection','runtimeInventory','binding','sourceRoles','postNestedFinalizer'])await readProjectionPin(h[key]);await readProjectionPin(h.normalResume.entry);
 const root=dirname(currentProjectionHandoff),source=JSON.parse(await readProjectionPin(h.sourceFiles));
 for(const row of source.rows)await readProjectionPin({path:join(root,'source',row.path),...row.after});
 await readProjectionPin({...h.archive,path:h.archive.physicalPath});
 await readProjectionPin({...h.sourceRoles,path:join(root,'normal-resume/CURRENT_PACKAGE_SOURCE_ROLES.json')});
 const io=source.rows.find(r=>r.path==='packages/wallet-auth/scripts/ide-runtime-source-projection.mjs');
 if(!io)throw Error('Exact projection IO source missing');
 await readProjectionPin({path:join(root,'normal-resume/support',io.path),...io.after});
 const finalizer=JSON.parse(await readProjectionPin(h.postNestedFinalizer));await readProjectionPin(finalizer.after);
 const addendum=JSON.parse(await readProjectionPin({path:join(root,'finalizer-path-successor/HANDOFF.json'),bytes:1800,sha256:'464a770673c8a21dcf25f835efc7134c58ff5883a93fd45839779e3c70f6d379'}));
 if(addendum.supersedesOnlyFinalizerOf?.sha256!=='6c2f65a34fc108286287e56ebc6d9c77d4d9d130ce473a33035776d5bd48fc75'||addendum.archiveProjectionSDK9ADDUnchanged!==true)throw Error('Exact canonical-path finalizer successor required');
 await readProjectionPin(addendum.sourceFiles);await readProjectionPin(addendum.entry);
 const finalDir=dirname(addendum.entry.path);
 await readProjectionPin({path:join(finalDir,'NORMAL_QA_MANIFEST.json'),bytes:1285473,sha256:'6a8847c752ea9ef566ed6aaa733f041048cc31045b976b748203e6b2e03ca031'});
 await readProjectionPin({...h.projection,path:join(finalDir,'identity-sdk-source-projection.json')});
 await readProjectionPin({...h.runtimeInventory,path:join(finalDir,'identity-sdk-projected-runtime-inventory.json')});
 return {handoff:h,root,source,finalizer:{...finalizer,after:addendum.entry},finalizerAddendum:addendum};
}
