import {catalogs,locales,rtl,t} from "./i18n";
const base=Object.keys(catalogs.en);
for(const locale of locales){const keys=Object.keys(catalogs[locale]);if(keys.length!==base.length)throw new Error(`${locale}: key count mismatch`);for(const key of base){const value=t(locale,key as never);if(!value.trim())throw new Error(`${locale}.${key}: blank`)}if(locale==="ar"&&!rtl(locale))throw new Error("Arabic must be RTL")}
const technical=new Set(["brand","limit","network","support","audit","ai","gateway","indexer","source","deposit","ynxNetwork"]);
for(const locale of locales.slice(1)){const inherited=base.filter(key=>!technical.has(key)&&catalogs[locale][key as keyof typeof catalogs.en]===catalogs.en[key as keyof typeof catalogs.en]);if(inherited.length)console.log(`${locale}: English fallback keys: ${inherited.join(",")}`)}
for(const locale of locales){for(const key of ["legal","privacy","signIn","walletUnavailable","crossChainReason"] as const){if(!t(locale,key).trim())throw new Error(`${locale}.${key}: strict text missing`)}}
console.log(`i18n audit passed: ${locales.length} locales, ${base.length} keys, Arabic RTL`);
