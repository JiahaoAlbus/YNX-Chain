/** Display-only localization. Never translates wire data, user values or keys. */
import {TRANSFER_COPY} from "./wallet-locale-transfer.mjs";
import {RECIPIENT_COPY} from "./wallet-locale-recipient.mjs";
import {RECOVERY_COPY} from "./wallet-locale-recovery.mjs";
import {PASSWORD_COPY} from "./wallet-locale-password.mjs";
import {ACCOUNT_LABEL_COPY} from "./wallet-locale-account-labels.mjs";
import {ACCOUNT_STATE_COPY} from "./wallet-locale-account-state.mjs";
import {RECEIVE_COPY} from "./wallet-locale-receive.mjs";
import {BACKUP_COPY} from "./wallet-locale-backup.mjs";
import {FLOW_NOTICE_COPY} from "./wallet-locale-flow-notices.mjs";
import {TRANSACTION_COPY} from "./wallet-locale-transactions.mjs";
import {RECEIPT_COPY} from "./wallet-locale-receipts.mjs";
import {HISTORY_COPY} from "./wallet-locale-history.mjs";
import {TRANSACTION_NOTICE_COPY} from "./wallet-locale-transaction-notices.mjs";
import {PAY_COPY} from "./wallet-locale-pay.mjs";
import {PAY_NOTICE_COPY} from "./wallet-locale-pay-notices.mjs";
import {PERMISSION_COPY} from "./wallet-locale-permissions.mjs";
export const WALLET_LOCALE_KEY = "ynx-wallet-locale-v1";
export const WALLET_LOCALES = Object.freeze(["en","zh-Hans","zh-Hant","ja","ko","es","fr","de","pt","ru","ar","id"]);
export const WALLET_LANGUAGE_NAMES = Object.freeze({en:"English","zh-Hans":"简体中文","zh-Hant":"繁體中文",ja:"日本語",ko:"한국어",es:"Español",fr:"Français",de:"Deutsch",pt:"Português",ru:"Русский",ar:"العربية",id:"Bahasa Indonesia"});
const keys = "Language|Language and appearance|Overview|Connections|Accounts & backup|My accounts|Wallet locked|Wallet unlocked|Unlock Wallet|Lock Wallet|Create secure Testnet account|Receive YNXT|Send YNXT|Review your transfer|Confirm and send YNXT|Cancel|Close|Copy address|Copy receiving link|Recipient address|Amount (YNXT)|Review transfer|Restore an existing account|Confirm recovery|Local Wallet password|Confirm local Wallet password|Text size|Compact|Standard|Larger|Done|Scan a QR code|QR image (this device)|Camera is not available in this desktop build. Use a QR image or paste a receiving link.|From|To|Amount|Network|Checking local Wallet protection…|Set local Wallet password|Settings|Language saved on this device.|Language changed for this window. It could not be saved on this device.|User inputs, addresses and signature contents remain unchanged.".split("|");
const rows = {
  en: keys.join("|"),
  "zh-Hans":"语言|语言与外观|总览|连接|账户与备份|我的账户|Wallet 已锁定|Wallet 已解锁|解锁 Wallet|锁定 Wallet|创建安全测试网账户|接收 YNXT|发送 YNXT|核对转账|确认并发送 YNXT|取消|关闭|复制地址|复制收款链接|收款地址|金额（YNXT）|核对转账|恢复已有账户|确认恢复|本地 Wallet 密码|确认本地 Wallet 密码|文字大小|紧凑|标准|较大|完成|扫一扫|二维码图片（此设备）|此桌面版本不支持摄像头扫描。请使用二维码图片或粘贴收款链接。|转出地址|收款地址|金额|网络|正在检查本地 Wallet 保护…|设置本地 Wallet 密码|设置|语言已保存在此设备。|语言仅在本窗口更改，无法保存在此设备。|用户输入、地址和签名内容保持原文。",
  "zh-Hant":"語言|語言與外觀|總覽|連線|帳戶與備份|我的帳戶|Wallet 已鎖定|Wallet 已解鎖|解鎖 Wallet|鎖定 Wallet|建立安全測試網帳戶|接收 YNXT|傳送 YNXT|核對轉帳|確認並傳送 YNXT|取消|關閉|複製地址|複製收款連結|收款地址|金額（YNXT）|核對轉帳|還原既有帳戶|確認還原|本機 Wallet 密碼|確認本機 Wallet 密碼|文字大小|緊湊|標準|較大|完成|掃描二維碼|二維碼圖片（此裝置）|此桌面版本不支援相機掃描。請使用二維碼圖片或貼上收款連結。|轉出地址|收款地址|金額|網路|正在檢查本機 Wallet 保護…|設定本機 Wallet 密碼|設定|語言已儲存在此裝置。|語言僅在本視窗變更，無法儲存在此裝置。|使用者輸入、地址和簽名內容保持原文。",
  ja:"言語|言語と表示|概要|接続|アカウントとバックアップ|マイアカウント|Wallet はロック中|Wallet のロックを解除しました|Wallet を解除|Wallet をロック|安全なテストネットアカウントを作成|YNXT を受け取る|YNXT を送る|送金を確認|確認して YNXT を送信|キャンセル|閉じる|アドレスをコピー|受取リンクをコピー|送金先アドレス|金額（YNXT）|送金を確認|既存アカウントを復元|復元を確認|ローカル Wallet パスワード|ローカル Wallet パスワードを確認|文字サイズ|コンパクト|標準|大きい|完了|QR コードをスキャン|QR 画像（この端末）|このデスクトップ版ではカメラスキャンを利用できません。QR 画像または受取リンクを使ってください。|送信元|送信先|金額|ネットワーク|ローカル Wallet の保護を確認中…|ローカル Wallet パスワードを設定|設定|この端末に言語を保存しました。|このウィンドウの言語を変更しましたが、端末には保存できませんでした。|入力、アドレス、署名内容は原文のままです。",
  ko:"언어|언어 및 화면|개요|연결|계정 및 백업|내 계정|Wallet 잠김|Wallet 잠금 해제됨|Wallet 잠금 해제|Wallet 잠그기|보호된 테스트넷 계정 만들기|YNXT 받기|YNXT 보내기|전송 검토|확인하고 YNXT 전송|취소|닫기|주소 복사|수신 링크 복사|받는 주소|금액 (YNXT)|전송 검토|기존 계정 복구|복구 확인|로컬 Wallet 비밀번호|로컬 Wallet 비밀번호 확인|글자 크기|작게|표준|크게|완료|QR 코드 스캔|QR 이미지 (이 기기)|이 데스크톱 빌드는 카메라 스캔을 지원하지 않습니다. QR 이미지나 수신 링크를 사용하세요.|보내는 주소|받는 주소|금액|네트워크|로컬 Wallet 보호 확인 중…|로컬 Wallet 비밀번호 설정|설정|이 기기에 언어를 저장했습니다.|이 창의 언어만 변경했으며 기기에 저장하지 못했습니다.|사용자 입력, 주소 및 서명 내용은 원문 그대로 유지됩니다.",
  es:"Idioma|Idioma y apariencia|Resumen|Conexiones|Cuentas y copias|Mis cuentas|Wallet bloqueada|Wallet desbloqueada|Desbloquear Wallet|Bloquear Wallet|Crear cuenta segura de Testnet|Recibir YNXT|Enviar YNXT|Revisar transferencia|Confirmar y enviar YNXT|Cancelar|Cerrar|Copiar dirección|Copiar enlace de recepción|Dirección del destinatario|Importe (YNXT)|Revisar transferencia|Restaurar una cuenta existente|Confirmar restauración|Contraseña local de Wallet|Confirmar contraseña local de Wallet|Tamaño del texto|Compacto|Estándar|Mayor|Listo|Escanear un código QR|Imagen QR (este dispositivo)|Esta versión de escritorio no admite escaneo con cámara. Usa una imagen QR o pega un enlace de recepción.|Desde|Hasta|Importe|Red|Comprobando la protección local de Wallet…|Configurar contraseña local de Wallet|Ajustes|Idioma guardado en este dispositivo.|Idioma cambiado solo en esta ventana. No se pudo guardar en el dispositivo.|Los datos introducidos, las direcciones y el contenido firmado no cambian.",
  fr:"Langue|Langue et apparence|Vue d’ensemble|Connexions|Comptes et sauvegardes|Mes comptes|Wallet verrouillé|Wallet déverrouillé|Déverrouiller Wallet|Verrouiller Wallet|Créer un compte Testnet sécurisé|Recevoir des YNXT|Envoyer des YNXT|Vérifier le transfert|Confirmer et envoyer des YNXT|Annuler|Fermer|Copier l’adresse|Copier le lien de réception|Adresse du destinataire|Montant (YNXT)|Vérifier le transfert|Restaurer un compte existant|Confirmer la restauration|Mot de passe local Wallet|Confirmer le mot de passe local Wallet|Taille du texte|Compacte|Standard|Plus grande|Terminé|Scanner un code QR|Image QR (cet appareil)|Cette version de bureau ne permet pas le scan par caméra. Utilisez une image QR ou collez un lien de réception.|De|Vers|Montant|Réseau|Vérification de la protection locale de Wallet…|Définir le mot de passe local Wallet|Paramètres|Langue enregistrée sur cet appareil.|Langue modifiée pour cette fenêtre uniquement. Enregistrement impossible sur cet appareil.|Les saisies, adresses et contenus signés restent inchangés.",
  de:"Sprache|Sprache und Darstellung|Übersicht|Verbindungen|Konten und Sicherung|Meine Konten|Wallet gesperrt|Wallet entsperrt|Wallet entsperren|Wallet sperren|Sicheres Testnet-Konto erstellen|YNXT empfangen|YNXT senden|Überweisung prüfen|Bestätigen und YNXT senden|Abbrechen|Schließen|Adresse kopieren|Empfangslink kopieren|Empfängeradresse|Betrag (YNXT)|Überweisung prüfen|Bestehendes Konto wiederherstellen|Wiederherstellung bestätigen|Lokales Wallet-Passwort|Lokales Wallet-Passwort bestätigen|Textgröße|Kompakt|Standard|Größer|Fertig|QR-Code scannen|QR-Bild (dieses Gerät)|Diese Desktop-Version unterstützt keinen Kamera-Scan. Verwenden Sie ein QR-Bild oder einen Empfangslink.|Von|An|Betrag|Netzwerk|Lokaler Wallet-Schutz wird geprüft…|Lokales Wallet-Passwort festlegen|Einstellungen|Sprache auf diesem Gerät gespeichert.|Sprache nur für dieses Fenster geändert. Speichern auf dem Gerät nicht möglich.|Eingaben, Adressen und signierte Inhalte bleiben unverändert.",
  pt:"Idioma|Idioma e aparência|Visão geral|Conexões|Contas e backup|Minhas contas|Wallet bloqueada|Wallet desbloqueada|Desbloquear Wallet|Bloquear Wallet|Criar conta Testnet segura|Receber YNXT|Enviar YNXT|Revisar transferência|Confirmar e enviar YNXT|Cancelar|Fechar|Copiar endereço|Copiar link de recebimento|Endereço do destinatário|Valor (YNXT)|Revisar transferência|Restaurar conta existente|Confirmar restauração|Senha local da Wallet|Confirmar senha local da Wallet|Tamanho do texto|Compacto|Padrão|Maior|Concluído|Ler código QR|Imagem QR (este dispositivo)|Esta versão desktop não oferece leitura por câmera. Use uma imagem QR ou cole um link de recebimento.|De|Para|Valor|Rede|Verificando proteção local da Wallet…|Definir senha local da Wallet|Configurações|Idioma salvo neste dispositivo.|Idioma alterado apenas nesta janela. Não foi possível salvá-lo no dispositivo.|Entradas, endereços e conteúdo assinado permanecem inalterados.",
  ru:"Язык|Язык и оформление|Обзор|Подключения|Аккаунты и резервные копии|Мои аккаунты|Wallet заблокирован|Wallet разблокирован|Разблокировать Wallet|Заблокировать Wallet|Создать защищённый аккаунт Testnet|Получить YNXT|Отправить YNXT|Проверить перевод|Подтвердить и отправить YNXT|Отмена|Закрыть|Копировать адрес|Копировать ссылку получения|Адрес получателя|Сумма (YNXT)|Проверить перевод|Восстановить существующий аккаунт|Подтвердить восстановление|Локальный пароль Wallet|Повторите локальный пароль Wallet|Размер текста|Компактный|Стандартный|Крупнее|Готово|Сканировать QR-код|QR-изображение (это устройство)|Эта настольная версия не поддерживает сканирование камерой. Используйте QR-изображение или вставьте ссылку получения.|Откуда|Кому|Сумма|Сеть|Проверка локальной защиты Wallet…|Задать локальный пароль Wallet|Настройки|Язык сохранён на этом устройстве.|Язык изменён только для этого окна. Сохранить на устройстве не удалось.|Ввод пользователя, адреса и подписанное содержимое не изменяются.",
  ar:"اللغة|اللغة والمظهر|نظرة عامة|الاتصالات|الحسابات والنسخ الاحتياطي|حساباتي|Wallet مقفلة|Wallet مفتوحة|فتح Wallet|قفل Wallet|إنشاء حساب Testnet محمي|استلام YNXT|إرسال YNXT|مراجعة التحويل|تأكيد وإرسال YNXT|إلغاء|إغلاق|نسخ العنوان|نسخ رابط الاستلام|عنوان المستلم|المبلغ (YNXT)|مراجعة التحويل|استعادة حساب موجود|تأكيد الاستعادة|كلمة مرور Wallet المحلية|تأكيد كلمة مرور Wallet المحلية|حجم النص|صغير|قياسي|أكبر|تم|مسح رمز QR|صورة QR (هذا الجهاز)|هذا الإصدار المكتبي لا يدعم المسح بالكاميرا. استخدم صورة QR أو الصق رابط الاستلام.|من|إلى|المبلغ|الشبكة|جارٍ فحص حماية Wallet المحلية…|تعيين كلمة مرور Wallet المحلية|الإعدادات|حُفظت اللغة على هذا الجهاز.|تغيرت اللغة لهذه النافذة فقط. تعذر حفظها على هذا الجهاز.|تبقى مدخلات المستخدم والعناوين ومحتويات التوقيع كما هي.",
  id:"Bahasa|Bahasa dan tampilan|Ringkasan|Koneksi|Akun dan cadangan|Akun saya|Wallet terkunci|Wallet terbuka|Buka Wallet|Kunci Wallet|Buat akun Testnet terlindungi|Terima YNXT|Kirim YNXT|Tinjau transfer|Konfirmasi dan kirim YNXT|Batal|Tutup|Salin alamat|Salin tautan penerimaan|Alamat penerima|Jumlah (YNXT)|Tinjau transfer|Pulihkan akun yang ada|Konfirmasi pemulihan|Kata sandi Wallet lokal|Konfirmasi kata sandi Wallet lokal|Ukuran teks|Ringkas|Standar|Lebih besar|Selesai|Pindai kode QR|Gambar QR (perangkat ini)|Versi desktop ini tidak mendukung pemindaian kamera. Gunakan gambar QR atau tempel tautan penerimaan.|Dari|Ke|Jumlah|Jaringan|Memeriksa perlindungan Wallet lokal…|Atur kata sandi Wallet lokal|Pengaturan|Bahasa disimpan di perangkat ini.|Bahasa diubah untuk jendela ini saja. Tidak dapat disimpan di perangkat.|Input pengguna, alamat, dan isi tanda tangan tetap tidak berubah."
};
const stateKeys="Approval required|Your account|No account created|Not created|Unlock to send".split("|");
const stateRows={en:stateKeys.join("|"),"zh-Hans":"需要审批|你的账户|尚未创建账户|尚未创建|解锁后发送","zh-Hant":"需要核准|你的帳戶|尚未建立帳戶|尚未建立|解鎖後傳送",ja:"承認が必要|あなたのアカウント|アカウント未作成|未作成|解除して送信",ko:"승인 필요|내 계정|생성된 계정 없음|생성되지 않음|잠금 해제 후 전송",es:"Requiere aprobación|Tu cuenta|No se ha creado una cuenta|Sin crear|Desbloquear para enviar",fr:"Approbation requise|Votre compte|Aucun compte créé|Non créé|Déverrouiller pour envoyer",de:"Freigabe erforderlich|Ihr Konto|Kein Konto erstellt|Nicht erstellt|Zum Senden entsperren",pt:"Aprovação necessária|Sua conta|Nenhuma conta criada|Não criada|Desbloquear para enviar",ru:"Требуется одобрение|Ваш аккаунт|Аккаунт не создан|Не создан|Разблокировать для отправки",ar:"الموافقة مطلوبة|حسابك|لم يُنشأ حساب|لم يُنشأ|افتح القفل للإرسال",id:"Perlu persetujuan|Akun Anda|Belum ada akun|Belum dibuat|Buka kunci untuk mengirim"};
stateKeys.push("Locked");const lockedRows={en:"Locked","zh-Hans":"已锁定","zh-Hant":"已鎖定",ja:"ロック中",ko:"잠김",es:"Bloqueada",fr:"Verrouillé",de:"Gesperrt",pt:"Bloqueada",ru:"Заблокирован",ar:"مقفلة",id:"Terkunci"};
for(const locale of WALLET_LOCALES)stateRows[locale]+="|"+lockedRows[locale];
keys.push(...stateKeys);for(const locale of WALLET_LOCALES)rows[locale]+="|"+stateRows[locale];
const sizeKeys=["Text size saved on this device.","Text size changed for this window. It could not be saved on this device."];
const sizeRows={en:sizeKeys.join("|"),"zh-Hans":"文字大小已保存在此设备。|文字大小仅在本窗口更改，无法保存在此设备。","zh-Hant":"文字大小已儲存在此裝置。|文字大小僅在本視窗變更，無法儲存在此裝置。",ja:"この端末に文字サイズを保存しました。|このウィンドウの文字サイズを変更しましたが、端末には保存できませんでした。",ko:"이 기기에 글자 크기를 저장했습니다.|이 창의 글자 크기만 변경했으며 기기에 저장하지 못했습니다。",es:"Tamaño del texto guardado en este dispositivo.|Tamaño del texto cambiado solo en esta ventana. No se pudo guardar en el dispositivo.",fr:"Taille du texte enregistrée sur cet appareil.|Taille du texte modifiée pour cette fenêtre uniquement. Enregistrement impossible sur cet appareil.",de:"Textgröße auf diesem Gerät gespeichert.|Textgröße nur für dieses Fenster geändert. Speichern auf dem Gerät nicht möglich.",pt:"Tamanho do texto salvo neste dispositivo.|Tamanho do texto alterado apenas nesta janela. Não foi possível salvá-lo no dispositivo.",ru:"Размер текста сохранён на этом устройстве.|Размер текста изменён только для этого окна. Сохранить на устройстве не удалось.",ar:"حُفظ حجم النص على هذا الجهاز.|تغير حجم النص لهذه النافذة فقط. تعذر حفظه على هذا الجهاز.",id:"Ukuran teks disimpan di perangkat ini.|Ukuran teks diubah untuk jendela ini saja. Tidak dapat disimpan di perangkat."};
keys.push(...sizeKeys);for(const locale of WALLET_LOCALES)rows[locale]+="|"+sizeRows[locale];
const zoomKey="System text size and browser zoom still apply.";
const zoomRows={en:zoomKey,"zh-Hans":"仍遵循系统文字大小和浏览器缩放。","zh-Hant":"仍遵循系統文字大小和瀏覽器縮放。",ja:"システムの文字サイズとブラウザーの拡大率も適用されます。",ko:"시스템 글자 크기와 브라우저 확대 설정도 적용됩니다.",es:"También se aplican el tamaño del texto del sistema y el zoom del navegador.",fr:"La taille du texte du système et le zoom du navigateur restent appliqués.",de:"Systemtextgröße und Browserzoom gelten weiterhin.",pt:"O tamanho do texto do sistema e o zoom do navegador continuam sendo aplicados.",ru:"Размер текста системы и масштаб браузера также применяются.",ar:"يظل حجم نص النظام وتكبير المتصفح ساريين.",id:"Ukuran teks sistem dan zoom browser tetap berlaku."};
keys.push(zoomKey);for(const locale of WALLET_LOCALES)rows[locale]+="|"+zoomRows[locale];
export const WALLET_COPY = Object.freeze(Object.fromEntries(WALLET_LOCALES.map(locale=>{
  const values=rows[locale].split("|");
  if(values.length!==keys.length||values.some(value=>!value))throw Error(`Incomplete Wallet copy: ${locale}`);
  return [locale,Object.freeze({...Object.fromEntries(keys.map((key,index)=>[key,values[index]])),...TRANSFER_COPY[locale],...RECIPIENT_COPY[locale],...RECOVERY_COPY[locale],...PASSWORD_COPY[locale],...ACCOUNT_LABEL_COPY[locale],...ACCOUNT_STATE_COPY[locale],...RECEIVE_COPY[locale],...BACKUP_COPY[locale],...FLOW_NOTICE_COPY[locale],...TRANSACTION_COPY[locale],...RECEIPT_COPY[locale],...HISTORY_COPY[locale],...TRANSACTION_NOTICE_COPY[locale],...PAY_COPY[locale],...PAY_NOTICE_COPY[locale],...PERMISSION_COPY[locale]})];
})));
export function systemWalletLocale(languages=[]) {
  for(const tag of languages){if(typeof tag!=="string")continue;const value=tag.toLowerCase();if(value.startsWith("zh"))return /(?:hant|tw|hk|mo)/.test(value)?"zh-Hant":"zh-Hans";const locale=WALLET_LOCALES.find(item=>value===item.toLowerCase()||value.startsWith(item.toLowerCase()+"-"));if(locale)return locale}
  return "en";
}
export function parseWalletLocale(raw,fallback="en") {
  try{const value=JSON.parse(raw);if(value?.version===1&&WALLET_LOCALES.includes(value.locale)&&Object.keys(value).sort().join(",")==="locale,version")return value.locale}catch{}
  return WALLET_LOCALES.includes(fallback)?fallback:"en";
}
export function walletCopy(locale,key){return WALLET_COPY[locale]?.[key]??WALLET_COPY.en[key]??key}

