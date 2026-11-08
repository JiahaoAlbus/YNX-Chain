import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const root=path.resolve(import.meta.dirname,'../..');
export const native=path.join(root,'apps/wallet/modules/ynx-pq-custody/native/android-pending-device');
export const test=path.join(root,'apps/wallet/modules/ynx-pq-custody/test');
export const role=path.join(root,'packages/wallet-auth/native/android-pending-producer-role');
export const fixture=path.join(root,'packages/wallet-auth/test/fixtures/android-pending-native10-ci');
export function verifyNative10Inputs(){
 const m=JSON.parse(fs.readFileSync(path.join(role,'NATIVE10_INTAKE.json'),'utf8'));
 if(m.nativeLeaves!==14||m.cases.directory.length!==32||m.cases['pair-abort'].length!==38)throw Error('NATIVE10_COHORT');
 for(const p of m.pins){if(path.isAbsolute(p.path)||p.path.split('/').includes('..'))throw Error('PIN_PATH');const b=fs.readFileSync(path.join(root,p.path));if(b.length!==p.bytes||createHash('sha256').update(b).digest('hex')!==p.sha256)throw Error('PIN_DRIFT:'+p.path);}
 return m;
}
export const strong=[...['open','borrow','current','close'].map(x=>'ynx_original_android_pending_directory_'+x+'_v1'),...['open','current','borrow_once','retire','close'].map(x=>'ynx_original_android_pending_pair_'+x+'_v1'),'ynx_original_android_pending_abort_current_v1'];
export function verifySymbols(s){for(const n of strong)if(!new RegExp('\\bT _?'+n+'$','m').test(s))throw Error('MISSING_STRONG:'+n);if(s.includes('ynx_android_pending_directory_PUBLIC_close'))throw Error('NORMAL_PUBLIC_HOOK');}
