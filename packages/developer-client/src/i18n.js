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
const workspaceKeys=["files","search","diff","deploy","docs","aiBuild","compile","runTests","tasks","problems","output","terminal","rpcTools","receipts","artifacts","audit","previewPlan","resume","exportAudit","approvedContext","modelProvider","permissions"];
const workspaceRows={
  en:["Files","Search","Diff","Deploy","Docs","AI Build","Compile","Run tests","Tasks","Problems","Output","Terminal","RPC Tools","Receipts & logs","Artifacts","Audit","Preview plan","Resume","Export audit","Approved context","Model / provider","Permissions"],
  "zh-CN":["文件","搜索","差异","部署","文档","AI 构建","编译","运行测试","任务","问题","输出","终端","RPC 工具","回执与日志","产物","审计","预览计划","恢复","导出审计","已批准上下文","模型 / 提供方","权限"],
  "zh-TW":["檔案","搜尋","差異","部署","文件","AI 建置","編譯","執行測試","任務","問題","輸出","終端機","RPC 工具","收據與日誌","產物","稽核","預覽計畫","繼續","匯出稽核","已核准內容","模型 / 提供者","權限"],
  ja:["ファイル","検索","差分","デプロイ","ドキュメント","AI ビルド","コンパイル","テスト実行","タスク","問題","出力","ターミナル","RPC ツール","レシートとログ","成果物","監査","計画を確認","再開","監査を出力","承認済みコンテキスト","モデル / プロバイダー","権限"],
  ko:["파일","검색","차이","배포","문서","AI 빌드","컴파일","테스트 실행","작업","문제","출력","터미널","RPC 도구","영수증 및 로그","산출물","감사","계획 미리보기","재개","감사 내보내기","승인된 컨텍스트","모델 / 제공자","권한"],
  es:["Archivos","Buscar","Diferencias","Desplegar","Documentación","Compilación IA","Compilar","Ejecutar pruebas","Tareas","Problemas","Salida","Terminal","Herramientas RPC","Recibos y registros","Artefactos","Auditoría","Vista previa del plan","Reanudar","Exportar auditoría","Contexto aprobado","Modelo / proveedor","Permisos"],
  fr:["Fichiers","Rechercher","Diff","Déployer","Documentation","Build IA","Compiler","Lancer les tests","Tâches","Problèmes","Sortie","Terminal","Outils RPC","Reçus et journaux","Artefacts","Audit","Aperçu du plan","Reprendre","Exporter l’audit","Contexte approuvé","Modèle / fournisseur","Autorisations"],
  de:["Dateien","Suchen","Diff","Bereitstellen","Dokumentation","KI-Build","Kompilieren","Tests ausführen","Aufgaben","Probleme","Ausgabe","Terminal","RPC-Werkzeuge","Belege und Protokolle","Artefakte","Audit","Planvorschau","Fortsetzen","Audit exportieren","Genehmigter Kontext","Modell / Anbieter","Berechtigungen"],
  pt:["Arquivos","Pesquisar","Diferenças","Implantar","Documentação","Build de IA","Compilar","Executar testes","Tarefas","Problemas","Saída","Terminal","Ferramentas RPC","Recibos e logs","Artefatos","Auditoria","Prévia do plano","Retomar","Exportar auditoria","Contexto aprovado","Modelo / provedor","Permissões"],
  ru:["Файлы","Поиск","Различия","Развернуть","Документация","ИИ-сборка","Компилировать","Запустить тесты","Задачи","Проблемы","Вывод","Терминал","Инструменты RPC","Квитанции и журналы","Артефакты","Аудит","Просмотр плана","Продолжить","Экспорт аудита","Одобренный контекст","Модель / провайдер","Разрешения"],
  ar:["الملفات","بحث","الفروقات","النشر","الوثائق","بناء الذكاء الاصطناعي","ترجمة","تشغيل الاختبارات","المهام","المشكلات","المخرجات","الطرفية","أدوات RPC","الإيصالات والسجلات","المنتجات","التدقيق","معاينة الخطة","استئناف","تصدير التدقيق","السياق المعتمد","النموذج / المزوّد","الأذونات"],
  id:["File","Cari","Perbedaan","Deploy","Dokumentasi","Build AI","Kompilasi","Jalankan pengujian","Tugas","Masalah","Keluaran","Terminal","Alat RPC","Tanda terima & log","Artefak","Audit","Pratinjau rencana","Lanjutkan","Ekspor audit","Konteks disetujui","Model / penyedia","Izin"],
};
export const MESSAGES = Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale, values]) => [locale, Object.freeze({...Object.fromEntries(keys.map((key,index)=>[key,values[index]])),...Object.fromEntries(workspaceKeys.map((key,index)=>[key,workspaceRows[locale][index]]))})])));

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
