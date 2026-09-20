import path from 'node:path';

export const FINANCE_AUTHORITY_CONSUMERS=Object.freeze({
  web:Object.freeze({consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0',applicationId:'com.ynxweb4.finance.web',platform:'web'}),
  native:Object.freeze({consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.2.0',applicationId:'com.ynxweb4.finance',platform:'native'}),
  server:Object.freeze({consumerId:'ynx-finance-v1',origin:'https://finance.ynxweb4.com',clientVersion:'1.0.0',applicationId:'com.ynxweb4.finance.server',platform:'server'}),
});

export const FINANCE_AUTHORITY_IDENTITIES=Object.freeze({
  webApplicationId:'com.ynxweb4.finance.web',
  nativeApplicationId:'com.ynxweb4.finance',
  nativeCallback:'ynxfinance://wallet-auth/callback',
  requiredEndpoint:'walletGateway',
  requiredProduct:'finance',
});

export function endpointAuthorityConsumer(platform){
  const configured=FINANCE_AUTHORITY_CONSUMERS[platform];
  if(!configured)throw new Error('FINANCE_AUTHORITY_V2_PLATFORM_INVALID');
  const {consumerId,origin,clientVersion}=configured;
  return Object.freeze({consumerId,origin,clientVersion});
}

const KEYS=Object.freeze({
  trustRootFile:'YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUST_ROOT_FILE',
  manifestFile:'YNX_FINANCE_ENDPOINT_AUTHORITY_V2_MANIFEST_FILE',
  checkpointFile:'YNX_FINANCE_ENDPOINT_AUTHORITY_V2_CHECKPOINT_FILE',
  trustedTimeFile:'YNX_FINANCE_ENDPOINT_AUTHORITY_V2_TRUSTED_TIME_FILE',
});

function absolute(value,key){
  if(typeof value!=='string'||value.trim()===''||!path.isAbsolute(value.trim()))throw new Error(`FINANCE_AUTHORITY_V2_ABSOLUTE_PATH_REQUIRED:${key}`);
  return path.normalize(value.trim());
}

export function loadFinanceAuthorityConfig(env=process.env){
  const supplied=Object.values(KEYS).filter(key=>typeof env[key]==='string'&&env[key].trim()!=='');
  if(supplied.length===0)return Object.freeze({enabled:false,reason:'FINANCE_AUTHORITY_V2_NOT_CONFIGURED'});
  if(supplied.length!==Object.keys(KEYS).length)throw new Error('FINANCE_AUTHORITY_V2_CONFIGURATION_INCOMPLETE');
  return Object.freeze({enabled:true,...Object.fromEntries(Object.entries(KEYS).map(([name,key])=>[name,absolute(env[key],key)]))});
}
