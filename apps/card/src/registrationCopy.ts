import type {Locale} from "./i18n";
import type {RegistrationStatus} from "./registration";
import en from "./registration-locales/en.json";
import zhCN from "./registration-locales/zh-CN.json";
import zhTW from "./registration-locales/zh-TW.json";
import ja from "./registration-locales/ja.json";
import ko from "./registration-locales/ko.json";
import es from "./registration-locales/es.json";
import fr from "./registration-locales/fr.json";
import de from "./registration-locales/de.json";
import pt from "./registration-locales/pt.json";
import ru from "./registration-locales/ru.json";
import ar from "./registration-locales/ar.json";
import id from "./registration-locales/id.json";
export type RegistrationCopyKey = keyof typeof en.text;
export type RegistrationTemplate = keyof typeof en.templates;
type Resource = {text:Record<RegistrationCopyKey,string>;statuses:Record<RegistrationStatus,string>;templates:Record<RegistrationTemplate,string>};
export const registrationResources:Readonly<Record<Locale,Resource>> = {en,"zh-CN":zhCN,"zh-TW":zhTW,ja,ko,es,fr,de,pt,ru,ar,id};
export function registrationText(locale:Locale,key:RegistrationCopyKey):string {
  const value=registrationResources[locale].text[key];
  if(!Object.hasOwn(en.text,key)||typeof value!=="string"||!value.trim())throw Error(`Missing registration copy: ${locale}/${key}`);
  return value;
}
export function registrationStatus(locale:Locale,status:RegistrationStatus):string {
  const value=registrationResources[locale].statuses[status];
  if(!Object.hasOwn(en.statuses,status)||!value)throw Error(`Missing registration status: ${locale}/${status}`);
  return value;
}
export function registrationTemplate(locale:Locale,key:RegistrationTemplate,values:Record<string,string>):string {
  const template=registrationResources[locale].templates[key];
  if(!Object.hasOwn(en.templates,key)||!template)throw Error(`Missing registration template: ${locale}/${key}`);
  const expected=[...template.matchAll(/\{(\w+)\}/g)].map(match=>match[1]!).sort();
  if(JSON.stringify(expected)!==JSON.stringify(Object.keys(values).sort()))throw Error(`Invalid registration template: ${key}`);
  return template.replace(/\{(\w+)\}/g,(_,name:string)=>values[name]!);
}
const errors:Readonly<Record<string,RegistrationCopyKey>> = {
  "A Standard EVM wallet is required":"standardRequired",
  "Only DRAFT applications are editable":"draftOnly",
  "Complete nickname, use case, and a valid YNXT limit":"completeDetails",
  "Testnet terms and application details must be accepted first":"acceptDetails",
  "Application is not awaiting approval":"notAwaiting",
  "ACTIVE applications cannot be cancelled here":"activeCannotCancel"
};
export function registrationErrorKey(error:unknown,fallback:RegistrationCopyKey):RegistrationCopyKey {
  const message=error instanceof Error?error.message:"";
  return Object.hasOwn(errors,message)?errors[message]!:fallback;
}
