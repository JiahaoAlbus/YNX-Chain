import type { SecureStorageAdapter } from "../storage/walletRepository";
import type { WalletLocale } from "../i18n/i18n";

export const UI_SIZE_KEY="ynx.wallet.ui-size.v1";
export const UI_SIZES=["compact","standard","larger"] as const;
export type UISize=typeof UI_SIZES[number];
export function parseUISize(raw:string|null):UISize{
  try{const value=JSON.parse(raw??"");return value?.version===1&&UI_SIZES.includes(value.size)&&Object.keys(value).sort().join(",")==="size,version"?value.size:"standard"}catch{return "standard"}
}
export async function loadUISize(storage:SecureStorageAdapter):Promise<UISize>{return parseUISize(await storage.getItem(UI_SIZE_KEY))}
export async function saveUISize(storage:SecureStorageAdapter,size:UISize):Promise<void>{
  if(!UI_SIZES.includes(size))throw new Error("Unsupported Wallet text size");
  await storage.setItem(UI_SIZE_KEY,JSON.stringify({version:1,size}));
}
export function textSizeScale(size:UISize):number{return size==="compact"?.933333:size==="larger"?1.133333:1}
const COPY:Record<WalletLocale,readonly [string,string,string,string,string]>={
  en:["Text size","Compact","Standard","Larger","System text size still applies."],
  "zh-Hans":["文字大小","紧凑","标准","较大","仍遵循系统文字大小。"],
  "zh-Hant":["文字大小","緊湊","標準","較大","仍遵循系統文字大小。"],
  ja:["文字サイズ","コンパクト","標準","大きめ","システムの文字サイズも適用されます。"],
  ko:["글자 크기","작게","표준","크게","시스템 글자 크기도 적용됩니다."],
  es:["Tamaño del texto","Compacto","Estándar","Más grande","Se respeta el tamaño de texto del sistema."],
  fr:["Taille du texte","Compacte","Standard","Plus grande","La taille du texte du système reste appliquée."],
  de:["Textgröße","Kompakt","Standard","Größer","Die Systemtextgröße gilt weiterhin."],
  pt:["Tamanho do texto","Compacto","Padrão","Maior","O tamanho de texto do sistema continua aplicado."],
  ru:["Размер текста","Компактный","Стандартный","Крупнее","Системный размер текста также применяется."],
  ar:["حجم النص","صغير","قياسي","أكبر","يظل حجم نص النظام مطبقًا."],
  id:["Ukuran teks","Ringkas","Standar","Lebih besar","Ukuran teks sistem tetap diterapkan."],
};
export function appearanceCopy(locale:WalletLocale){const [title,compact,standard,larger,hint]=COPY[locale];return {title,compact,standard,larger,hint}}