const instances=new WeakMap();
// Explicit application-owned UI labels. Raw request/account/value containers
// deliberately do not appear here, including auth-purpose and all review pre.
export const WALLET_STATIC_COPY=Object.freeze({
  "#open-protected-pay":"Pay & original receipts","#protected-pay-title":"Pay & original receipts",
  '[data-close="protected-pay-sheet"]':"Close",
  "#protected-pay-sheet > p:first-of-type":"Review a registered merchant's signed invoice before approving its exact YNX Testnet payment. Unknown outcomes must be recovered by original hash, never by paying again.",
  'label[for="protected-pay-reference"]':"Invoice ID or existing Pay checkout link",
  "#protected-pay-review":"Review signed invoice","#protected-pay-approve":"Approve exact payment","#protected-pay-next":"Review another invoice",
  "#protected-pay-restore":"Restore original","#protected-pay-check":"Check original hash","#protected-pay-settle":"Submit original settlement","#protected-pay-receipt":"Read original receipt","#protected-pay-done":"Done — save verified receipt",
  "#protected-pay-history-title":"Saved Pay receipts","#protected-pay-history":"Refresh Pay history","#protected-pay-older":"Older Pay receipts",
  "#protected-pay-sheet details > summary":"Read an invoice QR image",'label[for="protected-pay-qr"]':"PNG, JPEG or WebP QR image, up to 10 MB",
  "#protected-pay-sheet details > p":"Read locally, never uploaded. Scanning fills only the reference and never approves a payment.",
  "#protected-pay-sheet > p.muted":"A submission acknowledgement is not a mined payment or settled receipt. Native local checkpoint evidence is not consensus finality. Closing this dialog cancels its live approval but never deletes a saved original.",
  "#transaction-resolution > h2":"Transaction needs confirmation",
  "#transaction-resolution > p:first-of-type":"A recorded transaction must be resolved before creating another transfer from this account. A missing receipt does not mean it was never submitted.",
  "#transaction-history > p.muted":"Verified completed transfers saved on this device. Local snapshot confirmation is not consensus finality. Unresolved transactions remain in their recovery panel.",
  "#transaction-history-title":"Transfer history","#refresh-transaction-history":"Refresh history","#older-transaction-history":"Older transfers",
  '[data-view="overview"]':"Overview",'[data-view="connections"]':"Connections",'[data-view="accounts"]':"Accounts & backup",
  '[data-panel="accounts"] .page-heading h1':"Accounts & backup",
  '[data-panel="accounts"] .page-heading > p:not(.eyebrow)':"Keep your accounts together. Keep a backup somewhere safe.","#import-result":"Use an account intended for Testnet. Importing clears existing DApp connections.",'#backup-section > p:first-of-type':"You need the backup file and its password to restore this account on another device.",
  "#toolbar-account":"My accounts","#open-appearance":"Language and appearance","#page-title":"Overview",
  "#key-security-title":"Wallet locked","#key-security-detail":"Checking local Wallet protection…","#unlock-wallet":"Unlock Wallet","#lock-wallet":"Lock Wallet",
  "#create-account":"Create secure Testnet account","#recover-wallet":"Restore an existing account",
  "#add-account":"Create and switch to another account",'[data-panel="accounts"] .wallet-details:not([id]) > summary':"Import an existing account",'label[for="import-kind"]':"Import format",'label[for="import-value"]':"Private key or recovery phrase",'label[for="import-file"]':"Encrypted backup file",'label[for="import-password"]':"Backup password",'#import-form button[type="submit"]':"Import and select account",
  '#backup-section > summary':"Save an encrypted backup",'label[for="backup-password"]':"Backup password (at least 12 characters)",'label[for="backup-confirm"]':"Confirm backup password","#save-backup":"Save encrypted backup",
  "#open-receive":"Receive YNXT","#receive-title":"Receive YNXT","#copy-address":"Copy address","#copy-receiving-link":"Copy receiving link",
  '#receive-sheet > p:first-of-type':"Send only YNX Testnet assets to this address.",'label[for="receive-address"]':"Your YNX address",'#receive-sheet > p.muted':"The code and receiving link contain only your public address, YNX Testnet and YNXT. No amount, callback or authorization is included. The sender must enter an amount and review the transfer.",
  '#receive-compatibility summary':"EVM compatibility address",'#receive-compatibility p':"This is the same account in the address format used by EVM apps.",'label[for="receive-evm-address"]':"EVM address",
  "#open-send":"Send YNXT","#send-title":"Send YNXT","#transfer-review-title":"Review your transfer","#prepare-transfer":"Review transfer","#confirm-transfer":"Confirm and send YNXT","#cancel-transfer":"Cancel",
  'label[for="transfer-to"]':"Recipient address",'label[for="transfer-amount"]':"Amount (YNXT)",
  "#paste-recipient":"Paste address or receiving link",
  '#send-sheet > p:first-of-type':"A transfer on YNX Testnet. You will review the fee before sending.","#recipient-hint":"You can also paste a YNX receiving QR image into the address field. Images are read on this device.",
  "#password-title":"Unlock Wallet","#submit-password":"Unlock Wallet",'label[for="local-password"]':"Local Wallet password",'label[for="local-confirm"]':"Confirm local Wallet password",
  "#migration-explanation":"All existing accounts in this profile will be read with OS protection, verified and encrypted with your new password. Original OS-encrypted files remain on this device for recovery. No keys are uploaded.",
  "#recovery-title":"Restore an existing account","#commit-recovery":"Confirm recovery","#prepare-recovery":"Verify backup and review","#recovery-review h3":"Confirm account recovery",
  '#recovery-sheet > p:first-of-type':"Restore only an account already listed in this Wallet. Your backup stays on this device.",'#recovery-new-group > p':"Only the restored account will open with the new password. Other accounts remain listed and need their own backup or a previously saved Wallet password. The old encrypted Wallet is retained.",
  'label[for="recovery-account"]':"Account to restore",'label[for="recovery-kind"]':"Recovery source",'label[for="recovery-value"]':"Private key or recovery phrase",'label[for="recovery-file"]':"Encrypted JSON backup",'label[for="recovery-history"]':"Saved encrypted Wallet",'label[for="recovery-backup-password"]':"Password for the backup or saved Wallet",'label[for="recovery-password-mode"]':"Local password",'label[for="recovery-current-password"]':"Current local Wallet password",'label[for="recovery-new-password"]':"New local Wallet password",'label[for="recovery-confirm"]':"Confirm new local Wallet password",
  '#recovery-password-mode option[value="keep"]':"Keep current Wallet password",'#recovery-password-mode option[value="reset"]':"I cannot unlock this Wallet — set a new password",
  '#recovery-kind option[value="private-key"],#import-kind option[value="private-key"]':"Private key",'#recovery-kind option[value="recovery-phrase"],#import-kind option[value="recovery-phrase"]':"Recovery phrase (first Ethereum account)",'#recovery-kind option[value="encrypted-json"],#import-kind option[value="encrypted-json"]':"Encrypted JSON backup",'#recovery-kind option[value="previous-password"]':"Previously saved Wallet and its old password",
  "[data-custody-cancel]":"Cancel",'[data-close="receive-sheet"]':"Close",'[data-close="send-sheet"]':"Close"
});
export const WALLET_STATIC_ATTRIBUTES=Object.freeze({"#receive-qr":Object.freeze({"aria-label":"QR code for your selected YNX Testnet receiving address"}),"#import-value":Object.freeze({placeholder:"Entered locally on this device"}),"#transfer-to":Object.freeze({placeholder:"ynx1… or a YNX receiving link"})});
/** Only explicitly enrolled product-owned nodes are localized. Never walk or
 * observe arbitrary text, inputs, signed requests, account values or HTML. */
