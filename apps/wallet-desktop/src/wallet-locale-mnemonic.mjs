const baseKeys=['Recovery phrase','Create Wallet with recovery phrase','12 words','24 words','Generate recovery phrase','Keep these words offline. Anyone with them can control your funds. YNX will never ask for them.','I wrote these words down','Confirm offline backup','Word {number}','Create Wallet','Show recovery phrase','Verify local password to view your recovery phrase.','Reveal recovery phrase'];
const rows={
 en:baseKeys.join('|'),
 'zh-Hans':'助记词|使用助记词创建钱包|12 个单词|24 个单词|生成助记词|请离线保存这些单词，任何持有者都能控制你的资产。YNX 绝不会索要助记词。|我已抄下这些单词|确认离线备份|第 {number} 个单词|创建钱包|查看助记词|请验证本地密码后查看助记词。|显示助记词',
 'zh-Hant':'助記詞|使用助記詞建立錢包|12 個單字|24 個單字|產生助記詞|請離線保存這些單字，任何持有者都能控制你的資產。YNX 絕不會索取助記詞。|我已抄下這些單字|確認離線備份|第 {number} 個單字|建立錢包|查看助記詞|請驗證本機密碼後查看助記詞。|顯示助記詞',
 ja:'リカバリーフレーズ|フレーズでウォレットを作成|12 単語|24 単語|フレーズを生成|単語はオフラインで保管してください。知っている人は資産を操作できます。YNX が尋ねることはありません。|単語を書き留めました|オフラインのバックアップを確認|{number} 番目の単語|ウォレットを作成|フレーズを表示|フレーズの表示にはローカルパスワードを確認します。|フレーズを表示',
 ko:'복구 구문|복구 구문으로 지갑 만들기|12 단어|24 단어|복구 구문 생성|단어를 오프라인으로 보관하세요. 아는 사람은 자산을 제어할 수 있습니다. YNX는 요청하지 않습니다.|단어를 기록했습니다|오프라인 백업 확인|{number}번째 단어|지갑 만들기|복구 구문 보기|복구 구문을 보려면 로컬 암호를 확인하세요.|복구 구문 표시',
 es:'Frase de recuperación|Crear Wallet con frase|12 palabras|24 palabras|Generar frase|Guarda las palabras sin conexión. Quien las tenga puede controlar tus fondos. YNX nunca las solicitará.|He anotado las palabras|Confirmar copia sin conexión|Palabra {number}|Crear Wallet|Ver frase|Verifica la contraseña local para ver tu frase.|Mostrar frase',
 fr:'Phrase de récupération|Créer un Wallet avec une phrase|12 mots|24 mots|Générer la phrase|Gardez les mots hors ligne. Leur détenteur peut contrôler vos fonds. YNX ne les demandera jamais.|J’ai noté les mots|Confirmer la sauvegarde hors ligne|Mot {number}|Créer le Wallet|Voir la phrase|Vérifiez le mot de passe local pour voir la phrase.|Afficher la phrase',
 de:'Wiederherstellungsphrase|Wallet mit Phrase erstellen|12 Wörter|24 Wörter|Phrase erzeugen|Bewahren Sie die Wörter offline auf. Wer sie kennt, kontrolliert Ihr Guthaben. YNX fragt nie danach.|Ich habe die Wörter notiert|Offline-Sicherung bestätigen|Wort {number}|Wallet erstellen|Phrase ansehen|Lokales Passwort zum Anzeigen der Phrase bestätigen.|Phrase anzeigen',
 pt:'Frase de recuperação|Criar Wallet com frase|12 palavras|24 palavras|Gerar frase|Guarde as palavras offline. Quem as tiver pode controlar seus fundos. YNX nunca as solicitará.|Anotei as palavras|Confirmar backup offline|Palavra {number}|Criar Wallet|Ver frase|Verifique a senha local para ver a frase.|Mostrar frase',
 ru:'Фраза восстановления|Создать кошелёк с фразой|12 слов|24 слова|Создать фразу|Храните слова офлайн. Знающий их может управлять средствами. YNX никогда их не запрашивает.|Я записал слова|Подтвердить офлайн-копию|Слово {number}|Создать кошелёк|Посмотреть фразу|Подтвердите локальный пароль для просмотра фразы.|Показать фразу',
 ar:'عبارة الاسترداد|إنشاء محفظة بعبارة الاسترداد|12 كلمة|24 كلمة|إنشاء العبارة|احفظ الكلمات دون اتصال. من يملكها يستطيع التحكم بأموالك. لن تطلبها YNX أبداً.|كتبت الكلمات|تأكيد النسخة دون اتصال|الكلمة {number}|إنشاء المحفظة|عرض عبارة الاسترداد|تحقق من كلمة المرور المحلية لعرض العبارة.|إظهار العبارة',
 id:'Frasa pemulihan|Buat Wallet dengan frasa|12 kata|24 kata|Buat frasa|Simpan kata secara offline. Siapa pun yang memilikinya dapat mengendalikan dana. YNX tidak akan memintanya.|Saya sudah mencatat kata|Konfirmasi cadangan offline|Kata {number}|Buat Wallet|Lihat frasa|Verifikasi kata sandi lokal untuk melihat frasa.|Tampilkan frasa'
};
const importKeys=['Import an existing account','Recovery phrase length','Show words','Hide words','Enter each word in order. Your recovery phrase stays on this device.','Import and select account','Unable to import the account. Check the backup and try again.'];
const importRows={
 en:importKeys.join('|'),
 'zh-Hans':'导入已有账户|助记词长度|显示单词|隐藏单词|按顺序逐个填写单词。助记词仅保留在此设备上。|导入并选择账户|无法导入账户，请检查备份后重试。',
 'zh-Hant':'匯入已有帳戶|助記詞長度|顯示單字|隱藏單字|按順序逐個填寫單字。助記詞僅保留在此裝置上。|匯入並選擇帳戶|無法匯入帳戶，請檢查備份後重試。',
 ja:'既存のアカウントをインポート|フレーズの長さ|単語を表示|単語を隠す|単語を順番に入力してください。フレーズはこの端末にのみ保持されます。|インポートしてアカウントを選択|インポートできません。バックアップを確認して再試行してください。',
 ko:'기존 계정 가져오기|복구 구문 길이|단어 표시|단어 숨기기|단어를 순서대로 입력하세요. 복구 구문은 이 기기에만 보관됩니다.|가져오고 계정 선택|계정을 가져올 수 없습니다. 백업을 확인하고 다시 시도하세요.',
 es:'Importar cuenta existente|Longitud de la frase|Mostrar palabras|Ocultar palabras|Introduce cada palabra en orden. La frase permanece en este dispositivo.|Importar y seleccionar cuenta|No se pudo importar. Comprueba la copia y vuelve a intentarlo.',
 fr:'Importer un compte existant|Longueur de la phrase|Afficher les mots|Masquer les mots|Saisissez les mots dans l’ordre. La phrase reste sur cet appareil.|Importer et sélectionner le compte|Importation impossible. Vérifiez la sauvegarde et réessayez.',
 de:'Bestehendes Konto importieren|Länge der Phrase|Wörter anzeigen|Wörter verbergen|Geben Sie die Wörter in Reihenfolge ein. Die Phrase bleibt auf diesem Gerät.|Konto importieren und auswählen|Import nicht möglich. Sicherung prüfen und erneut versuchen.',
 pt:'Importar conta existente|Comprimento da frase|Mostrar palavras|Ocultar palavras|Digite cada palavra na ordem. A frase permanece neste dispositivo.|Importar e selecionar conta|Não foi possível importar. Confira o backup e tente novamente.',
 ru:'Импорт существующего аккаунта|Длина фразы|Показать слова|Скрыть слова|Введите слова по порядку. Фраза остаётся на этом устройстве.|Импортировать и выбрать аккаунт|Не удалось импортировать. Проверьте резервную копию и повторите.',
 ar:'استيراد حساب موجود|طول عبارة الاسترداد|إظهار الكلمات|إخفاء الكلمات|أدخل الكلمات بالترتيب. تبقى العبارة على هذا الجهاز.|استيراد الحساب واختياره|تعذر الاستيراد. تحقق من النسخة الاحتياطية وأعد المحاولة.',
 id:'Impor akun yang ada|Panjang frasa|Tampilkan kata|Sembunyikan kata|Masukkan kata secara berurutan. Frasa tetap di perangkat ini.|Impor dan pilih akun|Tidak dapat mengimpor. Periksa cadangan dan coba lagi.'
};
export const MNEMONIC_COPY_KEYS=Object.freeze([...baseKeys,...importKeys]);
export const MNEMONIC_COPY=Object.freeze(Object.fromEntries(Object.entries(rows).map(([locale,row])=>{const values=[...row.split('|'),...importRows[locale].split('|')];if(values.length!==MNEMONIC_COPY_KEYS.length)throw Error('Incomplete mnemonic copy');return [locale,Object.freeze(Object.fromEntries(MNEMONIC_COPY_KEYS.map((key,i)=>[key,values[i]])))]})));
