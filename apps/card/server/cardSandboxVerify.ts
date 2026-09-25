import {resolve} from 'node:path';
import {CardStore} from './storage.ts';
import {CardProviderRegistry} from './providerRegistry.ts';
import {CardProviderApplications} from './providerApplication.ts';
import {ImmersveSandbox} from './immersveSandbox.ts';
import {CardProviderLifecycle,parseIssuingPrograms} from './providerLifecycle.ts';
import {cardDoctor} from './cardDoctor.ts';
import type {Principal} from './contracts.ts';

/** Bounded operator entrypoint. Only GETs the provider; the account link is a
 * local durable write and must be based on independently checked owner evidence. */
async function main(){
  const action=process.argv[2];if(action!=='doctor'&&action!=='bind-account'&&action!=='readback')throw Error('Use doctor, bind-account or readback');
  if(action==='doctor'){process.stdout.write(JSON.stringify(cardDoctor())+'\n');return}
  const encoded=process.env.YNX_CARD_STATE_KEY_BASE64??'',key=Buffer.from(encoded,'base64');if(key.length!==32||key.toString('base64')!==encoded)throw Error('Card state key unavailable');
  const store=new CardStore(resolve(process.env.YNX_CARD_DATA_DIR??'.card-data','card.sqlite'),key);key.fill(0);
  try{
    const programs=parseIssuingPrograms(JSON.parse(process.env.YNX_CARD_TEST_PROGRAMS_JSON??'[]'));
    const registry=new CardProviderRegistry(store),applications=new CardProviderApplications(store,undefined,undefined,[],programs,registry),immersve=ImmersveSandbox.fromEnvironment(store);
    const lifecycle=new CardProviderLifecycle(store,applications,registry,immersve,{},programs,false);
    const owner=process.env.YNX_CARD_OPERATOR_OWNER??'',applicationId=process.env.YNX_CARD_OPERATOR_APPLICATION_ID??'';
    const principal:Principal={owner,chainId:'0x1917',scopes:['account:read'],expiresAt:new Date(Date.now()+30000).toISOString()};
    if(action==='bind-account'){
      if(process.env.YNX_CARD_OPERATOR_CONFIRM!=='BIND VERIFIED TEST ACCOUNT')throw Error('Explicit local bind confirmation required');
      const accountId=process.env.YNX_CARD_OPERATOR_EXTERNAL_ACCOUNT_ID??'',evidenceId=process.env.YNX_CARD_OPERATOR_EVIDENCE_ID??'';
      const linked=await lifecycle.bindExistingAccount(principal,applicationId,accountId,evidenceId);
      process.stdout.write(JSON.stringify({action,owner,applicationId,provider:'immersve',programId:linked.programId,environment:linked.environment,status:linked.status})+'\n');
    }else{
      const app=applications.get(principal,applicationId),binding=registry.resolve(principal,app.productCardId);
      const card=app.upstreamCardId?await lifecycle.readStatus(principal,applicationId):null;
      process.stdout.write(JSON.stringify({action,owner,applicationId,provider:'immersve',programId:app.programId,accountStatus:binding.status,cardStatus:card?.card.status??null,cardBlocked:card?.card.isBlocked??null,providerPostSent:false})+'\n');
    }
  }finally{store.close()}
}
main().catch(error=>{process.stderr.write((error instanceof Error?error.message:'Card verification failed')+'\n');process.exitCode=1});
