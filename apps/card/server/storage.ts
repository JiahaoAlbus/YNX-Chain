import {DatabaseSync} from 'node:sqlite';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {dirname} from 'node:path';
import {chmodSync,mkdirSync} from 'node:fs';
import {CardError} from './contracts.ts';
import {migrateCardDatabase} from './storageSchema.ts';

/** Single-host durable business state. Encryption key is deployment configuration,
 * never a Wallet key. Database backups must preserve this key separately. */
export class CardStore {
  private db:DatabaseSync;
  private key:Buffer;
  private assertCurrent:()=>void;
  constructor(path:string,key:Uint8Array,assertCurrent:()=>void=()=>{}){
    assertCurrent();this.assertCurrent=assertCurrent;
    if(key.byteLength!==32)throw Error('YNX_CARD_STATE_KEY_BASE64 must decode to 32 bytes');
    this.key=Buffer.from(key);
    let database:DatabaseSync|undefined;
    try{
      mkdirSync(dirname(path),{recursive:true,mode:0o700});
      database=new DatabaseSync(path);this.db=database;
      migrateCardDatabase(this.db);
      if(path!==':memory:')chmodSync(path,0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    }catch(error){
      // Includes mkdir/open failures after the owned key copy was acquired.
      // Cleanup must not replace the original construction exception.
      try{database?.close()}catch{}finally{this.key.fill(0)}
      throw error
    }
  }
  private seal(owner:string,value:unknown):string{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from('ynx-card-business-v1:'+owner));const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return JSON.stringify({v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')})}
  private open(owner:string,raw:string):unknown{const value=JSON.parse(raw);if(value.v!==1)throw Error('Unsupported Card storage version');const cipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(value.iv,'base64'));cipher.setAAD(Buffer.from('ynx-card-business-v1:'+owner));cipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.body,'base64')),cipher.final()]).toString('utf8'))}
  read<T>(owner:string,empty:()=>T):T{this.assertCurrent();const row=this.db.prepare('SELECT body FROM owners WHERE owner=?').get(owner);const value=row?this.open(owner,String(row.body)) as T:empty();this.assertCurrent();return value}
  transaction<T,R>(owner:string,empty:()=>T,fn:(state:T)=>R):R{
    this.assertCurrent();this.db.exec('BEGIN IMMEDIATE');
    try{const state=this.read(owner,empty),result=fn(state);this.assertCurrent();this.db.prepare('INSERT INTO owners(owner,body) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET body=excluded.body').run(owner,this.seal(owner,state));this.assertCurrent();this.db.exec('COMMIT');return structuredClone(result)}catch(error){this.db.exec('ROLLBACK');throw error}
  }
  /** Called inside the same transaction as ledger credit. */
  claim(chain:string,hash:string,owner:string,intent:string):void{this.assertCurrent();const prior=this.db.prepare('SELECT owner,intent FROM funding_claims WHERE chain=? AND hash=?').get(chain,hash);if(prior){if(prior.owner!==owner||prior.intent!==intent)throw new CardError('TRANSACTION_ALREADY_CLAIMED');return}this.db.prepare('INSERT INTO funding_claims(chain,hash,owner,intent) VALUES(?,?,?,?)').run(chain,hash,owner,intent)}
  close(){try{this.db.close()}finally{this.key.fill(0)}}
}
