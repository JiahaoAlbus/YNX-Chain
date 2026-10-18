import {lstat,readdir,readlink,symlink,unlink} from 'node:fs/promises';
import path from 'node:path';

/** Existing exclusive builder output only. The App is never moved, cloned or
 * copied. Image creation reads the same App inode as the ordinary builder.
 * An interrupted run leaves its Applications link for explicit recovery;
 * this helper never adopts or removes a pre-existing link/foreign entry. */
export async function withMacDmgSource(appDirectory,createImage){
 if(typeof appDirectory!=='string'||!path.isAbsolute(appDirectory)||path.resolve(appDirectory)!==appDirectory||!path.basename(appDirectory).endsWith('.app')||typeof createImage!=='function')throw Error('DMG_SOURCE_APP_REQUIRED');
 const directory=path.dirname(appDirectory),name=path.basename(appDirectory);
 const parent=await lstat(directory),app=await lstat(appDirectory);
 if(!parent.isDirectory()||parent.isSymbolicLink()||!app.isDirectory()||app.isSymbolicLink())throw Error('DMG_SOURCE_APP_REQUIRED');
 const entries=await readdir(directory);
 if(entries.length!==1||entries[0]!==name)throw Error('DMG_SOURCE_NOT_EXCLUSIVE');
 const link=path.join(directory,'Applications');
 await symlink('/Applications',link); // Exclusive create; never overwrite.
 const selected=await lstat(link,{bigint:true});
 let failed=false,first,result;
 try{
  const current=await readdir(directory);
  if(current.length!==2||!current.includes(name)||!current.includes('Applications'))throw Error('DMG_SOURCE_NOT_EXCLUSIVE');
  result=await createImage(directory);
 }catch(error){failed=true;first=error;}
 try{
  const actual=await lstat(link,{bigint:true});
  if(!actual.isSymbolicLink()||actual.dev!==selected.dev||actual.ino!==selected.ino||actual.ctimeNs!==selected.ctimeNs||actual.birthtimeNs!==selected.birthtimeNs||await readlink(link)!=='/Applications')throw Error('DMG_SOURCE_LINK_CHANGED');
  await unlink(link); // Only the exact link created by this invocation.
 }catch(cleanup){
  if(failed)throw new AggregateError([first,cleanup],'DMG_SOURCE_CLEANUP_FAILED',{cause:first});
  throw cleanup;
 }
 if(failed)throw first;
 return result;
}
