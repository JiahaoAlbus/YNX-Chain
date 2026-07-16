import { invariant } from "./errors.js";

export const SUPPORTED_LOCALES = Object.freeze(["en","zh-CN","zh-TW","ja","ko","es","fr","de","pt","ru","ar","id"]);
const rows = {
  en:["New project","Import","Export","Wallet only","Sign in with YNX Wallet","No private key enters Developer.","Review deployment","Cancel","Continue","Unavailable","Retry","Privacy preview","Recovery and checkpoints","AI output language","Unsigned Testnet Preview"],
  "zh-CN":["新建项目","导入","导出","仅限 Wallet","使用 YNX Wallet 登录","私钥绝不进入 Developer。","审查部署","取消","继续","不可用","重试","隐私预览","恢复与检查点","AI 输出语言","未签名测试网预览版"],
  "zh-TW":["新增專案","匯入","匯出","僅限 Wallet","使用 YNX Wallet 登入","私鑰絕不進入 Developer。","審查部署","取消","繼續","無法使用","重試","隱私預覽","復原與檢查點","AI 輸出語言","未簽署測試網預覽版"],
  ja:["新規プロジェクト","インポート","エクスポート","Wallet のみ","YNX Wallet でサインイン","秘密鍵が Developer に渡ることはありません。","デプロイを確認","キャンセル","続行","利用不可","再試行","プライバシープレビュー","復旧とチェックポイント","AI 出力言語","未署名テストネットプレビュー"],
  ko:["새 프로젝트","가져오기","내보내기","Wallet 전용","YNX Wallet로 로그인","개인 키는 Developer에 전달되지 않습니다.","배포 검토","취소","계속","사용 불가","다시 시도","개인정보 미리보기","복구 및 체크포인트","AI 출력 언어","서명되지 않은 테스트넷 미리보기"],
  es:["Nuevo proyecto","Importar","Exportar","Solo Wallet","Iniciar sesión con YNX Wallet","La clave privada nunca entra en Developer.","Revisar despliegue","Cancelar","Continuar","No disponible","Reintentar","Vista previa de privacidad","Recuperación y puntos de control","Idioma de salida de IA","Vista previa de testnet sin firmar"],
  fr:["Nouveau projet","Importer","Exporter","Wallet uniquement","Se connecter avec YNX Wallet","La clé privée n’entre jamais dans Developer.","Vérifier le déploiement","Annuler","Continuer","Indisponible","Réessayer","Aperçu de confidentialité","Récupération et points de contrôle","Langue de sortie IA","Aperçu testnet non signé"],
  de:["Neues Projekt","Importieren","Exportieren","Nur Wallet","Mit YNX Wallet anmelden","Der private Schlüssel gelangt nie in Developer.","Bereitstellung prüfen","Abbrechen","Weiter","Nicht verfügbar","Erneut versuchen","Datenschutzvorschau","Wiederherstellung und Prüfpunkte","KI-Ausgabesprache","Unsignierte Testnet-Vorschau"],
  pt:["Novo projeto","Importar","Exportar","Somente Wallet","Entrar com YNX Wallet","A chave privada nunca entra no Developer.","Revisar implantação","Cancelar","Continuar","Indisponível","Tentar novamente","Prévia de privacidade","Recuperação e checkpoints","Idioma da saída de IA","Prévia de testnet não assinada"],
  ru:["Новый проект","Импорт","Экспорт","Только Wallet","Войти через YNX Wallet","Закрытый ключ никогда не попадает в Developer.","Проверить развертывание","Отмена","Продолжить","Недоступно","Повторить","Предпросмотр конфиденциальности","Восстановление и контрольные точки","Язык ответа ИИ","Неподписанная тестовая версия"],
  ar:["مشروع جديد","استيراد","تصدير","Wallet فقط","تسجيل الدخول باستخدام YNX Wallet","لا يدخل المفتاح الخاص إلى Developer مطلقًا.","مراجعة النشر","إلغاء","متابعة","غير متاح","إعادة المحاولة","معاينة الخصوصية","الاسترداد ونقاط التحقق","لغة مخرجات الذكاء الاصطناعي","معاينة شبكة اختبار غير موقعة"],
  id:["Proyek baru","Impor","Ekspor","Hanya Wallet","Masuk dengan YNX Wallet","Kunci privat tidak pernah masuk ke Developer.","Tinjau deployment","Batal","Lanjutkan","Tidak tersedia","Coba lagi","Pratinjau privasi","Pemulihan dan checkpoint","Bahasa keluaran AI","Pratinjau testnet tanpa tanda tangan"],
};
const keys = ["newProject","import","export","walletOnly","walletSignIn","privateKeyBoundary","reviewDeployment","cancel","continue","unavailable","retry","privacyPreview","recovery","aiLanguage","previewClass"];
export const MESSAGES = Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.freeze(Object.fromEntries(keys.map((key,index)=>[key,values[index]])))])));

export function resolveLocale(requested, detected = globalThis.navigator?.languages ?? []) {
  for (const raw of [requested, ...detected, "en"].filter(Boolean)) { const exact = SUPPORTED_LOCALES.find((item)=>item.toLowerCase()===String(raw).toLowerCase()); if (exact) return exact; const base = SUPPORTED_LOCALES.find((item)=>item.split("-")[0]===String(raw).split("-")[0]); if (base) return base; }
  return "en";
}
export class DeveloperI18n {
  constructor({ locale, storage = globalThis.localStorage } = {}) { this.storage=storage; this.locale=resolveLocale(locale || storage?.getItem("ynx.developer.locale")); }
  setLocale(locale) { this.locale=resolveLocale(locale,[]); this.storage?.setItem("ynx.developer.locale",this.locale); return this.locale; }
  t(key) { const value=MESSAGES[this.locale]?.[key] ?? MESSAGES.en[key]; invariant(typeof value==="string"&&value.trim(),"missing_translation",`Missing translation: ${key}`); return value; }
  date(value, options={dateStyle:"medium",timeStyle:"short"}) { return new Intl.DateTimeFormat(this.locale,options).format(new Date(value)); }
  number(value, options={}) { return new Intl.NumberFormat(this.locale,options).format(value); }
  plural(value, forms) { const category=new Intl.PluralRules(this.locale).select(value); return forms[category] ?? forms.other; }
  get dir() { return this.locale === "ar" ? "rtl" : "ltr"; }
}
