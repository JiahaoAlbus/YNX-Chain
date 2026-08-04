import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const res = path.join(root, "android/app/src/main/res");
const sources = {
  en: "values", "zh-Hans": "values-zh-rCN", "zh-Hant": "values-zh-rTW", ja: "values-ja",
  ko: "values-ko", es: "values-es", fr: "values-fr", de: "values-de", pt: "values-pt",
  ru: "values-ru", ar: "values-ar", id: "values-in",
};
const decode = value => value.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
function read(folder) {
  const text = fs.readFileSync(path.join(res, folder, "strings.xml"), "utf8");
  const out = {};
  for (const m of text.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) out[m[1]] = decode(m[2].trim());
  return out;
}
const catalog = Object.fromEntries(Object.entries(sources).map(([tag, folder]) => [tag, read(folder)]));
const baseline = Object.keys(catalog.en).sort();
for (const [tag, table] of Object.entries(catalog)) {
  const keys = Object.keys(table).sort();
  if (keys.join("\n") !== baseline.join("\n")) throw new Error(`${tag}: missing or extra keys`);
  for (const [key, value] of Object.entries(table)) if (!value || value.length > 360) throw new Error(`${tag}.${key}: blank or unsafe layout length`);
  if (tag !== "en" && Object.entries(table).filter(([k,v]) => v === catalog.en[k]).length > 4) throw new Error(`${tag}: too many untranslated values`);
  const semanticMinimum = /^(zh-|ja$|ko$)/.test(tag) ? 8 : 18;
  for (const legal of ["creator_truth", "revenue_truth", "clear_confirm", "auth_rejected"]) if (table[legal].length < semanticMinimum) throw new Error(`${tag}.${legal}: legal/security meaning is too short`);
}
if (!/[\u0600-\u06ff]/.test(catalog.ar.revenue_truth)) throw new Error("Arabic legal text is not Arabic");
const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
if (!manifest.includes('android:supportsRtl="true"')) throw new Error("Android RTL support is disabled");
const output = path.join(root, "shared/i18n.json");
if (process.argv.includes("--write")) { fs.mkdirSync(path.dirname(output), {recursive:true}); fs.writeFileSync(output, JSON.stringify({version:1, locales:Object.keys(catalog), catalog}, null, 2)+"\n"); }
else if (!fs.existsSync(output) || JSON.stringify(JSON.parse(fs.readFileSync(output,"utf8")).catalog) !== JSON.stringify(catalog)) throw new Error("shared i18n.json is stale; run i18n-audit.mjs --write");
console.log(`i18n audit passed: ${Object.keys(catalog).length} locales × ${baseline.length} keys, Arabic RTL enabled`);
