import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {chmodSync,closeSync,fsyncSync,mkdtempSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {assertCardDatabaseSchema,cardDatabaseVersion,CARD_STORAGE_SCHEMA_VERSION} from './storageSchema.ts';

/** Trusted operator API, never a public HTTP route. SQLite's online backup includes
 * committed WAL pages; copying just card.sqlite would lose committed business state. */
export async function backupCardDatabase(sourcePath:string,existingBackupDirectory:string){
  const source=new DatabaseSync(resolve(sourcePath),{readOnly:true});
  try{
    const version=cardDatabaseVersion(source);
    if(version!==0&&version!==CARD_STORAGE_SCHEMA_VERSION)throw Error('Unsupported Card database version');
    assertCardDatabaseSchema(source);
    const directory=mkdtempSync(join(resolve(existingBackupDirectory),'card-backup-'));
    chmodSync(directory,0o700);
    const target=join(directory,'card.sqlite');
    const fd=openSync(target,'wx',0o600);closeSync(fd);
    await backup(source,target);
    const check=new DatabaseSync(target,{readOnly:true});
    let snapshotVersion:number;
    try{
      assertCardDatabaseSchema(check);snapshotVersion=cardDatabaseVersion(check);
      if(snapshotVersion!==0&&snapshotVersion!==CARD_STORAGE_SCHEMA_VERSION)throw Error('Unsupported backup schema');
      if(check.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')throw Error('Card backup integrity check failed');
    }finally{check.close()}
    const bytes=readFileSync(target);
    const receipt={schemaVersion:1,createdAt:new Date().toISOString(),database:'card.sqlite',databaseSchemaVersion:snapshotVersion,
      bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),sqliteIntegrity:'ok',
      encryptionKeyIncluded:false,decryptionVerified:false,publicDeployed:false};
    const synced=openSync(target,'r');try{fsyncSync(synced)}finally{closeSync(synced)}
    const receiptFd=openSync(join(directory,'backup.json'),'wx',0o600);
    try{writeFileSync(receiptFd,JSON.stringify(receipt,null,2)+'\n');fsyncSync(receiptFd)}finally{closeSync(receiptFd)}
    const directoryFd=openSync(directory,'r');try{fsyncSync(directoryFd)}finally{closeSync(directoryFd)}
    return {directory,...receipt};
  }finally{source.close()}
}
