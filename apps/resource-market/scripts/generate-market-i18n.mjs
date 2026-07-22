#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('web/index.html', root), 'utf8');
const section = html.slice(html.indexOf('<section id="market"'), html.indexOf('<section id="trade"'));
const phrases = [...new Set(section
  .replace(/<[^>]+>/g, '\n').split('\n')
  .map(value => value.replace(/\s+/g, ' ').trim())
  .filter(value => value && value !== 'class="view">'))];
const locales = {
  'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese used in Taiwan and Hong Kong',
  ja: 'Japanese', ko: 'Korean', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese',
  ru: 'Russian', ar: 'Modern Standard Arabic', id: 'Indonesian',
};

async function generate(code, language) {
  const prompt = `Translate this JSON array of UI strings into ${language}. Return only a JSON array with exactly ${phrases.length} strings in the same order. Preserve YNX, YNXT-testnet, Ed25519, URI, RPC, IDs, numbers, ≠, and technical units. Translate every human-readable string naturally and precisely. Legal meanings are strict: a quote is not settlement; sponsorship never transfers assets; retained economic and audit records are not destroyed.\n${JSON.stringify(phrases)}`;
  const response = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({model: process.env.OLLAMA_MODEL || 'qwen3:4b', prompt, stream: false, think: false,
      format: {type: 'array', minItems: phrases.length, maxItems: phrases.length, items: {type: 'string'}},
      options: {temperature: 0}}),
  });
  if (!response.ok) throw new Error(`${code}: Ollama HTTP ${response.status}`);
  const envelope = await response.json();
  let translated;
  try { translated = JSON.parse(envelope.response); } catch (error) { throw new Error(`${code}: invalid JSON: ${error.message}`); }
  if (translated && !Array.isArray(translated)) {
    const arrays = Object.values(translated).filter(Array.isArray);
    if (arrays.length === 1) translated = arrays[0];
  }
  if (!Array.isArray(translated) || translated.length !== phrases.length) throw new Error(`${code}: expected ${phrases.length} strings, received ${translated?.length ?? 'non-array'}`);
  translated.forEach((value, index) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${code}: blank/non-string translation at ${index}`);
  });
  return translated;
}

const catalog = {en: phrases};
for (const [code, language] of Object.entries(locales)) {
  process.stderr.write(`translating ${code} (${phrases.length} strings)\n`);
  catalog[code] = await generate(code, language);
}
const reviewed = {
  'Quote ≠ settlement': {'zh-Hans':'报价 ≠ 结算','zh-Hant':'報價 ≠ 結算',ja:'見積り ≠ 決済',ko:'견적 ≠ 결제',es:'Cotización ≠ liquidación',fr:'Devis ≠ règlement',de:'Angebot ≠ Abrechnung',pt:'Cotação ≠ liquidação',ru:'Котировка ≠ окончательный расчёт',ar:'عرض السعر ≠ التسوية',id:'Kutipan ≠ penyelesaian'},
};
for (const [english, translations] of Object.entries(reviewed)) {
  const index = phrases.indexOf(english);
  if (index < 0) throw new Error(`reviewed source missing: ${english}`);
  for (const [code, value] of Object.entries(translations)) catalog[code][index] = value;
}
const source = `(()=>{const C=${JSON.stringify(catalog)};const E=C.en,I=new Map(E.map((v,i)=>[v,i])),O=new WeakMap();function translateText(value){const lead=value.match(/^\\s*/)[0],tail=value.match(/\\s*$/)[0],core=value.trim(),index=I.get(core),locale=YNXI18n.locale;return index===undefined||locale==='en'?value:lead+C[locale][index]+tail}function apply(){const root=document.querySelector('#market');if(!root)return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let node;node=walker.nextNode();){if(node.parentElement?.closest('script,style'))continue;if(!O.has(node))O.set(node,node.nodeValue);node.nodeValue=translateText(O.get(node))}}const set=YNXI18n.set;YNXI18n.set=value=>{set(value);apply()};window.YNXMarketI18n={catalog:C,english:E,apply,translateText};document.addEventListener('DOMContentLoaded',()=>{apply();new MutationObserver(apply).observe(document.querySelector('#market'),{childList:true,subtree:true})})})();\n`;
await writeFile(new URL('web/i18n-market.js', root), source);
process.stderr.write(`wrote ${Object.keys(catalog).length} locales × ${phrases.length} strings\n`);
