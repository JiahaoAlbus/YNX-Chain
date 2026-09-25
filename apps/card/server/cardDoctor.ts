/** Read-only Card provider configuration inventory. Does not open Card state,
 * contact Immersve or send a provider write. */
import {parseIssuingPrograms} from './providerLifecycle.ts';
export function cardDoctor(env:NodeJS.ProcessEnv=process.env){
  let programs:ReturnType<typeof parseIssuingPrograms>=[],validPrograms=true;try{programs=parseIssuingPrograms(JSON.parse(env.YNX_CARD_TEST_PROGRAMS_JSON??'[]'))}catch{validPrograms=false}
  const credentialsConfigured=Boolean(env.IMMERSVE_SANDBOX_API_KEY&&env.IMMERSVE_SANDBOX_API_SECRET),sandboxEnabled=env.IMMERSVE_SANDBOX_ENABLED==='true';
  const expiry=Date.parse(env.IMMERSVE_SANDBOX_WRITE_EXPIRES_AT??''),operatorGateConfigured=Boolean(env.IMMERSVE_SANDBOX_OPERATOR_TICKET&&env.IMMERSVE_SANDBOX_QA_ACCOUNT_ID&&Number.isFinite(expiry)&&expiry>Date.now()&&expiry<=Date.now()+86400000&&/^[1-9][0-9]*$/.test(env.IMMERSVE_SANDBOX_MAX_DEPOSIT_MINOR_UNITS??'')&&Number(env.IMMERSVE_SANDBOX_MAX_PROVIDER_CALLS)>=1);
  return {environment:'TEST',provider:'immersve',fixedOrigin:'https://test.immersve.com',programConfigValid:validPrograms,configuredPrograms:validPrograms?programs.filter(item=>item.enabled).length:0,credentialsConfigured,sandboxEnabled,writeFlagsEnabled:env.YNX_CARD_PROVIDER_TEST_WRITE_ENABLED==='true'&&env.IMMERSVE_SANDBOX_WRITE_ENABLED==='true',providerWritesReady:validPrograms&&programs.some(item=>item.enabled)&&credentialsConfigured&&sandboxEnabled&&operatorGateConfigured&&env.YNX_CARD_PROVIDER_TEST_WRITE_ENABLED==='true'&&env.IMMERSVE_SANDBOX_WRITE_ENABLED==='true',operatorGateConfigured,financeReadConfigured:Boolean(env.YNX_CARD_FINANCE_READ_KEY&&env.YNX_CARD_FINANCE_READ_KEY.length>=32),hostedKycSessionLookup:'BLOCKED_PROVIDER_SPEC_SESSION_LOOKUP',liveEnabled:false,providerPostSent:false};
}
if(process.argv[1]?.endsWith('cardDoctor.ts'))process.stdout.write(JSON.stringify(cardDoctor())+'\n');
