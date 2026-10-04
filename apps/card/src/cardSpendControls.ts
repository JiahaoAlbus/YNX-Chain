import {parseTestnetYnxt} from './cardOperationJournal';
/** Owned TEST policy input only. No account request, signing or network calls. */
export function buildTestnetSpendControls(amount:string,merchantText:string,emergencyBlock:boolean):Record<string,unknown>{
  if(typeof merchantText!=='string'||merchantText.length>10200||typeof emergencyBlock!=='boolean')throw Error('INVALID_SPEND_CONTROLS');
  const allowedMerchants=merchantText.trim()===''?[]:merchantText.split(',').map(value=>value.trim());
  if(allowedMerchants.length>100||allowedMerchants.some(value=>! /^[A-Za-z0-9._-]{1,100}$/.test(value))||new Set(allowedMerchants).size!==allowedMerchants.length)throw Error('INVALID_SPEND_CONTROLS');
  return {...(amount===''?{}:{maxSingleWei:parseTestnetYnxt(amount)}),allowedMerchants,emergencyBlock};
}
