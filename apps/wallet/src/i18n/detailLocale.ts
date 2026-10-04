import type {WalletDetailMessage,WalletLocale} from './i18n';
import type {DetailLocaleRow} from './detailLocaleTypes';
import {DETAIL_ACCOUNT_LOCALE} from './detailAccountLocale';
import {DETAIL_SESSION_LOCALE} from './detailSessionLocale';
import {DETAIL_TRANSFER_LOCALE} from './detailTransferLocale';
import {DETAIL_FAUCET_LOCALE} from './detailFaucetLocale';

export const EXTRA_DETAIL_LOCALES=['zh-Hant','ja','ko','es','fr','de','pt','ru','id'] as const;
type ExtraLocale=typeof EXTRA_DETAIL_LOCALES[number];
const rows:Readonly<Record<WalletDetailMessage,DetailLocaleRow>>=Object.freeze({...DETAIL_ACCOUNT_LOCALE,...DETAIL_SESSION_LOCALE,...DETAIL_TRANSFER_LOCALE,...DETAIL_FAUCET_LOCALE});
export const EXTRA_DETAIL_MESSAGES=Object.freeze(Object.keys(rows) as WalletDetailMessage[]);
for(const message of EXTRA_DETAIL_MESSAGES)Object.freeze(rows[message]);

/** Called only for the nine previously missing languages. Existing original
 * English, Simplified Chinese and Arabic remain in i18n.ts untouched. Pure copy
 * lookup never changes canonical values, account data, permissions or effects. */
export function extraWalletDetailCopy(locale:WalletLocale,message:WalletDetailMessage):string{
  const index=EXTRA_DETAIL_LOCALES.indexOf(locale as ExtraLocale);
  if(index<0||!Object.prototype.hasOwnProperty.call(rows,message))throw Error('Unsupported Wallet detail copy');
  return rows[message][index]!;
}
