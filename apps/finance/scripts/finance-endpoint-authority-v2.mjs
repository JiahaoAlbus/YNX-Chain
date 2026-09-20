#!/usr/bin/env node
import {resolveFinancePrivateAuthority} from '../authority/adapter.mjs';

try{
  const authority=await resolveFinancePrivateAuthority();
  process.stdout.write(JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-runtime/v1',status:'VERIFIED',...authority})+'\n');
}catch(error){
  const code=/^[A-Z][A-Z0-9_:.-]{2,160}$/.test(error?.code??'')?error.code:String(error?.message??'FINANCE_AUTHORITY_V2_REJECTED').split(':')[0];
  process.stdout.write(JSON.stringify({schemaVersion:'ynx-finance-endpoint-authority-runtime/v1',status:'PRIVATE_SERVICE_DEGRADED',code,officialSandboxVerified:false,providerVerified:false,productionApproved:false})+'\n');
  process.exitCode=3;
}
