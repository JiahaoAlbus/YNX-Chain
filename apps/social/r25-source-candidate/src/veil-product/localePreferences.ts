import {VEIL_PRODUCT_LOCALES, type VeilLocale} from './copy';

export const VEIL_LOCALE_KEY = 'ynx.social.veil-product.locale.v1';
export interface VeilLocaleStorage {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
}

/** This namespace stores only an explicit supported language preference, never product data. */
export function createLocalePreferences(storage: VeilLocaleStorage) {
  let pending: Promise<void> = Promise.resolve();
  return Object.freeze({
    async read(): Promise<VeilLocale | null> {
      const value = await storage.read(VEIL_LOCALE_KEY);
      return VEIL_PRODUCT_LOCALES.includes(value as VeilLocale) ? value as VeilLocale : null;
    },
    write(value: VeilLocale): Promise<void> {
      if (!VEIL_PRODUCT_LOCALES.includes(value)) return Promise.reject(new TypeError('VEIL_PRODUCT_LOCALE_INVALID'));
      const next = pending.catch(() => {}).then(() => storage.write(VEIL_LOCALE_KEY, value));
      pending = next;
      return next;
    },
  });
}
