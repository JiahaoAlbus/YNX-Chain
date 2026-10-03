import {SUPPORTED_LOCALES,type WalletLocale} from './i18n';
import {APP_FLOW_SOURCE,type WalletAppFlowMessage,type AppFlowTranslationRow} from './appFlowSource';
import {RECEIVE_HISTORY_FLOW_COPY} from './appFlowReceiveHistory';
import {PAY_APP_FLOW_COPY} from './appFlowPay';
import {CONTRACT_APP_FLOW_COPY} from './appFlowContract';

export type {WalletAppFlowMessage} from './appFlowSource';
export const APP_FLOW_TRANSLATION_LOCALES=['zh-Hant','ja','ko','es','fr','de','pt','ru','ar','id'] as const;
const rows:Readonly<Record<WalletAppFlowMessage,AppFlowTranslationRow>>=Object.freeze({...RECEIVE_HISTORY_FLOW_COPY,...PAY_APP_FLOW_COPY,...CONTRACT_APP_FLOW_COPY});
export const APP_FLOW_MESSAGES=Object.freeze(Object.keys(APP_FLOW_SOURCE) as WalletAppFlowMessage[]);
Object.freeze(APP_FLOW_SOURCE);
for(const message of APP_FLOW_MESSAGES)Object.freeze(rows[message]);

/** A owns App wiring: replace c(en,zh) with this exact English-key lookup.
 * Unknown strings are refused, not silently rendered in English for a selected
 * language. Addresses/hashes/merchant names and other data stay outside this API.
 * Text is unstyled: existing OS font scaling, RTL and wrapping remain in App. */
export function walletAppFlowCopy(locale:WalletLocale,message:string):string{
  if(!Object.prototype.hasOwnProperty.call(APP_FLOW_SOURCE,message)||!SUPPORTED_LOCALES.includes(locale))throw Error('Unsupported Wallet App flow copy');
  const key=message as WalletAppFlowMessage;
  if(locale==='en')return key;
  if(locale==='zh-Hans')return APP_FLOW_SOURCE[key];
  const index=APP_FLOW_TRANSLATION_LOCALES.indexOf(locale);
  if(index<0)throw Error('Unsupported Wallet App flow copy');
  return rows[key][index]!;
}

/** Public fixed copy only, for source/layout checks; no account/session data. */
export function allWalletAppFlowCopy():Readonly<Record<WalletLocale,Readonly<Record<WalletAppFlowMessage,string>>>>{
  return Object.freeze(Object.fromEntries(SUPPORTED_LOCALES.map(locale=>[locale,Object.freeze(Object.fromEntries(APP_FLOW_MESSAGES.map(message=>[message,walletAppFlowCopy(locale,message)])))]))) as Record<WalletLocale,Record<WalletAppFlowMessage,string>>;
}
