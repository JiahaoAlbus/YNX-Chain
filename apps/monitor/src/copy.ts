import { requiredKeys, resolveLocale, translate, type Locale } from "./i18n";
import { copyAliases, copyCatalog } from "./copy-catalog";

const existingKeys = new Map(requiredKeys.map(key => [translate("en", key), key]));

export function currentLocale(): Locale {
  return resolveLocale(typeof localStorage === "undefined" ? null : localStorage.getItem("ynx-monitor-locale"));
}

/** Translate known display copy only. Unknown evidence, user content and protocol values pass through. */
export function copy(value: string, locale=currentLocale()): string {
  const canonical = Object.hasOwn(copyAliases, value) ? copyAliases[value] : value;
  if (Object.hasOwn(copyCatalog, canonical)) return copyCatalog[canonical][locale];
  const key = existingKeys.get(canonical);
  return key ? translate(locale, key) : value;
}

export function formatDate(value: string, timeOnly=false): string {
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return copy("Unavailable");
  return new Intl.DateTimeFormat(currentLocale(),timeOnly ? {timeStyle:"medium"} : {dateStyle:"medium",timeStyle:"short"}).format(date);
}
