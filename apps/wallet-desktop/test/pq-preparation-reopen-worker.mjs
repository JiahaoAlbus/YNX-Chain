// Isolated test process: existing encrypted fixture only, never a user vault.
import {DesktopKeyLifecycle} from '../src/key-lifecycle.mjs';
import {PasswordWalletVault} from '../src/password-wallet-vault.mjs';
import {createPQKeyPreparationEntry} from '../src/wallet-pq-key-entry.mjs';
import * as keySDK from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import * as backupSDK from '../../../packages/wallet-auth/src/pq-wallet-backup.js';
import * as contractSDK from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
let lifecycle;
try{
 let input='';for await(const chunk of process.stdin)input+=chunk;
 const {filePath,password,networkId,attemptGeneration}=JSON.parse(input);
 let generations=0;const sdk={...keySDK,...backupSDK,...contractSDK,createPQWalletKeyHandle:async network=>{generations++;return keySDK.createPQWalletKeyHandle(network);}};
 lifecycle=new DesktopKeyLifecycle();lifecycle.setFocused(true);
 const vault=new PasswordWalletVault({filePath,authorization:lifecycle,pqSDK:sdk});lifecycle.authorizer=vault.authorizer();
 await lifecycle.unlock({password});
 const entry=createPQKeyPreparationEntry({lifecycle,vault,sdk,networkId,id:()=> 'TEST-child-replacement'}),state=await entry.recover();
 let refused=false;if(attemptGeneration)try{await entry.generate();}catch{refused=true;}
 process.stdout.write(JSON.stringify({pid:process.pid,state,generations,refused}));
}catch(error){process.stdout.write(JSON.stringify({failed:true,code:error?.data?.code??error?.code??'TEST_FAILURE'}));process.exitCode=1;}
finally{lifecycle?.lock();}
