import {locales, type Locale} from "./i18n";
import en from "./guest-locales/en.json";
import zhCN from "./guest-locales/zh-CN.json";
import zhTW from "./guest-locales/zh-TW.json";
import ja from "./guest-locales/ja.json";
import ko from "./guest-locales/ko.json";
import es from "./guest-locales/es.json";
import fr from "./guest-locales/fr.json";
import de from "./guest-locales/de.json";
import pt from "./guest-locales/pt.json";
import ru from "./guest-locales/ru.json";
import ar from "./guest-locales/ar.json";
import id from "./guest-locales/id.json";

export type GuestCopyKey = keyof typeof en.text;
export type GuestTemplate = keyof typeof en.templates;
type GuestResource = {text: Record<GuestCopyKey, string>; templates: Record<GuestTemplate, string>};
// Each resource is complete in its own language. There is no English fallback.
export const guestResources: Readonly<Record<Locale, GuestResource>> = {en, "zh-CN": zhCN, "zh-TW": zhTW, ja, ko, es, fr, de, pt, ru, ar, id};
export const guestCopySourceInventory = Object.keys(en.text) as GuestCopyKey[];
export const guestCopies = Object.fromEntries(locales.map(locale => [locale, guestResources[locale].text])) as Record<Locale, GuestResource["text"]>;
// Proper names and the visual card-number mask are intentionally invariant.
export const guestInvariantText = ["YNX", "CARD", "YNX Wallet", "MetaMask", "••••  ••••  ••••  ••••"] as const;
export const guestInvariantTemplates = ["connectionSummary"] as const;
export function isGuestCopyKey(value: string): value is GuestCopyKey {return Object.hasOwn(en.text, value);}
export function guestText(locale: Locale, value: string): string {
  if (!isGuestCopyKey(value)) throw new Error(`Unknown Guest copy key: ${value}`);
  const text = guestResources[locale].text[value];
  if (!text?.trim()) throw new Error(`Missing Guest copy: ${locale}.${value}`);
  return text;
}
export function guestTemplate(locale: Locale, template: GuestTemplate, values: Readonly<Record<string, string>>): string {
  const text = guestResources[locale].templates[template];
  const names = [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!))].sort();
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(values).sort())) throw new Error(`Invalid Guest template values: ${template}`);
  return text.replace(/\{(\w+)\}/g, (_, key: string) => values[key]!);
}
export function guestCopyComplete(locale: Locale): boolean {
  return guestCopySourceInventory.every(key => Boolean(guestCopies[locale][key]?.trim()) && (locale === "en" || (guestInvariantText as readonly string[]).includes(key) || guestCopies[locale][key] !== en.text[key]));
}
