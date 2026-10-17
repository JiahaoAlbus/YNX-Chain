import type {WalletDetailMessage} from './i18n';
/** zh-Hant, ja, ko, es, fr, de, pt, ru, id; existing en/zh-Hans/ar remain original. */
export type DetailLocaleRow=readonly [string,string,string,string,string,string,string,string,string];
export type DetailLocaleGroup=Readonly<Partial<Record<WalletDetailMessage,DetailLocaleRow>>>;
