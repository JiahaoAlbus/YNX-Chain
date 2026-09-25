import type {DatabaseSync} from 'node:sqlite';

export const CARD_STORAGE_SCHEMA_VERSION=1;

export function cardDatabaseVersion(db:DatabaseSync):number{
  return Number(db.prepare('PRAGMA user_version').get()?.user_version);
}

export function assertCardDatabaseSchema(db:DatabaseSync):void{
  const expected={
    owners:[['owner','TEXT',1],['body','TEXT',0]],
    funding_claims:[['chain','TEXT',1],['hash','TEXT',2],['owner','TEXT',0],['intent','TEXT',0]],
  } as const;
  for(const table of ['owners','funding_claims'] as const){
    const columns=db.prepare(`PRAGMA table_info(${table})`).all();
    if(columns.length!==expected[table].length||expected[table].some(([name,type,pk],i)=>{
      const column=columns[i];return column?.name!==name||column.type!==type||Number(column.pk)!==pk;
    }))throw Error('Unsupported Card database schema');
  }
}

/** The unversioned deployed format is version 0. Migration preserves ciphertext,
 * owner partitions and the global transaction-claim primary key in one transaction. */
export function migrateCardDatabase(db:DatabaseSync):void{
  const version=cardDatabaseVersion(db);
  if(version!==0&&version!==CARD_STORAGE_SCHEMA_VERSION)throw Error('Unsupported Card database version');
  db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try{
    const current=cardDatabaseVersion(db);
    if(current===0){
      db.exec('CREATE TABLE IF NOT EXISTS owners(owner TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS funding_claims(chain TEXT NOT NULL, hash TEXT NOT NULL, owner TEXT NOT NULL, intent TEXT NOT NULL, PRIMARY KEY(chain,hash));');
      assertCardDatabaseSchema(db);
      db.exec('PRAGMA user_version=1');
    }else if(current===CARD_STORAGE_SCHEMA_VERSION){assertCardDatabaseSchema(db)}
    else throw Error('Unsupported Card database version');
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}
