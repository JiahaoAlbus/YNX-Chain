import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { I18nManager } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import {
  locales,
  setActiveLocale,
  systemLocale,
  translate,
  type Locale,
} from "./i18n";

const STORAGE_KEY = "ynx.social.locale.v1";
const detectedLocale = () => systemLocale(getLocales()[0]?.languageTag);
type I18nValue = {
  locale: Locale;
  isRTL: boolean;
  setLocale: (value: Locale | null) => Promise<void>;
  t: (value: string) => string;
};
const Context = createContext<I18nValue>({
  locale: "en",
  isRTL: false,
  setLocale: async () => {},
  t: (value) => value,
});
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setCurrent] = useState<Locale>(detectedLocale());
  useEffect(() => {
    void SecureStore.getItemAsync(STORAGE_KEY).then((value) =>
      setCurrent(locales.find((item) => item === value) ?? detectedLocale()),
    );
  }, []);
  useEffect(() => {
    setActiveLocale(locale);
    const rtl = locale === "ar";
    I18nManager.allowRTL(true);
    if (I18nManager.isRTL !== rtl) I18nManager.forceRTL(rtl);
  }, [locale]);
  const setLocale = async (value: Locale | null) => {
    if (value) await SecureStore.setItemAsync(STORAGE_KEY, value);
    else await SecureStore.deleteItemAsync(STORAGE_KEY);
    setCurrent(value ?? detectedLocale());
  };
  const context = useMemo(
    () => ({
      locale,
      isRTL: locale === "ar",
      setLocale,
      t: (value: string) => translate(value, locale),
    }),
    [locale],
  );
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useI18n() {
  return useContext(Context);
}