export function initWalletLocale({document,getStorage=()=>null,systemLanguages=[]}) {
  if(instances.has(document))return instances.get(document);
  const records=new Map(),attributeRecords=new Map(),select=document.querySelector("#wallet-language"),status=document.querySelector("#wallet-language-status");
  let locale=systemWalletLocale(systemLanguages);
  try{locale=parseWalletLocale(getStorage()?.getItem(WALLET_LOCALE_KEY),locale)}catch{}
  function setCopy(node,key,values={}){
    if(!node||!Object.hasOwn(WALLET_COPY.en,key))return false;
    const params=Object.freeze(Object.fromEntries(Object.entries(values).map(([name,value])=>[name,String(value)])));
    renderWalletCopy(node,walletCopy(locale,key),params);records.set(node,{key,params,lastText:node.textContent});return true;
  }
  function setAttributeCopy(node,attribute,key){
    if(!node?.getAttribute||!node?.setAttribute||!["aria-label","placeholder"].includes(attribute)||!Object.hasOwn(WALLET_COPY.en,key))return false;
    const text=walletCopy(locale,key);node.setAttribute(attribute,text);
    if(!attributeRecords.has(node))attributeRecords.set(node,new Map());attributeRecords.get(node).set(attribute,{key,lastText:text});return true;
  }
  function apply(next){
    if(!WALLET_LOCALES.includes(next))throw Error("Unsupported Wallet locale");
    locale=next;document.documentElement.lang=locale;document.documentElement.dir=locale==="ar"?"rtl":"ltr";
    if(select)select.value=locale;
    for(const [node,record]of records){
      // Raw data or a new render owns its node. A later locale switch cannot
      // overwrite it with an earlier translated state.
      if(node.isConnected===false||node.textContent!==record.lastText){records.delete(node);continue}
      renderWalletCopy(node,walletCopy(locale,record.key),record.params);record.lastText=node.textContent;
    }
    for(const [node,attributes]of attributeRecords){
      for(const [attribute,record]of attributes){if(node.isConnected===false||node.getAttribute(attribute)!==record.lastText){attributes.delete(attribute);continue}const text=walletCopy(locale,record.key);node.setAttribute(attribute,text);record.lastText=text}
      if(!attributes.size)attributeRecords.delete(node);
    }
  }
  const controller=Object.freeze({locale:()=>locale,setCopy,setAttributeCopy,select(next){
    apply(next);
    try{const storage=getStorage();if(!storage)throw Error("Unavailable display storage");const raw=JSON.stringify({version:1,locale:next});storage.setItem(WALLET_LOCALE_KEY,raw);if(storage.getItem(WALLET_LOCALE_KEY)!==raw)throw Error("Display preference readback failed");setCopy(status,"Language saved on this device.");return true}
    catch{setCopy(status,"Language changed for this window. It could not be saved on this device.");return false}
  }});
  instances.set(document,controller);
  for(const [selector,key]of Object.entries(WALLET_STATIC_COPY))for(const node of document.querySelectorAll(selector))setCopy(node,key);
  for(const [selector,attributes]of Object.entries(WALLET_STATIC_ATTRIBUTES))for(const node of document.querySelectorAll(selector))for(const [attribute,key]of Object.entries(attributes))setAttributeCopy(node,attribute,key);
  for(const node of document.querySelectorAll("[data-wallet-copy]"))setCopy(node,node.getAttribute("data-wallet-copy"));
  select?.addEventListener("change",()=>{if(WALLET_LOCALES.includes(select.value))controller.select(select.value)});
  apply(locale);return controller;
}
/** Parameters are text nodes inside isolated elements, never HTML or translated
 * strings. Option elements cannot contain markup and retain exact plain text. */
export function renderWalletCopy(node,template,values={}){
  const parts=template.split(/(\{[a-zA-Z][a-zA-Z0-9]*\})/g);
  const valueOf=part=>Object.hasOwn(values,part.slice(1,-1))?String(values[part.slice(1,-1)]):part;
  const canIsolate=node.ownerDocument?.createElement&&node.ownerDocument?.createTextNode&&node.replaceChildren&&node.tagName?.toLowerCase()!=="option";
  if(!canIsolate){node.textContent=parts.map(part=>/^\{/.test(part)?valueOf(part):part).join("");return}
  node.replaceChildren(...parts.map(part=>{
    if(!/^\{/.test(part))return node.ownerDocument.createTextNode(part);
    const isolated=node.ownerDocument.createElement("bdi");isolated.dir=part==="{name}"?"auto":"ltr";isolated.textContent=valueOf(part);return isolated;
  }));
}
export function setWalletCopy(node,key,values={}){const instance=instances.get(node?.ownerDocument);if(!instance?.setCopy(node,key,values)&&node)renderWalletCopy(node,key,values)}
