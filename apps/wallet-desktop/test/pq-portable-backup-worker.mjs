// Isolated proof: no Vault import, local password, profile or signing calls.
// Expected binding is captured by the parent from protected custody, never
// selected from the untrusted backup envelope.
import {PQBackupFile} from '../src/pq-backup-file.mjs';
import * as sdk from '../../../packages/wallet-auth/src/pq-wallet-key-backup.js';
import {assertPQPublicBindingMatches} from '../../../packages/wallet-auth/src/pq-wallet-contract.js';
let handle,wire,result;
try{
 let input='';for await(const chunk of process.stdin)input+=chunk;
 const {filePath,credential,expectedBinding}=JSON.parse(input);
 wire=await new PQBackupFile().read(filePath,{assert(){}});
 handle=await sdk.restorePQWalletKeyHandle(wire,credential,expectedBinding);
 const binding=sdk.readPQWalletKeyPublic(handle);assertPQPublicBindingMatches(binding,expectedBinding);
 result={pid:process.pid,binding,walletAdopted:false,signed:false,broadcast:false};
}catch(error){result={failed:true,code:error?.code??'TEST_PORTABLE_RECOVERY_FAILED'};process.exitCode=1;}
finally{
 wire?.fill(0);
 if(handle)try{if(sdk.destroyPQWalletKeyHandle(handle)!==true)throw Error();}catch{result={failed:true,code:'TEST_CLEANUP_UNCONFIRMED'};process.exitCode=1;}
 process.stdout.write(JSON.stringify(result));
}
