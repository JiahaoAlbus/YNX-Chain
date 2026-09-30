// Product-owned UI copy only; protocol status codes and decisions remain SDK-owned.
const keys=['signIn','open','retry','verify','signOut','boundary','guest','connected','pending','disconnected','unavailable','verified'];
const rows={
  en:['Sign in to private Quant account','Open YNX Wallet — installation unverified','Retry private session','Verify private account','Sign out private session','Installation unverified. Standard Wallet and Paper remain independent.','Private sign-in is optional.','Private session connected.','Private authorization is pending.','Private session disconnected.','Private service unavailable or action incomplete. Retry; the standard connection is unchanged.','Private account verified. No native execution or Paper ownership was granted.'],
  'zh-CN':['登录 Quant 私有账户','打开 YNX Wallet — 安装状态未验证','重试私有会话','验证私有账户','退出私有会话','安装状态未验证。标准钱包与模拟盘保持独立。','私有登录为可选功能。','私有会话已连接。','正在等待私有授权。','私有会话已断开。','私有服务不可用或操作未完成。请重试；标准连接不受影响。','私有账户已验证；未授予原生交易或模拟盘所有权。'],
  'zh-TW':['登入 Quant 私有帳戶','開啟 YNX Wallet — 安裝狀態未驗證','重試私有工作階段','驗證私有帳戶','登出私有工作階段','安裝狀態未驗證。標準錢包與模擬交易保持獨立。','私有登入為選用功能。','私有工作階段已連線。','正在等待私有授權。','私有工作階段已中斷。','私有服務無法使用或操作未完成。請重試；標準連線不受影響。','私有帳戶已驗證；未授予原生交易或模擬交易所有權。'],
  ja:['Quant 非公開アカウントにログイン','YNX Wallet を開く — インストール未確認','非公開セッションを再試行','非公開アカウントを確認','非公開セッションからログアウト','インストール未確認。標準ウォレットとペーパー取引は独立しています。','非公開ログインは任意です。','非公開セッションに接続済み。','非公開の承認を待っています。','非公開セッションは切断済み。','非公開サービスが利用できないか操作が未完了です。再試行してください。標準接続は維持されます。','非公開アカウントを確認済み。ネイティブ取引やペーパー取引の所有権は付与されません。'],
  ko:['Quant 비공개 계정 로그인','YNX Wallet 열기 — 설치 미확인','비공개 세션 재시도','비공개 계정 확인','비공개 세션 로그아웃','설치가 확인되지 않았습니다. 표준 지갑과 모의 거래는 독립적입니다.','비공개 로그인은 선택 사항입니다.','비공개 세션이 연결되었습니다.','비공개 승인을 기다리고 있습니다.','비공개 세션이 연결 해제되었습니다.','비공개 서비스를 사용할 수 없거나 작업이 완료되지 않았습니다. 재시도하세요. 표준 연결은 유지됩니다.','비공개 계정이 확인되었습니다. 네이티브 거래나 모의 거래 소유권은 부여되지 않았습니다.'],
  es:['Iniciar sesión privada en Quant','Abrir YNX Wallet — instalación sin verificar','Reintentar sesión privada','Verificar cuenta privada','Cerrar sesión privada','Instalación sin verificar. La wallet estándar y Paper son independientes.','El inicio de sesión privado es opcional.','Sesión privada conectada.','Autorización privada pendiente.','Sesión privada desconectada.','Servicio privado no disponible o acción incompleta. Reintenta; la conexión estándar se mantiene.','Cuenta privada verificada. No se concede ejecución nativa ni propiedad de Paper.'],
  fr:['Connexion au compte privé Quant','Ouvrir YNX Wallet — installation non vérifiée','Réessayer la session privée','Vérifier le compte privé','Fermer la session privée','Installation non vérifiée. Le wallet standard et Paper restent indépendants.','La connexion privée est facultative.','Session privée connectée.','Autorisation privée en attente.','Session privée déconnectée.','Service privé indisponible ou action incomplète. Réessayez ; la connexion standard reste intacte.','Compte privé vérifié. Aucune exécution native ni propriété Paper accordée.'],
  de:['Beim privaten Quant-Konto anmelden','YNX Wallet öffnen — Installation ungeprüft','Private Sitzung erneut versuchen','Privates Konto prüfen','Private Sitzung abmelden','Installation ungeprüft. Standard-Wallet und Paper bleiben unabhängig.','Die private Anmeldung ist optional.','Private Sitzung verbunden.','Private Autorisierung ausstehend.','Private Sitzung getrennt.','Privater Dienst nicht verfügbar oder Aktion unvollständig. Erneut versuchen; die Standardverbindung bleibt bestehen.','Privates Konto geprüft. Keine native Ausführung oder Paper-Eigentumsrechte erteilt.'],
  pt:['Entrar na conta privada Quant','Abrir YNX Wallet — instalação não verificada','Tentar sessão privada novamente','Verificar conta privada','Sair da sessão privada','Instalação não verificada. A carteira padrão e o Paper são independentes.','O acesso privado é opcional.','Sessão privada conectada.','Autorização privada pendente.','Sessão privada desconectada.','Serviço privado indisponível ou ação incompleta. Tente novamente; a conexão padrão é preservada.','Conta privada verificada. Nenhuma execução nativa ou propriedade do Paper foi concedida.'],
  ru:['Войти в частный аккаунт Quant','Открыть YNX Wallet — установка не проверена','Повторить частную сессию','Проверить частный аккаунт','Выйти из частной сессии','Установка не проверена. Стандартный кошелёк и Paper независимы.','Вход в частный аккаунт необязателен.','Частная сессия подключена.','Ожидание частной авторизации.','Частная сессия отключена.','Частный сервис недоступен или действие не завершено. Повторите; стандартное подключение сохранено.','Частный аккаунт проверен. Нативное исполнение и права на Paper не предоставлены.'],
  ar:['تسجيل الدخول إلى حساب Quant الخاص','فتح YNX Wallet — التثبيت غير متحقق','إعادة محاولة الجلسة الخاصة','التحقق من الحساب الخاص','الخروج من الجلسة الخاصة','التثبيت غير متحقق. المحفظة القياسية والتداول الورقي مستقلان.','تسجيل الدخول الخاص اختياري.','الجلسة الخاصة متصلة.','التفويض الخاص قيد الانتظار.','الجلسة الخاصة غير متصلة.','الخدمة الخاصة غير متاحة أو الإجراء غير مكتمل. أعد المحاولة؛ الاتصال القياسي محفوظ.','تم التحقق من الحساب الخاص. لم يتم منح تنفيذ أصلي أو ملكية للتداول الورقي.'],
  id:['Masuk ke akun privat Quant','Buka YNX Wallet — instalasi belum terverifikasi','Coba ulang sesi privat','Verifikasi akun privat','Keluar dari sesi privat','Instalasi belum terverifikasi. Dompet standar dan Paper tetap independen.','Masuk privat bersifat opsional.','Sesi privat terhubung.','Otorisasi privat tertunda.','Sesi privat terputus.','Layanan privat tidak tersedia atau tindakan belum selesai. Coba lagi; koneksi standar dipertahankan.','Akun privat terverifikasi. Tidak ada eksekusi native atau kepemilikan Paper yang diberikan.'],
};
export const privateSessionLocales=Object.freeze(Object.keys(rows));
const recordsRows={
  en:['Authorize reading my records','Read my records','Revoke record access','Read only: existing mandates, execution status and risk limits. No Paper, creation, execution or revocation permission.'],
  'zh-CN':['授权读取我的记录','读取我的记录','撤销记录读取授权','仅只读本人已有委托、执行状态和风险限额，不授予模拟交易、新建、执行或撤销操作权限。'],
  'zh-TW':['授權讀取我的紀錄','讀取我的紀錄','撤銷紀錄讀取授權','僅唯讀本人既有委託、執行狀態和風險限額，不授予模擬交易、新增、執行或撤銷操作權限。'],
  ja:['自分の記録の読み取りを許可','自分の記録を読む','記録へのアクセスを取り消す','既存の委任、実行状況、リスク上限の読み取りのみ。Paper、作成、実行、取消の権限は付与しません。'],
  ko:['내 기록 읽기 승인','내 기록 읽기','기록 접근 권한 취소','기존 위임, 실행 상태 및 위험 한도만 읽습니다. Paper, 생성, 실행 또는 취소 권한은 없습니다.'],
  es:['Autorizar lectura de mis registros','Leer mis registros','Revocar acceso a registros','Solo lectura: mandatos existentes, estado de ejecución y límites de riesgo. Sin permisos de Paper, creación, ejecución ni revocación.'],
  fr:['Autoriser la lecture de mes dossiers','Lire mes dossiers','Révoquer cet accès','Lecture seule : mandats existants, état d’exécution et limites de risque. Aucun droit Paper, de création, d’exécution ou de révocation.'],
  de:['Lesen meiner Datensätze erlauben','Meine Datensätze lesen','Datenzugriff widerrufen','Nur Lesen: bestehende Mandate, Ausführungsstatus und Risikolimits. Keine Paper-, Erstellungs-, Ausführungs- oder Widerrufsrechte.'],
  pt:['Autorizar leitura dos meus registros','Ler meus registros','Revogar acesso aos registros','Somente leitura: mandatos existentes, estado de execução e limites de risco. Sem permissões de Paper, criação, execução ou revogação.'],
  ru:['Разрешить чтение моих записей','Прочитать мои записи','Отозвать доступ к записям','Только чтение существующих мандатов, статуса исполнения и лимитов риска. Без прав Paper, создания, исполнения или отзыва.'],
  ar:['السماح بقراءة سجلاتي','قراءة سجلاتي','إلغاء الوصول إلى السجلات','قراءة فقط للتفويضات الحالية وحالة التنفيذ وحدود المخاطر. دون صلاحيات Paper أو الإنشاء أو التنفيذ أو الإلغاء.'],
  id:['Izinkan membaca catatan saya','Baca catatan saya','Cabut akses catatan','Hanya baca mandat yang ada, status eksekusi, dan batas risiko. Tanpa izin Paper, pembuatan, eksekusi, atau pencabutan.'],
};
const recordLabels={
  en:['Mandate','Execution','Daily loss limit','Protocol integer units','Expiry','Active','Revoked','No owned records'],
  'zh-CN':['委托','执行记录','每日亏损限额','协议整数单位','到期时间','有效','已撤销','暂无本人记录'],
  'zh-TW':['委託','執行紀錄','每日虧損限額','協議整數單位','到期時間','有效','已撤銷','暫無本人紀錄'],
  ja:['委任','実行記録','日次損失上限','プロトコル整数単位','有効期限','有効','取消済み','自分の記録はありません'],
  ko:['위임','실행 기록','일일 손실 한도','프로토콜 정수 단위','만료','유효','취소됨','내 기록 없음'],
  es:['Mandato','Ejecución','Límite de pérdida diaria','Unidades enteras del protocolo','Vencimiento','Activo','Revocado','Sin registros propios'],
  fr:['Mandat','Exécution','Limite de perte quotidienne','Unités entières du protocole','Expiration','Actif','Révoqué','Aucun dossier personnel'],
  de:['Mandat','Ausführung','Tägliches Verlustlimit','Ganzzahlige Protokolleinheiten','Ablauf','Aktiv','Widerrufen','Keine eigenen Datensätze'],
  pt:['Mandato','Execução','Limite de perda diária','Unidades inteiras do protocolo','Validade','Ativo','Revogado','Sem registros próprios'],
  ru:['Мандат','Исполнение','Дневной лимит потерь','Целочисленные единицы протокола','Истечение','Активен','Отозван','Личных записей нет'],
  ar:['تفويض','تنفيذ','حد الخسارة اليومية','وحدات البروتوكول الصحيحة','انتهاء الصلاحية','نشط','ملغى','لا توجد سجلات شخصية'],
  id:['Mandat','Eksekusi','Batas rugi harian','Unit bilangan bulat protokol','Kedaluwarsa','Aktif','Dicabut','Belum ada catatan milik saya'],
};
const identityRows={
  en:['Sign in with YNX identity','Sign out of Quant','Identity only. Private records require separate Wallet approval; no Paper or execution permission.'],
  'zh-CN':['使用 YNX 身份登录','退出 Quant','仅身份登录。私有记录需另行钱包审批，不授予模拟交易或执行权限。'],
  'zh-TW':['使用 YNX 身分登入','登出 Quant','僅身分登入。私有紀錄需另行錢包審批，不授予模擬交易或執行權限。'],
  ja:['YNX ID でログイン','Quant からログアウト','ID のみ。非公開記録には別途 Wallet 承認が必要で、Paper や実行権限はありません。'],
  ko:['YNX ID로 로그인','Quant에서 로그아웃','ID 전용입니다. 비공개 기록에는 별도 지갑 승인이 필요하며 Paper 또는 실행 권한은 없습니다.'],
  es:['Iniciar sesión con identidad YNX','Cerrar sesión en Quant','Solo identidad. Los registros privados requieren aprobación separada de Wallet; sin permisos Paper ni ejecución.'],
  fr:['Se connecter avec l’identité YNX','Se déconnecter de Quant','Identité uniquement. Les dossiers privés exigent une approbation Wallet distincte ; aucun droit Paper ou d’exécution.'],
  de:['Mit YNX-Identität anmelden','Bei Quant abmelden','Nur Identität. Private Daten benötigen eine separate Wallet-Freigabe; keine Paper- oder Ausführungsrechte.'],
  pt:['Entrar com identidade YNX','Sair do Quant','Somente identidade. Registros privados exigem aprovação separada da Wallet; sem permissão Paper ou execução.'],
  ru:['Войти с идентификатором YNX','Выйти из Quant','Только идентификация. Личные записи требуют отдельного одобрения Wallet; без прав Paper или исполнения.'],
  ar:['تسجيل الدخول بهوية YNX','تسجيل الخروج من Quant','هوية فقط. تتطلب السجلات الخاصة موافقة Wallet منفصلة؛ دون صلاحيات Paper أو التنفيذ.'],
  id:['Masuk dengan identitas YNX','Keluar dari Quant','Hanya identitas. Catatan privat memerlukan persetujuan Wallet terpisah; tanpa izin Paper atau eksekusi.'],
};
export function privateSessionCopy(locale){return {...Object.fromEntries(keys.map((key,index)=>[key,(rows[locale]||rows.en)[index]])),...Object.fromEntries(['recordsAuthorize','recordsRead','recordsRevoke','recordsBoundary'].map((key,index)=>[key,(recordsRows[locale]||recordsRows.en)[index]])),...Object.fromEntries(['recordsMandate','recordsExecution','recordsDailyLoss','recordsUnits','recordsExpiry','recordsActive','recordsRevoked','recordsEmpty'].map((key,index)=>[key,(recordLabels[locale]||recordLabels.en)[index]])),...Object.fromEntries(['identitySignIn','identitySignOut','identityBoundary'].map((key,index)=>[key,(identityRows[locale]||identityRows.en)[index]]))};}
